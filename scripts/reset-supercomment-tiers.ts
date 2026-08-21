// Limpia los NIVELES de supercomentario que quedaron con precios en MXN.
//
// POR QUÉ EXISTE ESTE SCRIPT
// `reset-prices-for-usd.ts` reseteó los precios antes del corte a USD, pero se dejó
// `liveData.superCommentConfig.tiers`: solo limpió `liveData.ticketPrice`. Los niveles
// sobrevivieron con sus importes en pesos y, con la denominación ya en dólares, el
// servidor los cobra como dólares. Un nivel de 297 —que eran ~17 USD— pasa a cobrarse
// como 297 USD: diecisiete veces de más.
//
// POR QUÉ BORRAR Y NO CONVERTIR
// Misma razón que el reseteo original: un precio es una decisión comercial, no un dato
// convertible. Al quitar los niveles, `resolveTier` cae a `DEFAULT_TIERS`, que ya están en
// dólares (1.5 / 2.5 / 5 / 12.5 / 25) y son los que ve un live sin configurar. El creador
// vuelve a poner los suyos cuando quiera.
//
// ⚠️ ESCRIBE. Corre en seco por defecto; exige `--apply`.
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

// Por encima de esto, el importe no es un precio en dólares que nadie elegiría para un
// comentario: es un precio en pesos que se quedó sin migrar.
const TOPE_SOSPECHA = 50;

(async () => {
  const aplicar = process.argv.includes("--apply");
  const db = admin.firestore();
  const snap = await db.collection("posts").get();

  const afectados: Array<{ id: string; precios: number[] }> = [];
  for (const d of snap.docs) {
    const tiers = d.data()?.liveData?.superCommentConfig?.tiers;
    if (!Array.isArray(tiers) || !tiers.length) continue;
    const precios = tiers.map((t: Record<string, unknown>) => Number(t?.price));
    if (precios.some((p) => Number.isFinite(p) && p > TOPE_SOSPECHA)) {
      afectados.push({ id: d.id, precios });
    }
  }

  console.log(`posts revisados: ${snap.size}`);
  console.log(`con niveles en pesos: ${afectados.length}`);
  for (const a of afectados) console.log(`   ${a.id}: ${a.precios.join(", ")}`);

  if (!afectados.length) { console.log("\nNada que hacer."); return; }
  if (!aplicar) {
    console.log("\nEN SECO. Para escribir de verdad: npx tsx scripts/reset-supercomment-tiers.ts --apply");
    return;
  }

  for (const a of afectados) {
    await db.collection("posts").doc(a.id).update({
      "liveData.superCommentConfig.tiers": admin.firestore.FieldValue.delete(),
    });
    console.log(`   ✓ ${a.id} → niveles quitados, vuelve a los de por defecto en USD`);
  }
  console.log(`\nListo: ${afectados.length} lives devueltos a los niveles por defecto.`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
