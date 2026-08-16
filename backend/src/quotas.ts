/**
 * Cuotas DIARIAS por usuario para recursos que cuestan dinero de verdad.
 *
 * El problema que resuelve (B5-C07): las funciones que crean subidas en Mux
 * aceptaban cualquier UID autenticado sin tope persistente. Una granja de
 * cuentas —o una sola cuenta comprometida— podía generar subidas indefinidamente
 * y la factura del proveedor la paga Vibra. No hacía falta vulnerar Firestore ni
 * saltarse ninguna regla: bastaba con llamar a la función.
 *
 * ⚠️ Esto NO es el control de ritmo de `rateLimiter.ts`. Aquel limita la
 * VELOCIDAD (un post cada 10 s, 20 por hora) y su ventana se vacía sola; este
 * pone un TECHO al día que no se recupera hasta el día siguiente. Un abuso lento
 * y constante pasa por debajo del primero sin despeinarse.
 *
 * El contador vive en `dailyQuotas/{uid}_{clave}` y lo escribe solo el Admin SDK.
 * La regla comodín del final de `firestore.rules` deniega todo lo no declarado,
 * así que el cliente no puede tocarlo ni leerlo.
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { assertAccountNotBanned } from "./accountStatus";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Tope diario de subidas de video por persona. Decisión de producto de Luis
 * (2026-08-15): 10 al día cubre de sobra el uso normal de un creador.
 */
export const MAX_VIDEOS_POR_DIA = 10;

/**
 * Los demás techos diarios, todos decididos por Luis el 2026-08-15.
 *
 * ⚠️ El de intentos de pago va HOLGADO a propósito. Una tarjeta rechazada hace
 * que el comprador reintente varias veces y esos son intentos legítimos: ponerlo
 * bajo no frena a un abusador, pierde ventas de gente que sí quería pagar.
 */
export const TOPES_DIARIOS = {
  /** Arrancar una transmisión (Mux o Cloudflare). Cada arranque crea un canal. */
  liveStart: 10,
  /** Render de la grabación animada de un saludo (Egress). */
  greetingRender: 20,
  /** Render del video con el marco puesto (FFmpeg). */
  videoOverlay: 20,
  /** Intentos de pago contra Stripe. */
  paymentAttempt: 30,
  /** Facturas emitidas. Facturapi cobra por cada una. */
  invoice: 10,
} as const;

const MENSAJES: Record<keyof typeof TOPES_DIARIOS, string> = {
  liveStart: "Alcanzaste el límite de transmisiones por hoy. Inténtalo mañana.",
  greetingRender: "Alcanzaste el límite de descargas por hoy. Inténtalo mañana.",
  videoOverlay: "Alcanzaste el límite de descargas por hoy. Inténtalo mañana.",
  paymentAttempt: "Demasiados intentos de pago por hoy. Inténtalo mañana.",
  invoice: "Alcanzaste el límite de facturas por hoy. Inténtalo mañana.",
};

/**
 * Consume uno de los techos de arriba.
 *
 * Los mensajes siguen todos la misma forma —qué pasó y qué hacer— para que la
 * interfaz los muestre tal cual, sin tener que interpretarlos.
 */
export async function consumeQuota(uid: string, tipo: keyof typeof TOPES_DIARIOS): Promise<void> {
  await consumeDailyQuota(uid, tipo, TOPES_DIARIOS[tipo], MENSAJES[tipo]);
}

/**
 * El día según el reloj de Ciudad de México, no UTC.
 *
 * Con UTC el contador se reiniciaría a las 18:00 hora local, o sea a media tarde:
 * quien agotara su cuota por la mañana la recuperaría el mismo día. Es la misma
 * zona que usan las tareas programadas.
 */
function diaEnMexico(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Consume una unidad de la cuota diaria, o lanza si ya se agotó.
 *
 * Todo en una transacción: leer y sumar por separado deja que dos llamadas
 * simultáneas lean el mismo número y pasen las dos.
 */
export async function consumeDailyQuota(
  uid: string,
  clave: string,
  maximo: number,
  mensaje: string
): Promise<void> {
  const ref = db.collection("dailyQuotas").doc(`${uid}_${clave}`);
  const dia = diaEnMexico();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);

    // Un documento de otro día cuenta como cero: no hace falta borrarlo.
    const mismoDia = snap.exists && snap.get("day") === dia;
    const usados = mismoDia ? Number(snap.get("count") ?? 0) : 0;

    if (usados >= maximo) {
      logger.warn("daily_quota_exceeded", { uid, clave, dia, usados, maximo });
      throw new HttpsError("resource-exhausted", mensaje);
    }

    tx.set(ref, {
      day: dia,
      count: usados + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

/**
 * Atajo para las subidas de video, que son las tres que comparten el techo.
 *
 * Comprueba además que la cuenta no esté suspendida: las tres funciones que lo
 * llaman crean recursos que cuestan factura, y es el paso por el que pasan todas.
 */
export async function consumeVideoUploadQuota(uid: string): Promise<void> {
  await assertAccountNotBanned(uid);

  await consumeDailyQuota(
    uid,
    "videoUpload",
    MAX_VIDEOS_POR_DIA,
    `Alcanzaste el límite de ${MAX_VIDEOS_POR_DIA} videos por día. Inténtalo mañana.`
  );
}
