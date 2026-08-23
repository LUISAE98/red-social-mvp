// Rellena el importe REAL del cobro en los espejos de devolución que no lo tienen.
//
// Los espejos guardaban solo `refundedAmount`, en la moneda de liquidación, y la lista lo
// reconvertía: una devolución de 808.99 MXN se enseñaba como 825. El dato correcto está en
// el paymentIntent que originó la compra.
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

(async () => {
  const aplicar = process.argv.includes("--apply");
  const db = admin.firestore();
  const compras = await db.collectionGroup("purchases").get();
  let tocados = 0;

  for (const d of compras.docs) {
    const x = d.data();
    if (!x.refundDestination) continue;
    if (typeof x.presentmentAmount === "number" && x.presentmentAmount > 0) continue;
    const pi = await db.collection("paymentIntents").doc(`${x.sourceType}__${x.sourceId}`).get();
    const local = Number(pi.get("presentmentAmount") ?? 0);
    const cur = pi.get("presentmentCurrency");
    if (!(local > 0) || typeof cur !== "string" || !cur) {
      console.log(`   — ${x.sourceType}/${String(x.sourceId).slice(0, 8)}: sin cobro real guardado`);
      continue;
    }
    console.log(`   ${x.sourceType}/${String(x.sourceId).slice(0, 8)}: ${x.refundedAmount} → ${local} ${cur}`);
    tocados++;
    if (aplicar) {
      await d.ref.set({ presentmentAmount: local, presentmentCurrency: cur }, { merge: true });
    }
  }

  if (!tocados) { console.log("Nada que rellenar."); return; }
  console.log(aplicar ? `\nListo: ${tocados} rellenados.` : `\nEN SECO (${tocados}). Para escribir: --apply`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
