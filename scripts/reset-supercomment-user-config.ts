// Borra las configuraciones de supercomentario del CREADOR que quedaron en MXN.
//
// Hermano de `reset-supercomment-tiers.ts`, que limpió las guardadas en cada live. Esta
// vive en otro sitio —`users/{uid}/settings/superCommentConfig`— y es la que el panel
// carga al abrir, así que era la que seguía enseñando los precios viejos.
//
// Se borra el documento entero en vez de arreglar los precios: sin él, el panel arranca
// con los niveles por defecto, ya en USD, y el creador vuelve a poner los suyos. Reescribir
// unos importes que fueron pesos como si fueran dólares es justo lo que hay que evitar.
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID!,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
    privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\n/g, "\n"),
  })});
}

(async () => {
  const aplicar = process.argv.includes("--apply");
  const snap = await admin.firestore().collectionGroup("settings").get();

  const afectadas = snap.docs.filter((d) => {
    if (d.id !== "superCommentConfig") return false;
    // Sospechosa si la moneda no es la de liquidación o si algún nivel se sale de escala.
    const moneda = d.data()?.currency;
    const tiers = (d.data()?.tiers ?? []) as Array<Record<string, unknown>>;
    return moneda !== "USD" || tiers.some((t) => Number(t?.price) > 50);
  });

  console.log(`configs revisadas: ${snap.docs.filter((d) => d.id === "superCommentConfig").length}`);
  console.log(`a limpiar: ${afectadas.length}`);
  for (const d of afectadas) {
    const tiers = (d.data()?.tiers ?? []) as Array<Record<string, unknown>>;
    console.log(`   ${d.ref.path} → ${d.data()?.currency}: ${tiers.map((t) => t?.price).join(", ")}`);
  }

  if (!afectadas.length) { console.log("\nNada que hacer."); return; }
  if (!aplicar) {
    console.log("\nEN SECO. Para escribir: npx tsx scripts/reset-supercomment-user-config.ts --apply");
    return;
  }
  for (const d of afectadas) {
    await d.ref.delete();
    console.log(`   ✓ borrada ${d.ref.path}`);
  }
  console.log(`\nListo: ${afectadas.length} configuraciones devueltas a los niveles por defecto.`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
