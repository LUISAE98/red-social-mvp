import * as crypto from "crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";

if (!getApps().length) initializeApp();

const db = getFirestore();

export const cfWebhookSecret = defineSecret("CF_WEBHOOK_SECRET");

type CFStreamEvent = {
  uid?: string;
  readyToStream?: boolean;
  status?: { state?: string };
  meta?: { name?: string };
};

// CF signature format: "time=<ts>,sig1=<hmac_hex>"
// HMAC is computed over "<timestamp>.<body>"
function verifyCFSignature(rawBody: string, sigHeader: string, secret: string): boolean {
  try {
    const timeMatch = sigHeader.match(/time=(\d+)/);
    const sig1Match = sigHeader.match(/sig1=([a-f0-9]+)/);
    if (!timeMatch || !sig1Match) return false;

    const timestamp = timeMatch[1];
    const received = sig1Match[1];
    const payload = `${timestamp}.${rawBody}`;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}

async function findPostByLiveInput(
  liveInputId: string,
  metaName?: string
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> } | null> {
  // Primary: query by liveInputId stored in liveData
  const q = await db
    .collection("posts")
    .where("liveData.liveInputId", "==", liveInputId)
    .limit(1)
    .get();
  if (!q.empty) return { ref: q.docs[0].ref, data: q.docs[0].data() };

  // Fallback: extract postId from meta name "vibra-live-{postId}"
  if (metaName?.startsWith("vibra-live-")) {
    const postId = metaName.slice("vibra-live-".length);
    const snap = await db.collection("posts").doc(postId).get();
    if (snap.exists) return { ref: snap.ref, data: snap.data()! };
  }

  return null;
}

export const cfWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [cfWebhookSecret],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const rawBody = req.rawBody?.toString("utf8") ?? "";
    const sigHeader = req.headers["webhook-signature"] as string | undefined;

    // Verify signature when secret is configured
    if (sigHeader && cfWebhookSecret.value()) {
      if (!verifyCFSignature(rawBody, sigHeader, cfWebhookSecret.value())) {
        logger.warn("cfWebhook invalid signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    let event: CFStreamEvent;
    try {
      event = JSON.parse(rawBody) as CFStreamEvent;
    } catch {
      res.status(400).json({ error: "Invalid JSON" });
      return;
    }

    const state = event.status?.state;
    const liveInputId = event.uid;

    if (!liveInputId || !state) {
      res.status(200).json({ received: true });
      return;
    }

    try {
      if (state === "live-inprogress") {
        const result = await findPostByLiveInput(liveInputId, event.meta?.name);
        if (result) {
          const now = FieldValue.serverTimestamp();
          const postId = result.ref.id;
          const authorId = typeof result.data.authorId === "string" ? result.data.authorId : null;
          const groupId = typeof result.data.groupId === "string" ? result.data.groupId : null;

          const updates: Promise<unknown>[] = [
            result.ref.update({
              "liveData.status": "live",
              "liveData.startedAt": now,
              updatedAt: now,
            }),
          ];
          if (authorId) {
            updates.push(
              db.collection("users").doc(authorId).update({ activeLivePostId: postId })
            );
          }
          if (groupId) {
            updates.push(
              db.collection("groups").doc(groupId).update({ activeLivePostId: postId })
            );
          }
          await Promise.all(updates);
          logger.info("cfWebhook live-inprogress", { liveInputId, postId });
        } else {
          logger.warn("cfWebhook live-inprogress: post not found", { liveInputId });
        }
      } else if (state === "live-finished") {
        const result = await findPostByLiveInput(liveInputId, event.meta?.name);
        if (result) {
          const currentStatus = (result.data.liveData as Record<string, unknown> | undefined)?.status;
          if (currentStatus !== "ended") {
            const now = FieldValue.serverTimestamp();
            const authorId = typeof result.data.authorId === "string" ? result.data.authorId : null;
            const groupId = typeof result.data.groupId === "string" ? result.data.groupId : null;

            const updates: Promise<unknown>[] = [
              result.ref.update({
                "liveData.status": "ended",
                "liveData.endedAt": now,
                updatedAt: now,
              }),
            ];
            if (authorId) {
              updates.push(
                db.collection("users").doc(authorId).update({ activeLivePostId: FieldValue.delete() })
              );
            }
            if (groupId) {
              updates.push(
                db.collection("groups").doc(groupId).update({ activeLivePostId: FieldValue.delete() })
              );
            }
            await Promise.all(updates);
          }
          logger.info("cfWebhook live-finished", { liveInputId });
        }
      }
      // state === "ready" with readyToStream === true is a recorded video asset —
      // CF Stream makes it available at the same HLS URL automatically; no extra action needed.
    } catch (err) {
      logger.error("cfWebhook processing error", {
        state,
        liveInputId,
        err: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: "Processing failed" });
      return;
    }

    res.status(200).json({ received: true });
  }
);
