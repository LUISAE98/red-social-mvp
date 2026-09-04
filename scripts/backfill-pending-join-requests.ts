/**
 * Backfill de `pendingJoinRequestsCount` en las comunidades.
 *
 * A partir de ahora lo lleva el servidor
 * (`backend/src/entityCounters.ts` → `onJoinRequestsPendingCount`), pero los
 * triggers solo ven lo que pasa DESPUÉS de desplegarlos: las comunidades que ya
 * existen necesitan su número inicial, y este script se lo pone contando una vez
 * con el Admin SDK, que no pasa por las reglas.
 *
 * Mismo criterio que `backfill-entity-counters.ts`: es idempotente, recalcula
 * desde la fuente y solo escribe cuando el número cambia. Se puede correr las
 * veces que haga falta, y también sirve para reparar si algún trigger se
 * perdiera un evento.
 *
 *   npx tsx scripts/backfill-pending-join-requests.ts
 *
 * ⚠️ ORDEN: desplegar PRIMERO las funciones y correr esto DESPUÉS. Al revés, las
 * solicitudes que lleguen entre el conteo y el despliegue no las cuenta nadie y
 * el número nace corto.
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

  const grupos = await db.collection("groups").get();

  let tocados = 0;
  let conPendientes = 0;

  for (const g of grupos.docs) {
    // `count()` en vez de traer los documentos: solo hace falta el número, y
    // una comunidad con muchas solicitudes no tiene por qué viajar entera.
    const pendientes = (
      await g.ref
        .collection("joinRequests")
        .where("status", "==", "pending")
        .count()
        .get()
    ).data().count;

    if (pendientes > 0) conPendientes++;

    // Se recorren TODAS las comunidades, no solo las que tienen solicitudes:
    // las demás necesitan su 0 explícito para que el globito no quede
    // dependiendo de un campo ausente.
    if (g.data().pendingJoinRequestsCount === pendientes) continue;

    await g.ref.update({ pendingJoinRequestsCount: pendientes });
    tocados++;
  }

  console.log(
    `listo — comunidades: ${grupos.size}, con solicitudes pendientes: ${conPendientes}, actualizadas: ${tocados}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
