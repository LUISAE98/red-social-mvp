// Comprueba que el retiro de cada creador CUADRE con sus ventas, una por una.
//
// Es la verificación independiente del desglose: `calcularRetiro` trabaja con los contadores
// agregados del resumen, y este script rehace la cuenta desde los asientos, sumando el `neto`
// que el motor congeló en cada venta. Si los dos números no coinciden, el resumen se
// desincronizó del ledger y alguien va a cobrar de más o de menos.
//
// SOLO LEE. No escribe nada.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import * as admin from "firebase-admin";
import { calcularRetiro } from "../lib/tax/fiscalEngine";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

function n(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}
function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
const f = (x: number) => x.toFixed(2).padStart(10);

(async () => {
  const resumenes = await db.collectionGroup("walletSummary").get();
  let descuadres = 0;

  for (const doc of resumenes.docs) {
    const uid = doc.ref.parent.parent?.id;
    if (!uid) continue;
    const d = doc.data();

    // Lo que dice el resumen, por la vía del desglose que ve el creador.
    const saldo = round2(n(d.lifetimeEarnedNet) - n(d.withdrawnNet));
    const r = calcularRetiro({
      saldo,
      ivaCobradoPendiente: n(d.pendingMxVatCollected),
      isrPendiente: n(d.pendingRetainedIsr),
      ivaPendiente: n(d.pendingRetainedIva),
      ivaComisionPendiente: n(d.pendingCommissionVat),
    });

    // Lo que dicen los asientos, sumando la liquidación congelada de cada venta.
    const asientos = await db.collection("users").doc(uid).collection("walletLedger").get();
    let porVenta = 0;
    for (const a of asientos.docs) {
      const e = a.data();
      if (e.status !== "earned") continue;
      porVenta += n(e.retenciones?.neto);
    }
    porVenta = round2(porVenta);

    // Un centavo de tolerancia: cada asiento redondea el suyo y el agregado redondea una vez.
    const delta = round2(r.neto - porVenta);
    const cuadra = Math.abs(delta) <= 0.02;
    if (!cuadra) descuadres++;

    console.log(`\n${uid}`);
    console.log(`  saldo          ${f(saldo)}`);
    console.log(`  + IVA cobrado  ${f(n(d.pendingMxVatCollected))}`);
    console.log(`  − ISR          ${f(-n(d.pendingRetainedIsr))}`);
    console.log(`  − IVA retenido ${f(-n(d.pendingRetainedIva))}`);
    console.log(`  − IVA comisión ${f(-n(d.pendingCommissionVat))}`);
    console.log(`  = recibe       ${f(r.neto)}`);
    console.log(`    suma de sus ventas, una por una  ${f(porVenta)}   ${cuadra ? "✅" : `🔴 delta ${delta}`}`);
    if (r.ivaPorDeclarar > 0) {
      console.log(`    (de eso, ${r.ivaPorDeclarar.toFixed(2)} es IVA que declara él)`);
    }
  }

  console.log(
    `\n─────────────────────────────────────\n${resumenes.size} creadores · ${descuadres} descuadres`
  );
  process.exit(descuadres > 0 ? 1 : 0);
})();
