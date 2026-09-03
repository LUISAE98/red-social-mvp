// Proceso mensual que emite los comprobantes de Vibra al creador.
//
// Corre el día 5 de cada mes sobre el mes ANTERIOR. El retraso es a propósito: da margen a que
// se resuelvan las experiencias pendientes de los últimos días, para no emitir una constancia
// de retenciones sobre dinero que se acaba de devolver.
//
// Es idempotente por `{creatorId}_{periodo}_{tipo}`: reintentarlo no duplica comprobantes.
//
// ⚠️ ARRANCA APAGADO. El interruptor de abajo evita que un despliegue empiece a timbrar
// comprobantes fiscales reales sin que nadie lo haya decidido. Se enciende cuando el contador
// valide las dos claves marcadas 🔁 en `creatorMonthlyDocs.ts`.
//
// 📅 LA FACTURA GLOBAL YA NO SALE DE AQUÍ (2026-09-02, §A1).
//
// Vive en `runGlobalInvoice.ts` y se emite A DIARIO, porque su plazo son 24 horas desde el
// cierre de las operaciones y este proceso corre el día 5 sobre el mes anterior. La comisión y
// la constancia de retenciones sí siguen aquí: son periódicas por naturaleza y emitirlas a
// diario daría mil comprobantes al mes por creador.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { facturapiTestKey, facturapiUserKey } from "./facturapiClient";
import {
  acumularMes,
  asientosDelMes,
  documentosDelMes,
  emitirCfdiComision,
  emitirCfdiRetenciones,
  periodoDe,
  registrarDocumento,
  serviciosDelPeriodo,
  yaEmitido,
} from "./creatorMonthlyDocs";
import { armarComprobante, guardarComprobante } from "./comprobanteLiquidacion";
import { SETTLEMENT_CURRENCY } from "../wallet/ledger";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/**
 * 🚧 INTERRUPTOR. En `false` el proceso calcula y registra el acumulado pero **no timbra nada**.
 *
 * Timbrar un CFDI es un acto fiscal irreversible —cancelarlo es un trámite, no un borrado—, así
 * que la emisión real no se enciende con un despliegue: se enciende a propósito.
 */
const TIMBRAR = false;

/** Mes anterior al de una fecha, en `YYYY-MM`. */
function periodoAnterior(hoy: Date): string {
  return periodoDe(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)));
}

/**
 * Procesa un periodo completo.
 *
 * Devuelve el resumen de lo hecho para poder revisarlo antes de encender el timbrado.
 */
export async function procesarPeriodo(periodo: string): Promise<{
  periodo: string;
  creadores: number;
  comision: number;
  retenciones: number;
  liquidaciones: number;
  saltados: number;
  errores: number;
  timbrado: boolean;
}> {
  // Solo creadores con perfil fiscal: sin él no hay a quién emitirle.
  const perfiles = await db.collection("creatorTaxProfiles").get();
  const r = {
    periodo,
    creadores: 0,
    comision: 0,
    retenciones: 0,
    liquidaciones: 0,
    saltados: 0,
    errores: 0,
    timbrado: TIMBRAR,
  };

  for (const p of perfiles.docs) {
    const creatorId = p.id;
    try {
      const asientos = await asientosDelMes(creatorId, periodo);
      const acc = acumularMes(creatorId, periodo, asientos);
      if (acc.ventas === 0) continue;
      r.creadores++;

      const toca = documentosDelMes(acc);
      // El cliente de Facturapi del creador, dado de alta en la organización de VIBRA:
      // aquí el emisor es ella, así que el creador es el receptor.
      const customerId = String(p.get("facturapiCustomerIdVibra") ?? "").trim();

      for (const tipo of ["comision", "retenciones", "liquidacion"] as const) {
        if (!toca[tipo]) continue;
        if (await yaEmitido(creatorId, periodo, tipo)) {
          r.saltados++;
          continue;
        }

        let facturapiId: string | null = null;
        let uuid: string | null = null;

        // ⚠️ El comprobante de liquidación NO es un CFDI: no se timbra, pero **sí se
        // genera**. Antes solo se registraba que «tocaba», y el creador extranjero se
        // quedaba sin nada que enseñarle a su contador. Se emite siempre, encendido o no el
        // timbrado, porque no depende de ninguna clave del SAT.
        if (tipo === "liquidacion") {
          await guardarComprobante(
            armarComprobante(acc, SETTLEMENT_CURRENCY, new Date().toISOString())
          );
        }

        if (TIMBRAR && tipo !== "liquidacion") {
          if (!customerId) {
            logger.warn("monthly_docs_sin_customer", { creatorId, periodo, tipo });
            r.errores++;
            continue;
          }
          const doc =
            tipo === "comision"
              ? await emitirCfdiComision(acc, customerId)
              : // La constancia lleva un nodo por operación, no solo totales (§A4).
                await emitirCfdiRetenciones(acc, customerId, serviciosDelPeriodo(asientos));
          facturapiId = doc.id;
          uuid = doc.uuid ?? null;
        }

        await registrarDocumento({ creatorId, periodo, tipo, facturapiId, uuid, acumulado: acc });
        if (tipo === "comision") r.comision++;
        else if (tipo === "retenciones") r.retenciones++;
        else r.liquidaciones++;
      }
    } catch (err) {
      // Un creador que falla no detiene a los demás: son documentos independientes.
      r.errores++;
      logger.error("monthly_docs_creator_failed", {
        creatorId,
        periodo,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("monthly_docs_done", r);
  return r;
}

/** Día 5 de cada mes, 09:00 hora de Ciudad de México, sobre el mes anterior. */
export const creatorMonthlyDocsCron = onSchedule(
  {
    region: REGION,
    schedule: "0 9 5 * *",
    timeZone: "America/Mexico_City",
    secrets: [facturapiTestKey, facturapiUserKey],
  },
  async () => {
    await procesarPeriodo(periodoAnterior(new Date()));
  }
);

/**
 * Disparo manual, para revisar un periodo antes de encender el timbrado.
 *
 * Solo superadministradores: emite documentos fiscales a nombre de Vibra.
 */
export const runCreatorMonthlyDocs = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.get("role") !== "superadmin") {
      throw new HttpsError("permission-denied", "Solo un superadministrador puede ejecutarlo.");
    }

    const periodo = String((request.data as { periodo?: unknown })?.periodo ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(periodo)) {
      throw new HttpsError("invalid-argument", "Periodo inválido. Usa YYYY-MM.");
    }
    return await procesarPeriodo(periodo);
  }
);
