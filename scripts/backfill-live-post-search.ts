import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";
import {
  buildSearchPrefixes,
  normalizeSearchText,
  tokenizeSearchText,
} from "../lib/search/normalize";

// Reindexa los posts de tipo live/scheduled_event que no tienen search.prefixes
// (lives creados antes de que existiera el índice de búsqueda), para que aparezcan
// en la búsqueda de posts. Es aditivo e idempotente: sólo toca lives sin prefijos.

const POST_SEARCH_INDEX_VERSION = 2;

function initializeAdmin() {
  if (admin.apps.length) return;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ??
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ??
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en .env.local"
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

function pickVisibility(value: unknown): "public" | "private" | "hidden" | null {
  if (value === "public" || value === "private" || value === "hidden") return value;
  return null;
}

function hasPrefixes(data: FirebaseFirestore.DocumentData): boolean {
  const search =
    data.search && typeof data.search === "object" ? data.search : null;
  return !!search && Array.isArray(search.prefixes) && search.prefixes.length > 0;
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();

  const groupVisibilityCache = new Map<string, "public" | "private" | "hidden" | null>();

  async function resolveVisibility(
    data: FirebaseFirestore.DocumentData
  ): Promise<"public" | "private" | "hidden"> {
    // Perfil → siempre public (así se indexa en la app).
    if (data.contextType === "profile") return "public";

    const direct =
      pickVisibility(data.groupVisibility) ??
      pickVisibility(data.search?.groupVisibility) ??
      pickVisibility(data.search?.visibility);
    if (direct) return direct;

    const groupId =
      typeof data.groupId === "string" && data.groupId.trim() ? data.groupId.trim() : null;
    if (!groupId) return "public";

    if (!groupVisibilityCache.has(groupId)) {
      const snap = await db.collection("groups").doc(groupId).get();
      groupVisibilityCache.set(
        groupId,
        snap.exists ? pickVisibility(snap.data()?.visibility) : null
      );
    }
    return groupVisibilityCache.get(groupId) ?? "public";
  }

  const postTypes = ["live", "scheduled_event"];
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let total = 0;

  for (const postType of postTypes) {
    const snap = await db.collection("posts").where("postType", "==", postType).get();
    console.log(`postType=${postType}: ${snap.size} encontrados`);

    for (const doc of snap.docs) {
      total += 1;
      try {
        const data = doc.data();

        if (hasPrefixes(data)) {
          unchanged += 1;
          continue;
        }

        const text: string =
          typeof data.text === "string" ? data.text : "";
        const textNormalized = normalizeSearchText(text);
        const tokens = tokenizeSearchText(text);
        const prefixes = buildSearchPrefixes(tokens, {
          minLength: 2,
          maxLength: 20,
          maxPrefixes: 120,
        });

        if (prefixes.length === 0) {
          // Sin título indexable — no se puede hacer buscable por texto.
          unchanged += 1;
          console.log(`SKIP ${doc.ref.path} -> sin título indexable`);
          continue;
        }

        const visibility = await resolveVisibility(data);
        const createdAt =
          data.search?.createdAt ?? data.createdAt ?? admin.firestore.Timestamp.now();

        await doc.ref.set(
          {
            search: {
              textNormalized,
              tokens,
              prefixes,
              visibility,
              groupVisibility: visibility,
              isDeleted: data.isDeleted === true,
              createdAt,
              version: POST_SEARCH_INDEX_VERSION,
            },
          },
          { merge: true }
        );

        updated += 1;
        console.log(`UPDATED ${doc.ref.path} -> "${text.slice(0, 40)}" [${visibility}]`);
      } catch (error) {
        failed += 1;
        console.error(`FAILED ${doc.ref.path}`, error);
      }
    }
  }

  console.log("");
  console.log("Backfill live post search terminado.");
  console.log(`Total lives: ${total}`);
  console.log(`Reindexados: ${updated}`);
  console.log(`Sin cambios: ${unchanged}`);
  console.log(`Fallidos: ${failed}`);
}

main().catch((error) => {
  console.error("Backfill live post search falló:", error);
  process.exit(1);
});
