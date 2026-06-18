import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();

const db = getFirestore();
const REGION = "us-central1";
const BATCH_LIMIT = 450;

export const cleanupLiveViewersOnEnd = onDocumentUpdated(
  { document: "posts/{postId}", region: REGION },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const statusBefore = (before?.liveData as Record<string, unknown> | undefined)?.status;
    const statusAfter = (after?.liveData as Record<string, unknown> | undefined)?.status;

    if (statusAfter !== "ended" || statusBefore === "ended") return;

    const { postId } = event.params;
    logger.info(`[liveViewersCleanup] Live ended for post ${postId}, cleaning up liveViewers`);

    const viewersRef = db.collection("posts").doc(postId).collection("liveViewers");
    let deleted = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snap = await viewersRef.limit(BATCH_LIMIT).get();
      if (snap.empty) break;

      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;

      if (snap.size < BATCH_LIMIT) break;
    }

    logger.info(`[liveViewersCleanup] Deleted ${deleted} viewer docs for post ${postId}`);
  }
);
