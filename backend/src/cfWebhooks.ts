import * as crypto from "crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import {
  enqueueAudienceFanout,
  notifyLiveVodReadyOwner,
  liveAudience,
} from "./notifications";
import { claimWebhookEvent } from "./webhookEvents";

if (!getApps().length) initializeApp();

const db = getFirestore();

export const cfWebhookSecret = defineSecret("CF_WEBHOOK_SECRET");
export const cfAccountId = defineSecret("CF_ACCOUNT_ID");
export const cfApiToken = defineSecret("CF_API_TOKEN");

type CFStreamEvent = {
  uid?: string;
  readyToStream?: boolean;
  status?: { state?: string };
  meta?: { name?: string };
};

type CFVideoResult = {
  uid: string;
  readyToStream?: boolean;
  liveInput?: string;
  playback?: { hls?: string; dash?: string };
};

// Ventana de frescura de la firma. El timestamp SÍ entra en el HMAC, así que un
// atacante no puede refrescarlo sin el secreto: acotarla cierra el replay de una
// petición legítima capturada.
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

type CFSignatureCheck =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "malformed" | "mismatch" | "stale" };

// CF signature format: "time=<ts>,sig1=<hmac_hex>"
// HMAC is computed over "<timestamp>.<body>"
function verifyCFSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
  nowMs: number
): CFSignatureCheck {
  const timeMatch = sigHeader.match(/time=(\d+)/);
  const sig1Match = sigHeader.match(/sig1=([a-f0-9]+)/);
  if (!timeMatch || !sig1Match) return { ok: false, reason: "malformed" };

  const timestamp = Number(timeMatch[1]);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "malformed" };

  const payload = `${timeMatch[1]}.${rawBody}`;
  // Trim the secret to handle trailing whitespace/newlines from Secret Manager
  const expected = crypto.createHmac("sha256", secret.trim()).update(payload).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(sig1Match[1], "hex");
  // timingSafeEqual lanza si difieren en longitud; comparar antes evita el throw.
  if (expectedBuf.length !== receivedBuf.length) return { ok: false, reason: "mismatch" };
  if (!crypto.timingSafeEqual(expectedBuf, receivedBuf)) return { ok: false, reason: "mismatch" };

  // CF manda el timestamp en segundos UNIX.
  if (Math.abs(nowMs - timestamp * 1000) > SIGNATURE_TOLERANCE_MS) {
    return { ok: false, reason: "stale" };
  }

  return { ok: true, timestamp };
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

async function getRecordingsForLiveInput(
  accountId: string,
  apiToken: string,
  liveInputId: string
): Promise<CFVideoResult[]> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${liveInputId}/videos`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { result?: CFVideoResult[] };
    return body.result ?? [];
  } catch {
    return [];
  }
}

export const cfWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [cfWebhookSecret, cfAccountId, cfApiToken],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const rawBody = req.rawBody?.toString("utf8") ?? "";

    // FAIL-CLOSED. Antes solo se verificaba `if (sigHeader && secret)`, así que
    // omitir la cabecera saltaba la autenticación entera y cualquiera podía
    // fabricar eventos de Cloudflare contra este endpoint, que escribe con
    // privilegios Admin sobre el estado del live, el post, los aros y el VOD.
    const secret = cfWebhookSecret.value().trim();
    if (!secret) {
      logger.error("cfWebhook CF_WEBHOOK_SECRET ausente — se rechaza todo el tráfico");
      res.status(500).json({ error: "Webhook secret not configured" });
      return;
    }

    const sigHeader = req.headers["webhook-signature"];
    if (typeof sigHeader !== "string" || !sigHeader) {
      logger.warn("cfWebhook sin cabecera de firma");
      res.status(401).json({ error: "Missing signature" });
      return;
    }

    const signature = verifyCFSignature(rawBody, sigHeader, secret, Date.now());
    if (!signature.ok) {
      logger.warn("cfWebhook firma rechazada", { reason: signature.reason });
      res.status(401).json({ error: "Invalid signature" });
      return;
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

    logger.info("cfWebhook received", { state, uid: liveInputId, readyToStream: event.readyToStream, meta: event.meta?.name });

    if (!liveInputId || !state) {
      res.status(200).json({ received: true });
      return;
    }

    // Idempotencia. La clave es el payload firmado completo, así que una entrega
    // repetida colisiona pero dos eventos distintos del mismo live input (p. ej.
    // dos transmisiones diferentes) no. `create()` falla si el doc ya existe, o
    // sea que el reclamo es atómico — no hay ventana get→procesar→set por la que
    // se cuelen dos entregas concurrentes y se dupliquen los avisos.
    const eventKey = crypto
      .createHash("sha256")
      .update(`${signature.timestamp}.${rawBody}`)
      .digest("hex");
    const claim = await claimWebhookEvent("cfWebhookEvents", eventKey, {
      state,
      liveInputId,
      signedAt: signature.timestamp,
    });
    if (!claim.claimed) {
      logger.info("cfWebhook entrega duplicada, ignorada", { state, uid: liveInputId });
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    const accountId = cfAccountId.value().trim();
    const apiToken = cfApiToken.value().trim();

    try {
      if (state === "live-inprogress") {
        const result = await findPostByLiveInput(liveInputId, event.meta?.name);
        if (result) {
          const now = FieldValue.serverTimestamp();
          const postId = result.ref.id;
          const authorId = typeof result.data.authorId === "string" ? result.data.authorId : null;
          const groupId = typeof result.data.groupId === "string" ? result.data.groupId : null;

          const broadcastGroupIds: string[] = Array.isArray(
            (result.data.liveData as Record<string, unknown> | undefined)?.broadcastGroupIds
          )
            ? ((result.data.liveData as Record<string, unknown>).broadcastGroupIds as string[]).filter(
                (id) => typeof id === "string" && id && id !== groupId
              )
            : [];

          const updates: Promise<unknown>[] = [
            result.ref.update({
              "liveData.status": "live",
              "liveData.startedAt": now,
              createdAt: now,
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
          for (const gid of broadcastGroupIds) {
            updates.push(db.collection("groups").doc(gid).update({ activeLivePostId: postId }));
          }
          await Promise.all(updates);
          logger.info("cfWebhook live-inprogress", { liveInputId, postId });

          // Aviso "está en vivo" a la audiencia — solo al pasar A live (evita
          // duplicar si el webhook se repite estando ya en vivo).
          const prevStatus = (result.data.liveData as Record<string, unknown> | undefined)?.status;
          if (authorId && prevStatus !== "live") {
            try {
              const a = liveAudience(result.data, postId);
              await enqueueAudienceFanout({
                notifType: "live_started",
                postId,
                authorId,
                actor: a.actor,
                target: a.target,
                groupIds: a.groupIds,
                includeFollowers: a.includeFollowers,
              });
            } catch (notifErr) {
              logger.error("cfWebhook live_started notify failed", {
                postId,
                err: notifErr instanceof Error ? notifErr.message : String(notifErr),
              });
            }
          }
        } else {
          logger.warn("cfWebhook live-inprogress: post not found", { liveInputId });
        }
      } else if (state === "live-finished") {
        const result = await findPostByLiveInput(liveInputId, event.meta?.name);
        if (result) {
          const currentStatus = (result.data.liveData as Record<string, unknown> | undefined)?.status;
          const now = FieldValue.serverTimestamp();
          const postId = result.ref.id;
          const authorId = typeof result.data.authorId === "string" ? result.data.authorId : null;
          const groupId = typeof result.data.groupId === "string" ? result.data.groupId : null;

          const wasPinnedInGroup = result.data.isPinnedInGroup === true;
          const wasPinnedOnProfile = result.data.isPinnedOnProfile === true;

          const baseUpdate: Record<string, unknown> = {
            updatedAt: now,
          };

          if (currentStatus !== "ended") {
            baseUpdate["liveData.status"] = "ended";
            baseUpdate["liveData.endedAt"] = now;
            // CF streams always auto-unpin when the broadcast ends
            if (wasPinnedInGroup) {
              baseUpdate.isPinnedInGroup = false;
              baseUpdate.groupPinnedAt = null;
              baseUpdate.groupPinnedBy = null;
            }
            if (wasPinnedOnProfile) {
              baseUpdate.isPinnedOnProfile = false;
              baseUpdate.profilePinnedAt = null;
              baseUpdate.profilePinnedBy = null;
            }
          }

          const updates: Promise<unknown>[] = [result.ref.update(baseUpdate)];

          if (currentStatus !== "ended") {
            const stopBroadcastGroupIds: string[] = Array.isArray(
              (result.data.liveData as Record<string, unknown> | undefined)?.broadcastGroupIds
            )
              ? ((result.data.liveData as Record<string, unknown>).broadcastGroupIds as string[]).filter(
                  (id) => typeof id === "string" && id && id !== groupId
                )
              : [];

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
            for (const gid of stopBroadcastGroupIds) {
              updates.push(db.collection("groups").doc(gid).update({ activeLivePostId: FieldValue.delete() }));
            }
            if (wasPinnedOnProfile && authorId) {
              updates.push(
                db.collection("users").doc(authorId).collection("profileFeed").doc(postId).set(
                  { isPinnedOnProfile: false, profilePinnedAt: null, profilePinnedBy: null, updatedAt: now, syncedAt: now },
                  { merge: true }
                )
              );
            }
          }

          await Promise.all(updates);
          logger.info("cfWebhook live-finished", { liveInputId, postId, previousStatus: currentStatus, wasPinnedInGroup, wasPinnedOnProfile });

          // Check immediately if a recording is already available (edge case: very short timeout)
          if (accountId && apiToken) {
            const recordings = await getRecordingsForLiveInput(accountId, apiToken, liveInputId);
            const readyRec = recordings.find((r) => r.readyToStream && r.playback?.hls);
            if (readyRec) {
              await result.ref.update({
                "liveData.vodStatus": "ready",
                updatedAt: FieldValue.serverTimestamp(),
              });
              logger.info("cfWebhook recording already ready at live-finished", { liveInputId, videoUid: readyRec.uid });
            } else {
              logger.info("cfWebhook no ready recording at live-finished", { liveInputId, count: recordings.length });
            }
          }
        } else {
          logger.warn("cfWebhook live-finished: post not found", { liveInputId });
        }
      } else if (state === "ready") {
        logger.info("cfWebhook state=ready", { uid: liveInputId, readyToStream: event.readyToStream });

        if (!event.readyToStream) {
          // Live input going idle without a recording ready — nothing to do
          res.status(200).json({ received: true });
          return;
        }

        // event.uid could be a VIDEO uid (recording) or a LIVE INPUT uid.
        // Try video lookup first.
        const videoUid = liveInputId;
        let resolvedInputId: string | null = null;
        let vodHlsUrl: string | null = null;

        if (accountId && apiToken) {
          try {
            const cfRes = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoUid}`,
              { headers: { Authorization: `Bearer ${apiToken}` } }
            );
            if (cfRes.ok) {
              const cfBody = (await cfRes.json()) as { result?: CFVideoResult };
              if (cfBody.result?.liveInput) {
                // It IS a video — liveInput field points to the live input uid
                resolvedInputId = cfBody.result.liveInput;
                vodHlsUrl = cfBody.result.playback?.hls ?? null;
                logger.info("cfWebhook resolved video → live input", { videoUid, resolvedInputId });
              }
            } else if (cfRes.status === 404) {
              // uid is a live input, not a video — check recordings for this live input
              if (accountId && apiToken) {
                const recordings = await getRecordingsForLiveInput(accountId, apiToken, videoUid);
                const readyRec = recordings.find((r) => r.readyToStream && r.playback?.hls);
                if (readyRec) {
                  resolvedInputId = videoUid;
                  vodHlsUrl = readyRec.playback?.hls ?? null;
                  logger.info("cfWebhook found recording for live input", { liveInputId: videoUid, videoUid: readyRec.uid });
                } else {
                  // Live input going idle with no recording — do nothing
                  logger.info("cfWebhook live input idle, no recording", { liveInputId: videoUid });
                  res.status(200).json({ received: true });
                  return;
                }
              }
            }
          } catch (fetchErr) {
            logger.warn("cfWebhook state=ready CF API error", {
              videoUid,
              err: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
            });
          }
        }

        if (!resolvedInputId) {
          // Could not resolve — skip
          res.status(200).json({ received: true });
          return;
        }

        const result = await findPostByLiveInput(resolvedInputId, event.meta?.name);
        if (result) {
          const liveStatus = (result.data.liveData as Record<string, unknown> | undefined)?.status;
          const prevVod = (result.data.liveData as Record<string, unknown> | undefined)?.vodStatus;
          if (liveStatus === "ended") {
            const updatePayload: Record<string, unknown> = {
              "liveData.vodStatus": "ready",
              updatedAt: FieldValue.serverTimestamp(),
            };
            await result.ref.update(updatePayload);
            logger.info("cfWebhook recording ready → vodStatus=ready", { videoUid, resolvedInputId, vodHlsUrl });

            // Aviso "VOD listo": al creador + fan-out a la audiencia. Solo la
            // primera vez que el VOD queda listo (evita duplicar si se repite).
            if (prevVod !== "ready") {
              const a = liveAudience(result.data, result.ref.id);
              if (a.authorId) {
                try {
                  await enqueueAudienceFanout({
                    notifType: "live_vod_ready",
                    postId: result.ref.id,
                    authorId: a.authorId,
                    actor: a.actor,
                    target: a.target,
                    groupIds: a.groupIds,
                    includeFollowers: a.includeFollowers,
                  });
                  await notifyLiveVodReadyOwner({
                    postId: result.ref.id,
                    authorId: a.authorId,
                    creatorName: a.creatorName,
                    creatorAvatar: a.creatorAvatar,
                    target: a.target,
                  });
                } catch (notifErr) {
                  logger.error("cfWebhook live_vod_ready notify failed", {
                    postId: result.ref.id,
                    err: notifErr instanceof Error ? notifErr.message : String(notifErr),
                  });
                }
              }
            }
          } else {
            logger.warn("cfWebhook state=ready but liveStatus not ended", { resolvedInputId, liveStatus });
          }
        } else {
          logger.warn("cfWebhook state=ready: post not found", { resolvedInputId });
        }
      }
    } catch (err) {
      logger.error("cfWebhook processing error", {
        state,
        liveInputId,
        err: err instanceof Error ? err.message : String(err),
      });
      // Liberar el reclamo: si no, el reintento de Cloudflare se descartaría
      // como duplicado y el evento quedaría perdido.
      await claim.release();
      res.status(500).json({ error: "Processing failed" });
      return;
    }

    await claim.confirm();
    res.status(200).json({ received: true });
  }
);
