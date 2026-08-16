/**
 * ¿La cuenta que llama sigue habilitada?
 *
 * ── Por qué hace falta si el baneo ya funciona ───────────────────────────────
 * `blockUser` (`moderation.ts`) deshabilita la cuenta en Firebase Auth y revoca
 * sus refresh tokens, así que un baneado no puede acuñar llaves nuevas. Pero la
 * llave que ya tuviera en la mano **sigue siendo válida hasta ~1 hora**: es como
 * funciona un JWT, no un fallo de la implementación. Durante esa hora podía
 * seguir llamando funciones: gastar la cuota de videos, disparar renders o
 * intentar cobros.
 *
 * Esta comprobación cierra esa ventana **donde duele** —dinero y recursos que
 * cuestan factura— y no en las 98 callables (decisión de Luis, opción B del
 * 2026-08-15). Ponerla en todas obligaría a una lectura extra en cada llamada de
 * cada usuario, todo el día, para un caso que ocurre de tarde en tarde.
 *
 * Efecto secundario buscado: hasta ahora marcar `platformBanned` A MANO en la
 * consola no bloqueaba nada, porque lo que bloquea de verdad es Firebase Auth.
 * Con esto, esa marca también surte efecto en las funciones protegidas.
 */

import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Lanza si la cuenta está baneada de la plataforma.
 *
 * ⚠️ Una ficha que no existe NO es un baneo. Los compradores invitados (sesión
 * anónima) son un flujo legítimo y muchos no tienen documento en `users`;
 * tratar su ausencia como baneo dejaría sin poder pagar a todo ese camino.
 *
 * ⚠️ Un fallo de lectura tampoco es un baneo. Si Firestore parpadea no se
 * bloquea el cobro: se registra y se sigue. Lo contrario convertiría una
 * incidencia de base de datos en una caída de los pagos, y el baneo real ya lo
 * sostiene Firebase Auth — esto solo cubre la hora de gracia del token.
 */
export async function assertAccountNotBanned(uid: string): Promise<void> {
  if (!uid) return;

  let baneado = false;
  try {
    const snap = await db.collection("users").doc(uid).get();
    baneado = snap.exists && snap.get("platformBanned") === true;
  } catch (error) {
    logger.warn("assertAccountNotBanned: no se pudo leer la cuenta", { uid, error });
    return;
  }

  if (baneado) {
    logger.warn("account_banned_blocked", { uid });
    throw new HttpsError("permission-denied", "Tu cuenta está suspendida.");
  }
}
