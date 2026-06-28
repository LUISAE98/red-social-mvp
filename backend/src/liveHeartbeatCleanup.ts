import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

if (!getApps().length) initializeApp();

const REGION = "us-central1";
const STALE_THRESHOLD_SECONDS = 90;

export const liveHeartbeatCleanup = onSchedule(
  { schedule: "every 1 minutes", region: REGION },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    const staleThreshold = new Timestamp(
      now.seconds - STALE_THRESHOLD_SECONDS,
      now.nanoseconds
    );

    const snapshot = await db.collection("posts")
      .where("liveData.status", "==", "live")
      .where("liveData.broadcastMode", "==", "direct")
      .get();

    if (snapshot.empty) {
      logger.info("[heartbeatCleanup] No hay lives CF directos activos.");
      return;
    }

    const batch = db.batch();
    let staleCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const heartbeatAt = data.liveData?.heartbeatAt as Timestamp | undefined;

      if (!heartbeatAt) continue;

      if (heartbeatAt.seconds < staleThreshold.seconds) {
        const authorId = data.authorId as string;
        const groupId = typeof data.groupId === "string" && data.groupId ? data.groupId : null;
        const broadcastGroupIds: string[] = Array.isArray(data.liveData?.broadcastGroupIds)
          ? (data.liveData.broadcastGroupIds as string[]).filter(
              (id) => typeof id === "string" && id && id !== groupId
            )
          : [];
        const endedAt = FieldValue.serverTimestamp();

        batch.update(doc.ref, {
          "liveData.status": "ended",
          "liveData.endedAt": endedAt,
          updatedAt: endedAt,
        });

        batch.update(db.collection("users").doc(authorId), {
          activeLivePostId: FieldValue.delete(),
        });

        if (groupId) {
          batch.update(db.collection("groups").doc(groupId), {
            activeLivePostId: FieldValue.delete(),
          });
        }

        for (const gid of broadcastGroupIds) {
          batch.update(db.collection("groups").doc(gid), {
            activeLivePostId: FieldValue.delete(),
          });
        }

        staleCount++;
        logger.warn(`[heartbeatCleanup] Live huérfano: post=${doc.id} autor=${authorId} lastHeartbeat=${heartbeatAt.toDate().toISOString()}`);
      }
    }

    if (staleCount > 0) {
      await batch.commit();
      logger.info(`[heartbeatCleanup] ${staleCount} live(s) terminados por falta de heartbeat.`);
    } else {
      logger.info(`[heartbeatCleanup] ${snapshot.size} live(s) revisados, todos con heartbeat activo.`);
    }
  }
);
