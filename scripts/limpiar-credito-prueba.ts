// Revierte un crédito emitido por error a un comprador, con su movimiento.
//
// Nació de una prueba: la herramienta de QA capturaba el cobro Y acreditaba de una vez,
// dejando la experiencia esperando entrega con el comprador ya reembolsado. La herramienta
// ya solo captura; esto limpia lo que quedó de antes.
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
  const arg = process.argv.find((a) => a.startsWith("--source="));
  if (!arg) { console.error("Uso: --source=<sourceType>__<sourceId>  [--apply]"); process.exit(1); }
  const [sourceType, sourceId] = arg.replace("--source=", "").split("__");
  const db = admin.firestore();

  // Localizar al comprador por el movimiento de emisión.
  const movId = `issue__${sourceType}__${sourceId}`;
  const movs = await db.collectionGroup("buyerCreditMovements").get();
  const encontrados = movs.docs.filter((d) => d.id === movId);
  if (!encontrados.length) { console.log("No hay crédito emitido por ese origen."); return; }

  for (const m of encontrados) {
    const uid = m.ref.parent.parent!.id;
    const monto = Number(m.data()?.amount ?? 0);
    const sRef = db.collection("users").doc(uid).collection("buyerCredit").doc("current");
    const s = await sRef.get();
    const saldo = Number(s.data()?.balance ?? 0);
    console.log(`comprador ${uid}`);
    console.log(`   crédito emitido: ${monto} | saldo actual: ${saldo}`);
    if (!aplicar) continue;
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(sRef);
      const b = Number(cur.data()?.balance ?? 0);
      tx.set(sRef, { balance: Math.max(0, Math.round((b - monto) * 100) / 100), updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      tx.delete(m.ref);
    });
    console.log(`   ✓ revertido`);
  }
  if (!aplicar) console.log("\nEN SECO. Para escribir: --apply");
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
