// B8-C03 / B8-H02 — repara el contenido que quedó marcado como público de
// perfiles que YA estaban cerrados antes de que existiera el disparador.
//
// Dos copias denormalizadas se escribían una sola vez, al crear, y no volvían a
// tocarse nunca:
//
//   posts/{id}.profileRestricted  → lo consultan las búsquedas públicas
//   stories/{id}.searchable       → de él depende ENTERA la regla de lectura de
//                                   historias, porque leerlo del perfil en cada
//                                   documento de un `list` agota el tope de 10
//                                   `get()` y tumba la consulta completa
//
// `onProfileRestrictionChanged` cubre los cambios futuros. Esto arregla el
// pasado: quien cerró su perfil hace meses sigue con sus historias en el feed
// público de reels, con su vídeo y su nombre.
//
// El criterio es un espejo de `backend/src/profileRestrictionSync.ts` (fuente de
// verdad). Si cambia allá, cambia aquí.
//
// Uso:  npx tsx scripts/backfill-restricted-profile-content.ts [--dry]

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

function initializeAdmin() {
  if (admin.apps.length) return;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL ?? process.env.FIREBASE_ADMIN_CLIENT_EMAIL;

  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ?? process.env.FIREBASE_ADMIN_PRIVATE_KEY
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

/** Mismo criterio que las reglas y que `profileRestrictionSync.perfilEsPublico`. */
function perfilEsPublico(perfil: AnyRecord | undefined): boolean {
  if (!perfil) return false;
  return perfil.showPosts !== false && perfil.profileRestricted !== true;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  initializeAdmin();

  const db = admin.firestore();

  console.log(dryRun ? "== SIMULACRO, no escribe nada ==" : "== EJECUCIÓN REAL ==");

  // 1. Qué perfiles están cerrados hoy.
  const usuarios = await db.collection("users").get();
  const publicoPorUid = new Map<string, boolean>();
  for (const doc of usuarios.docs) {
    publicoPorUid.set(doc.id, perfilEsPublico(doc.data()));
  }
  const cerrados = [...publicoPorUid.values()].filter((p) => !p).length;
  console.log(`perfiles: ${publicoPorUid.size} en total, ${cerrados} cerrados`);

  // 2. La visibilidad de cada comunidad, para las historias de comunidad.
  const comunidades = await db.collection("groups").get();
  const comunidadPublica = new Map<string, boolean>();
  for (const doc of comunidades.docs) {
    comunidadPublica.set(doc.id, doc.data()?.visibility === "public");
  }

  // 3. Publicaciones: la copia `profileRestricted`.
  let postsMal = 0;
  const posts = await db.collection("posts").get();
  let batch = db.batch();
  let enLote = 0;

  for (const doc of posts.docs) {
    const authorId = doc.get("authorId");
    if (typeof authorId !== "string") continue;

    // ⚠️ SOLO las publicaciones de perfil. En las de comunidad este campo vale
    // `null` a propósito (`createPost`), y las dos consultas y las dos ramas de
    // reglas que lo miran filtran antes por `contextType == "profile"`. Sin este
    // filtro el simulacro señalaba 62 documentos "mal" que en realidad estaban
    // bien, todos de comunidad.
    if (doc.get("contextType") !== "profile") continue;

    // Un autor que ya no existe se trata como cerrado: lo restrictivo.
    const publico = publicoPorUid.get(authorId) ?? false;
    const deseado = !publico;

    if (doc.get("profileRestricted") === deseado) continue;

    postsMal++;
    if (!dryRun) {
      batch.update(doc.ref, { profileRestricted: deseado });
      enLote++;
      if (enLote >= 400) {
        await batch.commit();
        batch = db.batch();
        enLote = 0;
      }
    }
  }
  if (!dryRun && enLote > 0) await batch.commit();
  console.log(`posts con la copia equivocada: ${postsMal}`);

  // 4. Historias: el `searchable`.
  let historiasMal = 0;
  const historias = await db.collection("stories").get();
  batch = db.batch();
  enLote = 0;

  for (const doc of historias.docs) {
    const creatorId = doc.get("creatorId");
    if (typeof creatorId !== "string") continue;

    const publico = publicoPorUid.get(creatorId) ?? false;
    const groupId = typeof doc.get("groupId") === "string" ? (doc.get("groupId") as string).trim() : "";
    const contextoPublico = groupId ? comunidadPublica.get(groupId) === true : true;
    const deseado = contextoPublico && publico;

    if (doc.get("searchable") === deseado) continue;

    historiasMal++;
    if (!dryRun) {
      batch.update(doc.ref, { searchable: deseado });
      enLote++;
      if (enLote >= 400) {
        await batch.commit();
        batch = db.batch();
        enLote = 0;
      }
    }
  }
  if (!dryRun && enLote > 0) await batch.commit();
  console.log(`historias con searchable equivocado: ${historiasMal}`);

  console.log(dryRun ? "Simulacro terminado, no se escribió nada." : "Listo.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
