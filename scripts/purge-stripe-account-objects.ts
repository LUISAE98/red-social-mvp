// Purga los objetos de Firestore que apuntan a la cuenta VIEJA de Stripe.
//
// POR QUÉ EXISTE
// Un `cus_...`, `pm_...`, `prod_...`, `pi_...` o `sub_...` sólo existe dentro de la cuenta de
// Stripe que lo creó. Al cambiar `STRIPE_SECRET_KEY` a la cuenta nueva (Vibra On, LLC), todos
// los ids guardados en Firestore quedan apuntando al vacío. No dan un error claro: dan
// "No such customer" o "No such product" en medio de un cobro.
//
// El más traicionero es `stripeConfig/communitySubscriptionProduct`: `getOrCreateSubProductId`
// (backend/src/payments/stripe/groupSubscriptionStripe.ts) lo cachea y NUNCA lo revalida, así
// que si no se borra, TODA suscripción a comunidad falla contra la cuenta nueva.
//
// ⚠️ ESTE SCRIPT BORRA. Por eso corre en seco por defecto y exige `--apply` para ejecutar,
// al revés que los backfills de esta carpeta (que sólo tocan documentos).
//
// Uso:
//   npx tsx scripts/purge-stripe-account-objects.ts                    ← simulación (no borra)
//   npx tsx scripts/purge-stripe-account-objects.ts --apply            ← borra lo crítico
//   npx tsx scripts/purge-stripe-account-objects.ts --apply --include-test-data
//   npx tsx scripts/purge-stripe-account-objects.ts --apply --include-subs
//   npx tsx scripts/purge-stripe-account-objects.ts --apply --all

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

/** Tope de escrituras por lote que acepta Firestore. */
const BATCH_LIMIT = 500;

type Stats = { found: number; deleted: number; failed: number };

/**
 * Borra todo lo que devuelva la consulta, en lotes.
 *
 * Recibe la consulta ya armada (no una ruta) para poder pasarle igual una colección
 * normal, un `collectionGroup` o una consulta filtrada.
 */
async function deleteQuery(
  label: string,
  query: admin.firestore.Query,
  apply: boolean
): Promise<Stats> {
  const stats: Stats = { found: 0, deleted: 0, failed: 0 };
  const snap = await query.get();
  stats.found = snap.size;

  console.log(`\n▸ ${label}`);
  if (snap.empty) {
    console.log("  (vacío, nada que borrar)");
    return stats;
  }
  console.log(`  encontrados: ${snap.size}`);

  if (!apply) {
    // En seco se muestran unas cuantas rutas para poder verificar que apunta a lo correcto
    // antes de borrar de verdad. Volcarlas todas no aporta y llena la terminal.
    snap.docs.slice(0, 5).forEach((d) => console.log(`  DRY  ${d.ref.path}`));
    if (snap.size > 5) console.log(`  DRY  … y ${snap.size - 5} más`);
    return stats;
  }

  const db = admin.firestore();
  for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
    const chunk = snap.docs.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    try {
      await batch.commit();
      stats.deleted += chunk.length;
      console.log(`  borrados ${stats.deleted}/${snap.size}`);
    } catch (err) {
      stats.failed += chunk.length;
      console.error(`  FALLÓ el lote ${i}-${i + chunk.length}`, err);
    }
  }
  return stats;
}

/** Borra un documento suelto. */
async function deleteDoc(label: string, path: string, apply: boolean): Promise<Stats> {
  const stats: Stats = { found: 0, deleted: 0, failed: 0 };
  const ref = admin.firestore().doc(path);
  const snap = await ref.get();

  console.log(`\n▸ ${label}`);
  if (!snap.exists) {
    console.log(`  (no existe: ${path})`);
    return stats;
  }
  stats.found = 1;
  console.log(`  encontrado: ${path}`);
  console.log(`  contenido:  ${JSON.stringify(snap.data())}`);

  if (!apply) {
    console.log(`  DRY  ${path}`);
    return stats;
  }
  try {
    await ref.delete();
    stats.deleted = 1;
    console.log("  borrado");
  } catch (err) {
    stats.failed = 1;
    console.error("  FALLÓ", err);
  }
  return stats;
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const all = argv.includes("--all");
  const includeTestData = all || argv.includes("--include-test-data");
  const includeSubs = all || argv.includes("--include-subs");

  initializeAdmin();
  const db = admin.firestore();

  console.log("═".repeat(70));
  console.log(apply ? "PURGA REAL — se van a BORRAR documentos" : "SIMULACIÓN — no se borra nada");
  console.log(`proyecto: ${process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
  console.log("═".repeat(70));

  const totals: Stats = { found: 0, deleted: 0, failed: 0 };
  const add = (s: Stats) => {
    totals.found += s.found;
    totals.deleted += s.deleted;
    totals.failed += s.failed;
  };

  // ── CRÍTICO: sin esto, la cuenta nueva no puede cobrar ──────────────────────
  console.log("\n### CRÍTICO ###");

  // Customers: `getOrCreateStripeCustomer` devuelve el id cacheado sin revalidarlo, así que
  // un `cus_` viejo rompe TODOS los cobros con "No such customer".
  add(await deleteQuery("stripeCustomers (cus_ de la cuenta vieja)", db.collection("stripeCustomers"), apply));

  // Tarjetas guardadas: `pm_` de la cuenta vieja → el cobro un-clic falla.
  // collectionGroup porque viven bajo users/{uid}/paymentMethods.
  add(
    await deleteQuery(
      "users/*/paymentMethods (pm_ de la cuenta vieja)",
      db.collectionGroup("paymentMethods"),
      apply
    )
  );

  // El producto genérico de suscripción: cacheado y nunca revalidado.
  add(
    await deleteDoc(
      "stripeConfig/communitySubscriptionProduct (prod_ cacheado)",
      "stripeConfig/communitySubscriptionProduct",
      apply
    )
  );

  // ── OPCIONAL: data de prueba de la cuenta vieja ─────────────────────────────
  if (includeTestData) {
    console.log("\n### DATA DE PRUEBA (--include-test-data) ###");
    add(await deleteQuery("paymentIntents (pi_ de la cuenta vieja)", db.collection("paymentIntents"), apply));
    add(await deleteQuery("stripeEvents (dedup de webhooks)", db.collection("stripeEvents"), apply));
  } else {
    console.log("\n### DATA DE PRUEBA — omitida (pasa --include-test-data) ###");
    console.log("  paymentIntents y stripeEvents se quedan. No rompen la cuenta nueva:");
    console.log("  los ids viejos sólo se consultarían si alguien reintenta un pago de prueba.");
  }

  // ── OPCIONAL: suscripciones ─────────────────────────────────────────────────
  if (includeSubs) {
    console.log("\n### SUSCRIPCIONES (--include-subs) ###");
    console.log("  ⚠️ Borrar estos documentos QUITA el acceso a la comunidad de esos suscriptores.");
    add(await deleteQuery("groupSubscriptions (sub_ de la cuenta vieja)", db.collection("groupSubscriptions"), apply));
  } else {
    console.log("\n### SUSCRIPCIONES — omitidas (pasa --include-subs) ###");
    console.log("  ⚠️ Sus `sub_` apuntan a la cuenta vieja: no se pueden cancelar ni renovar");
    console.log("  desde la cuenta nueva. Revísalas a mano si hay alguna que te importe.");
  }

  console.log("\n" + "═".repeat(70));
  console.log(
    apply
      ? `TOTAL — encontrados: ${totals.found} · borrados: ${totals.deleted} · fallidos: ${totals.failed}`
      : `TOTAL — se borrarían ${totals.found} documentos. Corre otra vez con --apply.`
  );
  console.log("═".repeat(70));

  if (apply) {
    console.log("\nSiguiente paso: `stripeHealthcheck` debe reportar mode/currencies de la LLC.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
