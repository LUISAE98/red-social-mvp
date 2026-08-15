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

/** Atajo para las subidas de video, que son las tres que comparten el techo. */
export async function consumeVideoUploadQuota(uid: string): Promise<void> {
  await consumeDailyQuota(
    uid,
    "videoUpload",
    MAX_VIDEOS_POR_DIA,
    `Alcanzaste el límite de ${MAX_VIDEOS_POR_DIA} videos por día. Inténtalo mañana.`
  );
}
