// Repara la copia denormalizada de visibilidad en los posts que quedaron
// desincronizados ANTES de que existiera el trigger `onGroupVisibilityPostsSync`.
//
// Cada post guarda `groupVisibility` / `isShareable` / `search.visibility`, y las
// reglas deciden con esa copia. Una comunidad que pasó de pública a privada dejó
// sus posts viejos marcados como públicos y compartibles → legibles por cualquiera.
// El trigger solo cubre cambios futuros; esto arregla el pasado.
//
// La lógica de `isShareable` es un espejo de
// `backend/src/groupPostsVisibilitySync.ts` (fuente de verdad). Si cambia allá,
// cambia aquí.
//
// Uso:  npx tsx scripts/backfill-group-posts-visibility.ts [--dry]

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

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

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function resolveIsShareable(post: AnyRecord, groupVisibility: string | null): boolean {
  if (groupVisibility === "hidden") return false;

  const premium = asRecord(post.premium);
  if (premium?.enabled === true) return premium.accessMode === "public";

  const liveData = asRecord(post.liveData);
  if (liveData) {
    if (liveData.vodHidden === true) return false;
    return liveData.visibilityMode !== "members_only";
  }

  const isFree =
    (post.accessModel ?? "free") === "free" &&
    post.requiresPayment !== true &&
    post.requiresSubscription !== true;

  return isFree && groupVisibility === "public";
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  initializeAdmin();

  const db = admin.firestore();

  const groupsSnap = await db.collection("groups").get();
  console.log(`Comunidades: ${groupsSnap.size}${dryRun ? " (dry run)" : ""}`);
  console.log("");

  let scanned = 0;
  let fixed = 0;

  for (const groupDoc of groupsSnap.docs) {
    const groupVisibility =
      typeof groupDoc.data().visibility === "string"
        ? (groupDoc.data().visibility as string)
        : null;

    const postsSnap = await db
      .collection("posts")
      .where("groupId", "==", groupDoc.id)
      .get();

    for (const postDoc of postsSnap.docs) {
      scanned += 1;
      const post = postDoc.data() as AnyRecord;

      const computedShareable = resolveIsShareable(post, groupVisibility);
      const search = asRecord(post.search);

      // CONSERVADOR a propósito: sobre datos históricos solo se RESTRINGE.
      // Si el cálculo dice que un post "debería" ser compartible pero hoy no lo
      // es, se respeta el estado actual: no vamos a publicar retroactivamente
      // contenido que hoy está cerrado. Al revés (hoy abierto, debería estar
      // cerrado) sí se corrige, que es justo la fuga que motivó esto.
      const wouldWiden = post.isShareable !== true && computedShareable === true;
      const nextShareable = wouldWiden ? post.isShareable === true : computedShareable;

      const stale =
        post.groupVisibility !== groupVisibility ||
        post.isShareable !== nextShareable ||
        (!!search &&
          (search.visibility !== groupVisibility ||
            search.groupVisibility !== groupVisibility));

      if (!stale) {
        if (wouldWiden) {
          console.log(
            `SKIP   ${postDoc.ref.path}  (se deja cerrado; el cálculo lo abriría)`
          );
        }
        continue;
      }

      fixed += 1;
      console.log(
        `${dryRun ? "DRY   " : "FIX   "} ${postDoc.ref.path}  ` +
          `groupVisibility ${String(post.groupVisibility)} → ${String(groupVisibility)} · ` +
          `isShareable ${String(post.isShareable)} → ${String(nextShareable)}` +
          (wouldWiden ? "  (isShareable NO se abre: decisión conservadora)" : "")
      );

      if (dryRun) continue;

      const patch: AnyRecord = {
        groupVisibility,
        isShareable: nextShareable,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (search) {
        patch.search = { ...search, visibility: groupVisibility, groupVisibility };
      }

      await postDoc.ref.set(patch, { merge: true });
    }
  }

  console.log("");
  console.log(`Posts revisados: ${scanned} · Corregidos: ${fixed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
