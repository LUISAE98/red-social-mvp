// Cloud Function de corrida única (idempotente): rellena `postId` en las
// entradas del ledger de tipo premium_post y vod_ticket que aún no lo tienen.
// Esas entradas guardan `sourceId = accessId` (doc de postAccess), del cual
// leemos el postId real. Las entradas nuevas ya lo traen desde el trigger.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

const TICKET_TYPES = new Set(["premium_post", "vod_ticket"]);

export const backfillTicketPostIds = onRequest({ region: REGION }, async (req, res) => {
  async function accessPostId(accessId: string): Promise<string | null> {
    if (!accessId) return null;
    try {
      const snap = await db.collection("postAccess").doc(accessId).get();
      const pid = snap.get("postId");
      return typeof pid === "string" && pid ? pid : null;
    } catch {
      return null;
    }
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const snap = await db.collectionGroup("walletLedger").get();
    let batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
      processed += 1;
      const data = docSnap.data();

      if (!TICKET_TYPES.has(data.type)) {
        skipped += 1;
        continue;
      }
      // Idempotencia: si ya tiene postId válido, no lo tocamos.
      if (typeof data.postId === "string" && data.postId) {
        skipped += 1;
        continue;
      }

      const sourceId = typeof data.sourceId === "string" ? data.sourceId : "";
      const postId = await accessPostId(sourceId);
      if (!postId) {
        skipped += 1;
        continue;
      }

      batch.update(docSnap.ref, { postId });
      batchCount += 1;
      updated += 1;

      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();
  } catch (err) {
    logger.error("backfillTicketPostIds failed", {
      err: err instanceof Error ? err.message : String(err),
      processed,
      updated,
    });
    res.status(500).json({ error: "Backfill failed", processed, updated, skipped });
    return;
  }

  logger.info("backfillTicketPostIds done", { processed, updated, skipped });
  res.status(200).json({ ok: true, processed, updated, skipped });
});
