// Cloud Function de corrida única (idempotente): rellena searchPrefixes /
// searchable / creatorName en las historias que todavía NO los tienen. Las
// historias nuevas ya se crean con estos campos, así que solo procesa las
// legadas. Reejecutarla es inofensivo: si todas ya están backfilleadas, no
// escribe nada.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

// ── Normalización de búsqueda (equivalente a lib/search/normalize.ts) ─────────
const DIACRITICS = /[̀-ͯ]/g;
const NON_SEARCH = /[^a-z0-9ñ\s_-]/g;
const MULTI_SPACE = /\s+/g;

function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(NON_SEARCH, " ")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(MULTI_SPACE, " ")
    .trim();
}

function tokenize(value: unknown): string[] {
  const n = normalizeSearchText(value);
  if (!n) return [];
  const tokens = n
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens)).slice(0, 30);
}

function buildPrefixes(tokens: string[], maxPrefixes = 80): string[] {
  const prefixes = new Set<string>();
  for (const raw of tokens) {
    const token = normalizeSearchText(raw);
    if (token.length < 2) continue;
    const upper = Math.min(token.length, 20);
    for (let len = 2; len <= upper; len += 1) {
      prefixes.add(token.slice(0, len));
      if (prefixes.size >= maxPrefixes) return Array.from(prefixes);
    }
  }
  return Array.from(prefixes);
}

export const backfillStoriesSearch = onRequest({ region: REGION }, async (req, res) => {
  const userNameCache = new Map<string, string>();
  const groupPublicCache = new Map<string, boolean>();

  async function getUserName(uid: string): Promise<string> {
    const cached = userNameCache.get(uid);
    if (cached !== undefined) return cached;
    let name = "";
    try {
      const snap = await db.collection("users").doc(uid).get();
      const u = snap.data() as Record<string, unknown> | undefined;
      name =
        (typeof u?.displayName === "string" && u.displayName.trim()) ||
        [u?.firstName, u?.lastName]
          .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          .join(" ") ||
        "";
    } catch {
      name = "";
    }
    userNameCache.set(uid, name);
    return name;
  }

  async function getGroupPublic(groupId: string): Promise<boolean> {
    const cached = groupPublicCache.get(groupId);
    if (cached !== undefined) return cached;
    let isPublic = false;
    try {
      const snap = await db.collection("groups").doc(groupId).get();
      isPublic = (snap.data() as Record<string, unknown> | undefined)?.visibility === "public";
    } catch {
      isPublic = false;
    }
    groupPublicCache.set(groupId, isPublic);
    return isPublic;
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const snap = await db.collection("stories").get();
    let batch = db.batch();
    let batchCount = 0;

    for (const docSnap of snap.docs) {
      processed += 1;
      const s = docSnap.data() as Record<string, unknown>;

      // Idempotencia: si ya tiene searchPrefixes, ya fue backfilleada.
      if (Array.isArray(s.searchPrefixes)) {
        skipped += 1;
        continue;
      }

      const showcaseId =
        (typeof s.greetingCreatorId === "string" && s.greetingCreatorId) ||
        (typeof s.creatorId === "string" ? s.creatorId : "");
      const creatorName = showcaseId ? await getUserName(showcaseId) : "";
      const type = s.type === "consejo" ? "consejo" : "saludo";

      let searchable = s.source === "profile";
      if (s.source === "group" && typeof s.groupId === "string" && s.groupId) {
        searchable = await getGroupPublic(s.groupId);
      }

      const searchPrefixes = buildPrefixes(
        tokenize(`${typeof s.instructions === "string" ? s.instructions : ""} ${creatorName} ${type}`)
      );

      batch.update(docSnap.ref, { creatorName, searchable, searchPrefixes });
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
    logger.error("backfillStoriesSearch failed", {
      err: err instanceof Error ? err.message : String(err),
      processed,
      updated,
    });
    res.status(500).json({ error: "Backfill failed", processed, updated, skipped });
    return;
  }

  logger.info("backfillStoriesSearch done", { processed, updated, skipped });
  res.status(200).json({ ok: true, processed, updated, skipped });
});
