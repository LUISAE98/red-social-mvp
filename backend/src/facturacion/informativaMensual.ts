// Declaración informativa mensual — lo que Vibra tiene que reportar al SAT.
//
// Como plataforma de intermediación, Vibra no solo retiene: además informa. Son dos reportes
// distintos y conviene no confundirlos:
//
//   1. RETENCIONES — cuánto se le retuvo a cada creador de ISR y de IVA. Es la que cuadra con
//      las constancias que se le entregaron.
//   2. OPERACIONES — quiénes vendieron a través de la plataforma y por cuánto, con sus datos
//      de identificación. Es la que le dice al SAT quién está usando Vibra para vender.
//
// Aquí se GENERAN los datos, no se presentan. Presentar la declaración es un trámite que hace
// el contador en el portal del SAT; lo que faltaba era el número exacto y trazable.
//
// ⚠️ Se construye desde los ASIENTOS, no desde las constancias emitidas. Si una constancia
// falla al timbrarse, la obligación de informar no desaparece — y cuadrar el reporte contra los
// asientos es lo que permite detectar justamente esa diferencia.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { acumularMes, asientosDelMes, rangoDelPeriodo } from "./creatorMonthlyDocs";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Una fila del reporte: un creador y lo que se le retuvo en el mes. */
export type FilaInformativa = {
  creatorId: string;
  /** Identificación fiscal. Vacía = creador sin datos, que es lo que hay que perseguir. */
  taxId: string;
  legalName: string;
  residency: "MX" | "FOREIGN";
  ventas: number;
  base: number;
  isrRetenido: number;
  ivaRetenido: number;
  /** Constancia emitida de ese mes, si la hubo. Sirve para detectar descuadres. */
  constanciaUuid: string | null;
};

export type Informativa = {
  periodo: string;
  generadaEn: string;
  filas: FilaInformativa[];
  totales: {
    creadores: number;
    ventas: number;
    base: number;
    isrRetenido: number;
    ivaRetenido: number;
  };
  /** Creadores con retención pero SIN identificación fiscal registrada. */
  sinIdentificacion: number;
  /** Creadores con retención en el mes pero sin constancia emitida. */
  sinConstancia: number;
};

/**
 * Arma la informativa de un periodo.
 *
 * Recorre los perfiles fiscales porque son los creadores que pueden tener retenciones. Uno sin
 * perfil no ha vendido nunca con datos, y si vendió sin ellos aparece igual: el asiento existe
 * y su retención también.
 */
export async function generarInformativa(periodo: string): Promise<Informativa> {
  const perfiles = await db.collection("creatorTaxProfiles").get();
  const filas: FilaInformativa[] = [];

  for (const p of perfiles.docs) {
    const creatorId = p.id;
    const asientos = await asientosDelMes(creatorId, periodo);
    const acc = acumularMes(creatorId, periodo, asientos);
    if (acc.ventas === 0) continue;
    if (acc.isrRetenido === 0 && acc.ivaRetenido === 0) continue;

    const constancia = await db
      .collection("creatorMonthlyDocs")
      .doc(`${creatorId}_${periodo}_retenciones`)
      .get();

    filas.push({
      creatorId,
      taxId: String(p.get("taxId") ?? ""),
      legalName: String(p.get("legalName") ?? ""),
      residency: acc.residency,
      ventas: acc.ventas,
      base: acc.base,
      isrRetenido: acc.isrRetenido,
      ivaRetenido: acc.ivaRetenido,
      constanciaUuid: constancia.exists ? (constancia.get("uuid") as string | null) ?? null : null,
    });
  }

  // Mayor retención primero: es el orden en que un contador quiere revisarlo.
  filas.sort((a, b) => b.isrRetenido + b.ivaRetenido - (a.isrRetenido + a.ivaRetenido));

  const totales = filas.reduce(
    (t, f) => ({
      creadores: t.creadores + 1,
      ventas: t.ventas + f.ventas,
      base: round2(t.base + f.base),
      isrRetenido: round2(t.isrRetenido + f.isrRetenido),
      ivaRetenido: round2(t.ivaRetenido + f.ivaRetenido),
    }),
    { creadores: 0, ventas: 0, base: 0, isrRetenido: 0, ivaRetenido: 0 }
  );

  const { desde } = rangoDelPeriodo(periodo);
  const informativa: Informativa = {
    periodo,
    generadaEn: new Date().toISOString(),
    filas,
    totales,
    sinIdentificacion: filas.filter((f) => !f.taxId).length,
    sinConstancia: filas.filter((f) => !f.constanciaUuid).length,
  };

  // Se guarda para poder demostrar QUÉ se reportó y CUÁNDO. Un reporte que solo existe en la
  // pantalla del que lo pidió no sirve como respaldo si alguien pregunta meses después.
  await db
    .collection("informativasMensuales")
    .doc(periodo)
    .set(
      { ...informativa, mes: desde.getUTCMonth() + 1, anio: desde.getUTCFullYear() },
      { merge: true }
    );

  logger.info("informativa_generada", {
    periodo,
    creadores: totales.creadores,
    isr: totales.isrRetenido,
    iva: totales.ivaRetenido,
    sinIdentificacion: informativa.sinIdentificacion,
  });

  return informativa;
}

/** Genera la informativa de un periodo. Solo superadministradores. */
export const generarInformativaMensual = onCall({ region: REGION, cors: true }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  const userSnap = await db.collection("users").doc(uid).get();
  if (userSnap.get("role") !== "superadmin") {
    throw new HttpsError("permission-denied", "Solo un superadministrador puede generarla.");
  }

  const periodo = String((request.data as { periodo?: unknown })?.periodo ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(periodo)) {
    throw new HttpsError("invalid-argument", "Periodo inválido. Usa YYYY-MM.");
  }
  return await generarInformativa(periodo);
});
