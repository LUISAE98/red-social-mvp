// Factura global DIARIA (`pendientesimpuestos.md` §A1).
//
// ⚠️ POR QUÉ VIVE APARTE DEL PROCESO MENSUAL
//
// Los cuatro documentos del creador no tienen la misma cadencia, y meterlos en el mismo cron era
// lo que hacía incumplir a la global:
//
//   · Comisión y constancia de retenciones — **mensuales**. Son periódicas por naturaleza y se
//     agregan por mes; emitirlas a diario daría mil comprobantes al mes por creador.
//   · Factura global — **diaria**. La RMF 2026 (regla 2.7.1.21) exige el CFDI global dentro de
//     las **24 horas** siguientes al cierre de las operaciones. El proceso mensual corría el día
//     5 sobre el mes anterior: unos 35 días de retraso, incumplimiento garantizado el día que se
//     encendiera el timbrado.
//
// Se investigó si bastaba con acortar a quincenal —la clave `03` de `c_Periodicidad` es válida
// desde 2022— y no: la periodicidad dice qué agrupa el comprobante, no cuándo se emite. Lo que
// cumple el plazo es emitir a diario sobre el día anterior.
//
// ⚠️ Corre a la 01:00 de Ciudad de México sobre el día natural anterior, así que el comprobante
// sale dentro de la primera hora tras el cierre. El margen de 23 horas que queda es para los
// reintentos, no para holgazanear.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { facturapiTestKey, facturapiUserKey } from "./facturapiClient";
import { diaDe, registrarDocumento, yaEmitido } from "./creatorMonthlyDocs";
import {
  agruparGlobal,
  confirmarVentasEnGlobal,
  emitirFacturaGlobal,
  reservarVentasParaGlobal,
  creadoresQueVendieron,
  soltarLiberadasCaducadas,
  ventasAtascadas,
  ventasSinFacturarDelPeriodo,
} from "./globalInvoice";
import { creadoresConColaPendiente, procesarColaDeCreador } from "./colaDeFacturas";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

/**
 * 🚧 INTERRUPTOR. Mismo criterio que el proceso mensual: en `false` calcula y cuenta, pero **no
 * timbra ni marca nada**.
 *
 * Va aquí y no importado del mensual a propósito: son dos emisiones distintas y se pueden querer
 * encender por separado. La global depende de todo el grupo A; la comisión, solo de §A0.
 */
const TIMBRAR = false;

/**
 * Día natural MEXICANO anterior a un instante, en `YYYY-MM-DD`.
 *
 * Se resta un día entero al instante y se pregunta a `diaDe`, que ya razona en hora de México.
 * Hacer la resta sobre las partes UTC —como estaba— daba el día equivocado para cualquier
 * ejecución entre medianoche y las 06:00 UTC, que es justo cuando corre este cron.
 */
export function diaAnterior(hoy: Date): string {
  return diaDe(new Date(hoy.getTime() - 24 * 3_600_000));
}

export type ResumenDelDia = {
  dia: string;
  creadores: number;
  emitidas: number;
  sinSello: number;
  simuladas: number;
  ventasSinPesos: number;
  ventasAtascadas: number;
  /** Reservas `liberada` caducadas que volvieron al circuito (AUD-8). */
  liberadasSoltadas: number;
  /** Facturas de la cola que la barrida recogió (AUD-9). */
  colaRecogida: number;
  errores: number;
  timbrado: boolean;
};

/**
 * Emite la factura global de un día para todos los creadores que vendieron.
 *
 * Un creador que falla no detiene a los demás: son documentos independientes y cada uno responde
 * ante el SAT por su cuenta.
 */
export async function procesarGlobalDelDia(dia: string): Promise<ResumenDelDia> {
  const r: ResumenDelDia = {
    dia,
    creadores: 0,
    emitidas: 0,
    sinSello: 0,
    simuladas: 0,
    ventasSinPesos: 0,
    ventasAtascadas: 0,
    liberadasSoltadas: 0,
    colaRecogida: 0,
    errores: 0,
    timbrado: TIMBRAR,
  };

  /**
   * 🧹 Primero, la barrida de reservas `liberada` caducadas — UNA consulta para toda la
   * plataforma. Va antes de mirar nada porque devuelve ventas al circuito, y esas ventas
   * pueden tener que entrar en la global de hoy.
   */
  r.liberadasSoltadas = await soltarLiberadasCaducadas();

  /**
   * 🚨 A quién hay que mirar hoy (AUD-10).
   *
   * Antes se recorrían TODOS los perfiles fiscales lanzando una consulta de grupo por cada uno:
   * con mil creadores, mil consultas diarias para emitir un puñado de facturas. Ahora se
   * pregunta al revés —quién vendió ese día y quién tiene cola pendiente— con dos consultas, y
   * se trabaja solo sobre esa unión.
   */
  const interesan = new Set<string>([
    ...(await creadoresQueVendieron(dia)),
    ...(await creadoresConColaPendiente()),
  ]);

  for (const creatorId of interesan) {
    try {
      // Sin perfil fiscal no hay emisor posible.
      const p = await db.doc(`creatorTaxProfiles/${creatorId}`).get();
      if (!p.exists) continue;

      // Red de seguridad de la cola: recoge lo que el disparador del sello dejó pendiente, sin
      // volver a timbrar nada ya emitido.
      const cola = await procesarColaDeCreador(creatorId);
      r.colaRecogida += cola.emitidas;

      if (await yaEmitido(creatorId, dia, "global")) continue;

      const sinFacturar = await ventasSinFacturarDelPeriodo(creatorId, dia);
      if (sinFacturar.sinCongelar > 0) {
        // Ventas cuyos pesos nunca se congelaron. No se cuelan con los dólares del ledger
        // disfrazados de pesos; se cantan para que el backfill las alcance.
        r.ventasSinPesos += sinFacturar.sinCongelar;
        logger.warn("global_invoice_ventas_sin_pesos", {
          creatorId,
          dia,
          ventas: sinFacturar.sinCongelar,
        });
      }

      const previo = agruparGlobal(creatorId, dia, sinFacturar.ventas);
      if (previo.ventas > 0) {
        r.creadores++;
        const orgId = String(p.get("facturapiOrgId") ?? "").trim();
        const selloValido = p.get("csdStatus") === "valid";

        if (!orgId || !selloValido) {
          // Sin sello no hay emisor y el día se queda sin documentar. Se cuenta aparte porque
          // NO es un error del proceso: es un creador que debe subirlo.
          r.sinSello++;
          logger.warn("global_invoice_sin_sello", { creatorId, dia, ventas: previo.ventas });
        } else if (!TIMBRAR) {
          /**
           * 🚧 Apagado: se calcula y se cuenta, pero **no se marca ni se registra**. Marcar
           * apartaría las ventas por una factura que no existe, y registrar daría el día por
           * hecho para siempre.
           */
          r.simuladas++;
        } else {
          // Fase 1 — apartar, releyendo. Desde aquí no pueden irse a una nominativa.
          const reservadas = await reservarVentasParaGlobal(
            sinFacturar.ventas.map((v) => v.path),
            dia
          );
          const apartadas = new Set(reservadas);
          const definitivo = agruparGlobal(
            creatorId,
            dia,
            sinFacturar.ventas.filter((v) => apartadas.has(v.path))
          );

          if (definitivo.ventas === 0) {
            // Se las llevaron todas los compradores con sus nominativas.
            logger.info("global_invoice_sin_ventas_tras_reserva", { creatorId, dia });
          } else {
            // Fase 2 — timbrar.
            const doc = await emitirFacturaGlobal(definitivo, orgId, String(p.get("zip") ?? ""));

            // Fase 3 — confirmar solo lo apartado, y antes de registrar el documento.
            await confirmarVentasEnGlobal({
              paths: reservadas,
              periodo: dia,
              facturapiId: doc.id,
              uuid: doc.uuid ?? null,
            });

            await registrarDocumento({
              creatorId,
              periodo: dia,
              tipo: "global",
              facturapiId: doc.id,
              uuid: doc.uuid ?? null,
              acumulado: definitivo,
            });
            r.emitidas++;
          }
        }
      }

      const atascadas = await ventasAtascadas(creatorId);
      if (atascadas > 0) {
        r.ventasAtascadas += atascadas;
        logger.warn("global_invoice_ventas_atascadas", { creatorId, ventas: atascadas });
      }
    } catch (err) {
      r.errores++;
      logger.error("global_invoice_creator_failed", {
        creatorId,
        dia,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("global_invoice_dia_done", r);
  return r;
}

/**
 * 📅 Cada día a la 01:00 de Ciudad de México, sobre el día natural anterior.
 *
 * La hora importa: el plazo son 24 horas desde el cierre de las operaciones del día, así que
 * emitir en la primera hora deja 23 de margen para reintentos.
 */
export const globalInvoiceDailyCron = onSchedule(
  {
    region: REGION,
    schedule: "0 1 * * *",
    timeZone: "America/Mexico_City",
    secrets: [facturapiTestKey, facturapiUserKey],
  },
  async () => {
    await procesarGlobalDelDia(diaAnterior(new Date()));
  }
);

/** Disparo manual de un día concreto, desde administración. */
export const runGlobalInvoiceDay = onCall(
  { region: REGION, cors: true, secrets: [facturapiTestKey, facturapiUserKey] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
    const userSnap = await db.doc(`users/${uid}`).get();
    if (userSnap.get("isPlatformMod") !== true) {
      throw new HttpsError("permission-denied", "Solo administración.");
    }
    const dia = String((request.data ?? {}).dia ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      throw new HttpsError("invalid-argument", "El día va en formato YYYY-MM-DD.");
    }
    return await procesarGlobalDelDia(dia);
  }
);
