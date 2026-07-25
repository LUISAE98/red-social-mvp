// Contador de desbloqueos (compras únicas) de una publicación premium / VOD.
// Cada compra confirmada crea/actualiza postAccess/{accessId} a status "active";
// al ENTRAR en "active" (una sola vez) incrementamos `premiumUnlockCount` en el post.
// Trigger SEPARADO del ledger de wallet (onPostAccessLedger) para no tocar código
// financiero sensible; ambos escuchan el mismo doc de forma independiente.
import * as admin from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

export const onPremiumUnlockCount = onDocumentWritten(
  { document: "postAccess/{accessId}", region: REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    const data = after.data() as Record<string, unknown>;
    if (data.status !== "active") return;

    // Solo al ENTRAR en "active" (evita recontar en updates posteriores).
    const before = event.data?.before;
    if (before?.exists && (before.data() as Record<string, unknown>)?.status === "active") return;

    const postId = typeof data.postId === "string" ? data.postId : null;
    if (!postId) return;

    try {
      await db
        .collection("posts")
        .doc(postId)
        .update({ premiumUnlockCount: admin.firestore.FieldValue.increment(1) });
    } catch {
      // El post pudo haber sido borrado; ignorar.
    }
  }
);
