// Pasa los saldos a favor guardados en la moneda de LIQUIDACIÓN a la del COMPRADOR.
//
// Una devolución es una deuda con el comprador y tiene que valer lo que pagó. Guardada en
// otra moneda encogía o crecía sola con el tipo de cambio.
//
// Se usa el importe REAL del cobro que la originó (`presentmentAmount` del paymentIntent),
// no una conversión de hoy: así el saldo queda exactamente en lo que salió de su tarjeta.
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
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

(async () => {
  const aplicar = process.argv.includes("--apply");
  const db = admin.firestore();
  const saldos = await db.collectionGroup("buyerCredit").get();
  let tocados = 0;

  for (const d of saldos.docs) {
    if (d.id !== "current") continue;
    const balance = Number(d.data()?.balance ?? 0);
    const moneda = String(d.data()?.currency ?? "USD");
    if (!(balance > 0) || moneda !== "USD") continue;

    const uid = d.ref.parent.parent!.id;
    // Movimientos de emisión que lo componen.
    const movs = await db.collection("users").doc(uid).collection("buyerCreditMovements").get();
    let enLocal = 0;
    let monedaLocal: string | null = null;
    let completo = true;

    for (const m of movs.docs) {
      if (m.data()?.type !== "issued") continue;
      const st = String(m.data()?.sourceType ?? "");
      const si = String(m.data()?.sourceId ?? "");
      const pi = await db.collection("paymentIntents").doc(`${st}__${si}`).get();
      const local = Number(pi.get("presentmentAmount") ?? 0);
      const cur = pi.get("presentmentCurrency");
      if (local > 0 && typeof cur === "string") {
        if (monedaLocal && monedaLocal !== cur) { completo = false; break; }
        monedaLocal = cur;
        enLocal = r2(enLocal + local);
      } else {
        completo = false;
      }
    }

    console.log(`comprador ${uid}`);
    console.log(`   saldo actual: ${balance} USD`);
    if (!completo || !monedaLocal || !(enLocal > 0)) {
      console.log(`   ⚠️  sin cobro real que lo respalde — se deja como está`);
      continue;
    }
    console.log(`   → ${enLocal} ${monedaLocal} (importe real de sus cobros)`);
    tocados++;
    if (aplicar) {
      await d.ref.set({ balance: enLocal, currency: monedaLocal, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      console.log(`   ✓ migrado`);
    }
  }

  if (!tocados) { console.log("\nNada que migrar."); return; }
  console.log(aplicar ? `\nListo: ${tocados} migrados.` : `\nEN SECO (${tocados}). Para escribir: --apply`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
