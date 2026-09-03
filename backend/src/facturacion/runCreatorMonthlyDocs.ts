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
  yaEmitido,
} from "./creatorMonthlyDocs";
import {
  agruparGlobal,
  confirmarVentasEnGlobal,
  emitirFacturaGlobal,
  reservarVentasParaGlobal,
  ventasAtascadas,
  ventasSinFacturarDelMes,
} from "./globalInvoice";
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
  globales: number;
  globalesSinSello: number;
  /** Ventas excluidas de la global por no tener sus pesos congelados. Las recoge el backfill. */
  ventasSinPesos: number;
  /** Globales que se habrían emitido si `TIMBRAR` estuviera encendido. */
  globalesSimuladas: number;
  /** Ventas apartadas por una global que nunca se confirmó. Hay que mirarlas a mano. */
  ventasAtascadas: number;
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
    globales: 0,
    globalesSinSello: 0,
    ventasSinPesos: 0,
    globalesSimuladas: 0,
    ventasAtascadas: 0,
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
              : await emitirCfdiRetenciones(acc, customerId);
          facturapiId = doc.id;
          uuid = doc.uuid ?? null;
        }

        await registrarDocumento({ creatorId, periodo, tipo, facturapiId, uuid, acumulado: acc });
        if (tipo === "comision") r.comision++;
        else if (tipo === "retenciones") r.retenciones++;
        else r.liquidaciones++;
      }

      // ── Factura GLOBAL: lo que ningún comprador pidió facturado ──────────────
      //
      // Se emite A NOMBRE DEL CREADOR, en su organización y con su sello. Es el único de
      // los cuatro documentos del mes en el que Vibra no es la emisora.
      if (!(await yaEmitido(creatorId, periodo, "global"))) {
        const sinFacturar = await ventasSinFacturarDelMes(creatorId, periodo);
        if (sinFacturar.sinCongelar > 0) {
          // No se cuelan con los dólares del ledger disfrazados de pesos. Se dice en voz alta
          // porque significa que al backfill le faltan ventas por alcanzar.
          r.ventasSinPesos += sinFacturar.sinCongelar;
          logger.warn("global_invoice_ventas_sin_pesos", {
            creatorId,
            periodo,
            ventas: sinFacturar.sinCongelar,
          });
        }
        const global = agruparGlobal(creatorId, periodo, sinFacturar.ventas);
        if (global.ventas > 0) {
          const orgId = String(p.get("facturapiOrgId") ?? "").trim();
          const selloValido = p.get("csdStatus") === "valid";
          if (!orgId || !selloValido) {
            // Sin sello no hay emisor posible y el mes se queda sin documentar. Se cuenta
            // aparte porque NO es un error del proceso: es un creador que debe subirlo.
            r.globalesSinSello++;
            logger.warn("global_invoice_sin_sello", { creatorId, periodo, ventas: global.ventas });
          } else if (!TIMBRAR) {
            /**
             * 🚧 Apagado: se calcula y se cuenta, pero **no se marca ni se registra nada**.
             *
             * Antes sí registraba el documento con `facturapiId: null`, y como `yaEmitido` solo
             * miraba si el registro existía, el periodo quedaba dado por hecho. El día que se
             * encendiera `TIMBRAR`, todos los meses «procesados» en falso se habrían saltado
             * para siempre, sin timbrar jamás. Marcar las ventas tendría el mismo defecto: se
             * quedarían apartadas por una factura que no existe.
             */
            r.globalesSimuladas++;
          } else {
            const paths = sinFacturar.ventas.map((v) => v.path);

            // Fase 1 — apartar. Desde aquí no pueden colarse en otra global.
            const reservadas = await reservarVentasParaGlobal(paths, periodo);

            /**
             * 🚨 El importe se calcula sobre lo que SE APARTÓ, no sobre lo que se leyó.
             *
             * Entre la consulta del mes y la reserva, un comprador puede haber pedido la
             * nominativa de una de estas ventas. La reserva se la salta, y si el total se
             * quedara con el de antes, la global cobraría por una venta que ya tiene su propia
             * factura — timbrada dos veces por la puerta de al lado.
             */
            const apartadas = new Set(reservadas);
            const definitivo = agruparGlobal(
              creatorId,
              periodo,
              sinFacturar.ventas.filter((v) => apartadas.has(v.path))
            );

            if (definitivo.ventas === 0) {
              // Se las llevaron todas los compradores con sus nominativas. No hay global que
              // emitir este mes, y no hay nada apartado que soltar.
              logger.info("global_invoice_sin_ventas_tras_reserva", { creatorId, periodo });
            } else {
              // Fase 2 — timbrar.
              const doc = await emitirFacturaGlobal(definitivo, orgId, String(p.get("zip") ?? ""));
              const facturapiId = doc.id;
              const uuid = doc.uuid ?? null;

              /**
               * Fase 3 — confirmar **solo lo que se apartó**, no lo que se leyó al principio.
               *
               * Marcar `paths` pondría «cubierta por la global» a una venta que la reserva se
               * saltó porque el comprador ya la estaba facturando. Quedaría con las dos marcas
               * y sin forma de saber cuál manda.
               *
               * Va antes de registrar el documento: si se cae aquí, el mes se reintenta y no
               * encuentra ventas que meter, en vez de darse por hecho con ventas sueltas que
               * otra global recogería.
               */
              await confirmarVentasEnGlobal({ paths: reservadas, periodo, facturapiId, uuid });

              await registrarDocumento({
                creatorId,
                periodo,
                tipo: "global",
                facturapiId,
                uuid,
                acumulado: acc,
              });
              r.globales++;
            }
          }
        }

        // Lo que se quedó a medias en alguna emisión anterior. No se timbra dos veces, pero
        // puede estar sin documentar.
        const atascadas = await ventasAtascadas(creatorId);
        if (atascadas > 0) {
          r.ventasAtascadas += atascadas;
          logger.warn("global_invoice_ventas_atascadas", { creatorId, ventas: atascadas });
        }
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
