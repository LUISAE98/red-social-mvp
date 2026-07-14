// Cloud Function de corrida única (idempotente): rellena `liveId` en las
// entradas del ledger que pertenecen a un live y todavía no lo tienen. Las
// entradas nuevas ya lo traen desde los triggers. Reejecutarla es inofensivo.
//
// Atribución por tipo (el postId del live va embebido en sourceId, salvo VOD):
//  - live_ticket / live_donation → sourceId = `${liveId}_${...}` → liveId
//  - supercomment                → postId del sourceId, si el post es live
//  - vod_ticket                  → sourceId = accessId → leemos postAccess.postId

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

// Los ids de Firestore no llevan "_", así que el primer segmento es el postId.
function firstSegment(id: string): string {
  const i = id.indexOf("_");
  return i === -1 ? id : id.slice(0, i);
}

export const backfillWalletLives = onRequest({ region: REGION }, async (req, res) => {
  const postLiveCache = new Map<string, string | null>();

  // Devuelve postId si el post es un live (tiene liveData); si no, null.
  async function postLiveId(postId: string): Promise<string | null> {
    if (!postId) return null;
    const cached = postLiveCache.get(postId);
    if (cached !== undefined) return cached;
    let result: string | null = null;
    try {
      const snap = await db.collection("posts").doc(postId).get();
      result = snap.exists && snap.get("liveData") != null ? postId : null;
    } catch {
      result = null;
    }
    postLiveCache.set(postId, result);
    return result;
  }

  async function vodPostId(accessId: string): Promise<string | null> {
    if (!accessId) return null;
    try {
      const snap = await db.collection("postAccess").doc(accessId).get();
      const pid = snap.get("postId");
      return typeof pid === "string" && pid ? pid : null;
    } catch {
      return null;
    }
  }

  async function deriveLiveId(data: FirebaseFirestore.DocumentData): Promise<string | null> {
    const type = data.type;
    const sourceId = typeof data.sourceId === "string" ? data.sourceId : "";
    switch (type) {
      case "live_ticket":
      case "live_donation":
        return firstSegment(sourceId) || null;
      case "supercomment":
        return await postLiveId(firstSegment(sourceId));
      case "vod_ticket":
        return await vodPostId(sourceId);
      default:
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

      // Idempotencia: si ya tiene un liveId válido, no lo tocamos.
      if (typeof data.liveId === "string" && data.liveId) {
        skipped += 1;
        continue;
      }

      const liveId = await deriveLiveId(data);
      if (!liveId) {
        skipped += 1;
        continue;
      }

      batch.update(docSnap.ref, { liveId });
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
    logger.error("backfillWalletLives failed", {
      err: err instanceof Error ? err.message : String(err),
      processed,
      updated,
    });
    res.status(500).json({ error: "Backfill failed", processed, updated, skipped });
    return;
  }

  logger.info("backfillWalletLives done", { processed, updated, skipped });
  res.status(200).json({ ok: true, processed, updated, skipped });
});
