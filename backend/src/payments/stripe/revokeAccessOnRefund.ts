/**
 * Quita el acceso comprado cuando el dinero se devuelve.
 *
 * ── El problema (B6-C03) ─────────────────────────────────────────────────────
 * El reconciliador de reembolsos revertía el asiento del ledger y nada más. El
 * comprador recuperaba el dinero y **conservaba lo comprado**: el post de pago,
 * la entrada del directo, la comunidad. Un paywall que se cruza pidiendo el
 * dinero de vuelta al banco no es un paywall.
 *
 * ── Alcance, que es lo que decide qué se toca ────────────────────────────────
 * Las devoluciones que el usuario pide DENTRO de Vibra solo existen para saludo,
 * consejo, sesión exclusiva y tiempo contigo — servicios que se entregan en
 * persona, no accesos permanentes— y ese camino ya está resuelto.
 *
 * Lo que llega aquí es lo OTRO: contracargos con el banco y reembolsos hechos
 * desde el panel de Stripe. Ahí sí hay que retirar el acceso.
 *
 * ⚠️ **No se veta la recompra** (decisión de Luis, 2026-08-15). Se retira lo
 * comprado y punto: si la persona quiere volver a comprarlo, puede.
 */

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Retira lo que se hubiera concedido por esta compra.
 *
 * Nunca lanza: el reembolso ya ocurrió y revertir el ledger es lo prioritario.
 * Si algo aquí falla se registra y se sigue, para no dejar el asiento sin
 * revertir por culpa de una limpieza.
 */
export async function revokeAccessForSource(
  sourceType: string,
  sourceId: string,
  motivo: string
): Promise<void> {
  try {
    switch (sourceType) {
      // Post premium / VOD de pago. `sourceId` = `${postId}_${uid}`.
      case "postAccess":
        await revocarDoc(`postAccess/${sourceId}`, motivo);
        break;

      // Entrada a un directo. El earning se registró con `${liveId}_${uid}`,
      // pero el acceso vive en `liveAccess/{liveId}/users/{uid}`.
      case "liveAccess": {
        const corte = sourceId.indexOf("_");
        if (corte <= 0) break;
        const liveId = sourceId.slice(0, corte);
        const uid = sourceId.slice(corte + 1);
        await revocarDoc(`liveAccess/${liveId}/users/${uid}`, motivo);
        break;
      }

      // Suscripción a comunidad. `sourceId` = `${groupId}_${uid}_${invoiceId}`.
      // Se retira la membresía y se marca la suscripción, que es lo que mira el
      // resto del sistema para dar acceso.
      case "groupSubscription": {
        const partes = sourceId.split("_");
        if (partes.length < 2) break;
        const [groupId, uid] = partes;
        await revocarDoc(`groupSubscriptions/${groupId}_${uid}`, motivo, {
          active: false,
          status: "refunded",
        });
        await db
          .doc(`groups/${groupId}/members/${uid}`)
          .delete()
          .catch(() => undefined);
        await db
          .doc(`users/${uid}/groupMemberships/${groupId}`)
          .delete()
          .catch(() => undefined);
        break;
      }

      // El resto son servicios que se entregan (saludos, sesiones, donaciones,
      // supercomentarios): no conceden un acceso permanente que retirar, y su
      // devolución dentro de Vibra ya tiene su propio camino.
      default:
        return;
    }

    logger.info("revokeAccessOnRefund: acceso retirado", { sourceType, sourceId, motivo });
  } catch (error) {
    logger.error("revokeAccessOnRefund: no se pudo retirar el acceso", {
      sourceType,
      sourceId,
      motivo,
      error,
    });
  }
}

/**
 * Marca el documento como revocado en vez de borrarlo.
 *
 * Se conserva para poder investigar una disputa después: quién compró, cuándo y
 * por qué se le retiró. Lo que decide el acceso es el estado, no la existencia.
 */
async function revocarDoc(
  ruta: string,
  motivo: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const ref = db.doc(ruta);
  const snap = await ref.get();
  if (!snap.exists) return;

  await ref.set(
    {
      status: "revoked",
      revoked: true,
      revokedReason: motivo,
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...extra,
    },
    { merge: true }
  );
}
