// Contador de tickets (compras) de un en vivo de pago. Cada compra confirmada crea
// liveAccess/{liveId}/users/{userId} con status "paid"; al crearse incrementamos
// `liveTicketCount` en el post. Trigger SEPARADO del ledger de wallet (onLiveAccessLedger)
// para no tocar código financiero sensible; ambos escuchan el mismo doc de forma independiente.
// Espejo de onPremiumUnlockCount (post premium).
import * as admin from "firebase-admin";
import { onDocumentCreated } from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const onLiveTicketCount = onDocumentCreated(
  { document: "liveAccess/{liveId}/users/{userId}", region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() as Record<string, unknown>;
    if (data.status !== "paid") return;

    // El doc guarda el postId real del live; si no, el id del contenedor (liveId = postId).
    const postId =
      typeof data.postId === "string" && data.postId ? data.postId : event.params.liveId;

    try {
      await db
        .collection("posts")
        .doc(postId)
        .update({ liveTicketCount: admin.firestore.FieldValue.increment(1) });
    } catch {
      // El post pudo haber sido borrado; ignorar.
    }
  }
);
