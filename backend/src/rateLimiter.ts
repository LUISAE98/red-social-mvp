import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const db = getFirestore();

type RateLimitAction = "post" | "comment" | "kyc";

const LIMITS: Record<RateLimitAction, { intervalMs: number; maxPerHour: number }> = {
  post: { intervalMs: 10_000, maxPerHour: 20 },
  comment: { intervalMs: 3_000, maxPerHour: 60 },
  // KYC: cada sesión tiene costo real, así que el límite es más estricto.
  kyc: { intervalMs: 20_000, maxPerHour: 6 },
};

const INTERVAL_MESSAGE: Record<RateLimitAction, (s: number) => string> = {
  post: (s) => `Espera ${s}s antes de publicar de nuevo.`,
  comment: (s) => `Espera ${s}s antes de comentar de nuevo.`,
  kyc: (s) => `Espera ${s}s antes de reintentar la verificación.`,
};

const HOURLY_MESSAGE: Record<RateLimitAction, (n: number) => string> = {
  post: (n) => `Alcanzaste el límite de ${n} publicaciones por hora.`,
  comment: (n) => `Alcanzaste el límite de ${n} comentarios por hora.`,
  kyc: (n) => `Alcanzaste el límite de ${n} intentos de verificación por hora.`,
};

export async function checkAndRecord(uid: string, action: RateLimitAction): Promise<void> {
  const { intervalMs, maxPerHour } = LIMITS[action];
  const docRef = db.collection("rateLimits").doc(`${uid}_${action}`);
  const nowMs = Date.now();
  const oneHourAgoMs = nowMs - 60 * 60 * 1000;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);

    let lastAtMs = 0;
    let hourTimestamps: Timestamp[] = [];

    if (snap.exists) {
      const data = snap.data()!;
      const lastAt = data.lastAt as Timestamp | undefined;
      lastAtMs = lastAt ? lastAt.toMillis() : 0;
      hourTimestamps = ((data.hourTimestamps as Timestamp[]) || []).filter(
        (ts) => ts.toMillis() > oneHourAgoMs
      );
    }

    if (nowMs - lastAtMs < intervalMs) {
      const waitSec = Math.ceil((intervalMs - (nowMs - lastAtMs)) / 1000);
      throw new HttpsError("resource-exhausted", INTERVAL_MESSAGE[action](waitSec));
    }

    if (hourTimestamps.length >= maxPerHour) {
      throw new HttpsError("resource-exhausted", HOURLY_MESSAGE[action](maxPerHour));
    }

    const nowTs = Timestamp.fromMillis(nowMs);
    tx.set(docRef, {
      lastAt: nowTs,
      hourTimestamps: [...hourTimestamps, nowTs],
    });
  });
}

export const checkRateLimitPost = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  await checkAndRecord(request.auth.uid, "post");
  return { ok: true };
});

export const checkRateLimitComment = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  await checkAndRecord(request.auth.uid, "comment");
  return { ok: true };
});
