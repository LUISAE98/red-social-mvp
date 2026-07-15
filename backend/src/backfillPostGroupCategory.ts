// Cloud Function de corrida única (idempotente): rellena `groupCategory` y
// `groupTags` en los posts de comunidad que aún no los tienen (descubrimiento).
// Los posts nuevos ya los traen desde post-service. Lee categoría/tags del grupo
// (cacheados para no releer el mismo grupo) y los escribe en el post.
//
// Uso: invocar el endpoint HTTP una vez tras el deploy. Es seguro re-correrlo.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const REGION = "us-central1";

type GroupMeta = { category: string | null; tags: string[] };

export const backfillPostGroupCategory = onRequest(
  { region: REGION, timeoutSeconds: 540, memory: "512MiB" },
  async (req, res) => {
    const groupCache = new Map<string, GroupMeta>();

    async function resolveGroup(groupId: string): Promise<GroupMeta> {
      const cached = groupCache.get(groupId);
      if (cached) return cached;

      let meta: GroupMeta = { category: null, tags: [] };
      try {
        const snap = await db.collection("groups").doc(groupId).get();
        const data = snap.exists ? snap.data() : null;
        const rawCategory = data?.category;
        const rawTags = data?.tags;
        meta = {
          category:
            typeof rawCategory === "string" && rawCategory ? rawCategory : null,
          tags: Array.isArray(rawTags)
            ? rawTags.filter((t): t is string => typeof t === "string")
            : [],
        };
      } catch {
        meta = { category: null, tags: [] };
      }

      groupCache.set(groupId, meta);
      return meta;
    }

    let processed = 0;
    let updated = 0;
    let skipped = 0;

    try {
      const snap = await db.collection("posts").get();
      let batch = db.batch();
      let batchCount = 0;

      for (const docSnap of snap.docs) {
        processed += 1;
        const data = docSnap.data();

        const needCategory = data.groupCategory === undefined;
        const needTags = data.groupTags === undefined;

        // Idempotencia: si ya tiene ambos, no lo tocamos.
        if (!needCategory && !needTags) {
          skipped += 1;
          continue;
        }

        const groupId =
          typeof data.groupId === "string" && data.groupId ? data.groupId : null;

        const update: Record<string, unknown> = {};

        if (data.contextType === "profile" || !groupId) {
          // Posts de perfil (o sin grupo): sin categoría/tags de comunidad.
          if (needCategory) update.groupCategory = null;
          if (needTags) update.groupTags = [];
        } else {
          const meta = await resolveGroup(groupId);
          if (needCategory) update.groupCategory = meta.category;
          if (needTags) update.groupTags = meta.tags;
        }

        batch.update(docSnap.ref, update);
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
      logger.error("backfillPostGroupCategory failed", {
        err: err instanceof Error ? err.message : String(err),
        processed,
        updated,
      });
      res
        .status(500)
        .json({ error: "Backfill failed", processed, updated, skipped });
      return;
    }

    logger.info("backfillPostGroupCategory done", {
      processed,
      updated,
      skipped,
    });
    res.status(200).json({ ok: true, processed, updated, skipped });
  }
);
