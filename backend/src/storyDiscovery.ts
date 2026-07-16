// Descubrimiento de historias: contador de vistas (E) + backfill de categorías
// y viewsCount (D) en historias existentes.
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";

// E — Incrementa `viewsCount` de la historia en la PRIMERA vista de cada usuario
// (el doc de vista se crea una sola vez por usuario). Como las reglas tienen
// `stories: allow update: if false`, el conteo se hace server-side.
export const onStoryViewed = onDocumentCreated(
  { document: "userStoryViews/{userId}/views/{storyId}", region: REGION },
  async (event) => {
    const storyId = event.params.storyId;
    if (!storyId) return;
    try {
      await db
        .collection("stories")
        .doc(storyId)
        .update({ viewsCount: admin.firestore.FieldValue.increment(1) });
    } catch {
      // La historia pudo haber sido borrada; ignorar.
    }
  }
);

// D — Backfill de `categories` (perfil→intereses del creador; grupo→categoría de
// la comunidad) y `viewsCount` en historias existentes. Corrida única, idempotente.
export const backfillStoryDiscovery = onRequest(
  { region: REGION, timeoutSeconds: 300, memory: "512MiB" },
  async (req, res) => {
    const interestsCache = new Map<string, string[]>();
    const groupCatCache = new Map<string, string[]>();

    async function creatorInterests(uid: string): Promise<string[]> {
      const cached = interestsCache.get(uid);
      if (cached) return cached;
      let cats: string[] = [];
      try {
        const s = await db.collection("users").doc(uid).get();
        const raw = s.data()?.interests;
        cats = Array.isArray(raw)
          ? raw.filter((x): x is string => typeof x === "string")
          : [];
      } catch {}
      interestsCache.set(uid, cats);
      return cats;
    }

    async function groupCategory(gid: string): Promise<string[]> {
      const cached = groupCatCache.get(gid);
      if (cached) return cached;
      let cats: string[] = [];
      try {
        const s = await db.collection("groups").doc(gid).get();
        const c = s.data()?.category;
        cats = typeof c === "string" && c ? [c] : [];
      } catch {}
      groupCatCache.set(gid, cats);
      return cats;
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;

    try {
      const snap = await db.collection("stories").get();
      let batch = db.batch();
      let n = 0;

      for (const d of snap.docs) {
        processed += 1;
        const data = d.data();
        const needCats = data.categories === undefined;
        const needViews = data.viewsCount === undefined;

        if (!needCats && !needViews) {
          skipped += 1;
          continue;
        }

        const update: Record<string, unknown> = {};
        if (needViews) update.viewsCount = 0;
        if (needCats) {
          if (data.source === "group" && typeof data.groupId === "string") {
            update.categories = await groupCategory(data.groupId);
          } else {
            const cid =
              (typeof data.greetingCreatorId === "string" &&
                data.greetingCreatorId) ||
              (typeof data.creatorId === "string" ? data.creatorId : null);
            update.categories = cid ? await creatorInterests(cid) : [];
          }
        }

        batch.update(d.ref, update);
        updated += 1;
        n += 1;
        if (n >= 400) {
          await batch.commit();
          batch = db.batch();
          n = 0;
        }
      }

      if (n > 0) await batch.commit();
    } catch (err) {
      logger.error("backfillStoryDiscovery failed", {
        err: err instanceof Error ? err.message : String(err),
        processed,
        updated,
      });
      res.status(500).json({ error: "failed", processed, updated, skipped });
      return;
    }

    logger.info("backfillStoryDiscovery done", { processed, updated, skipped });
    res.json({ ok: true, processed, updated, skipped });
  }
);
