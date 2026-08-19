/**
 * Backfill de `postsCount` y `membersCount`.
 *
 * A partir de ahora los lleva el servidor (backend/src/entityCounters.ts), pero
 * los triggers solo ven lo que pasa DESPUÉS de desplegarlos: los perfiles y las
 * comunidades que ya existen necesitan su número inicial, y este script se lo
 * pone contando una vez con el Admin SDK, que no pasa por las reglas.
 *
 * Es idempotente: se puede correr las veces que haga falta. Recalcula desde la
 * fuente y solo escribe cuando el número cambia, así que tampoco arrastra un
 * error si algún trigger se perdió un evento.
 *
 *   npx tsx scripts/backfill-entity-counters.ts
 */

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
  )?.replace(/\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Faltan FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL o FIREBASE_PRIVATE_KEY en .env.local"
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();

  // ── Publicaciones por comunidad y por perfil ──────────────────────────────
  //
  // Se recorre `posts` UNA vez y se acumula en memoria. Contar por entidad con
  // una consulta cada una serían miles de lecturas para el mismo dato.
  const porGrupo = new Map<string, number>();
  const porPerfil = new Map<string, number>();

  const posts = await db.collection("posts").where("isDeleted", "==", false).get();

  for (const doc of posts.docs) {
    const d = doc.data();

    if (d.contextType === "group" && typeof d.groupId === "string" && d.groupId) {
      porGrupo.set(d.groupId, (porGrupo.get(d.groupId) ?? 0) + 1);
      continue;
    }

    if (d.contextType === "profile" && typeof d.profileId === "string" && d.profileId) {
      porPerfil.set(d.profileId, (porPerfil.get(d.profileId) ?? 0) + 1);
    }
  }

  console.log(
    `posts vivos: ${posts.size} — comunidades con posts: ${porGrupo.size}, perfiles con posts: ${porPerfil.size}`
  );

  // ── Escritura ─────────────────────────────────────────────────────────────
  //
  // Se recorren TODAS las comunidades y perfiles, no solo los que aparecieron
  // arriba: quien no tenga ninguna publicación necesita su 0 explícito, o el
  // card seguiría cayendo al respaldo por consulta.
  let gruposTocados = 0;
  const grupos = await db.collection("groups").get();

  for (const g of grupos.docs) {
    const posts = porGrupo.get(g.id) ?? 0;
    const miembros = (await g.ref.collection("members").count().get()).data().count;

    const actual = g.data();
    if (actual.postsCount === posts && actual.membersCount === miembros) continue;

    await g.ref.update({ postsCount: posts, membersCount: miembros });
    gruposTocados++;
  }

  let perfilesTocados = 0;
  const usuarios = await db.collection("users").get();

  for (const u of usuarios.docs) {
    const posts = porPerfil.get(u.id) ?? 0;
    if (u.data().postsCount === posts) continue;

    await u.ref.update({ postsCount: posts });
    perfilesTocados++;
  }

  console.log(
    `listo — comunidades actualizadas: ${gruposTocados}/${grupos.size}, perfiles: ${perfilesTocados}/${usuarios.size}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
