import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  importeFiscalDeLaVenta,
  leerImporteFiscal,
} from "../backend/src/facturacion/importeFiscal";

// Backfill de los PESOS congelados de cada venta (`fiscalMxn`).
//
// Desde el 2026-09-02 cada venta congela, en el momento de ocurrir, cuántos pesos fue — con el
// tipo de cambio que de verdad se le aplicó a ese comprador. Las ventas anteriores no lo tienen,
// y **sin él no entran en la factura global**: antes se sumaban sus dólares como si fueran pesos,
// que es el error que este bloque vino a arreglar (`pendientesimpuestos.md` §A0).
//
// Para cada asiento del ledger sin `fiscalMxn`:
//   1. Busca su `paymentIntents/{sourceType__sourceId}` — comparten el id determinista.
//   2. Despeja el tipo de cambio real del cobro: presentment ÷ remanente.
//   3. Si no se puede (pago íntegro con saldo, venta que nunca pasó por Stripe), cae a
//      `config/exchangeRates`, y queda marcado `fuente: "tabla"` para poder distinguirlo.
//   4. Lo escribe en el asiento Y en el espejo `users/{buyerId}/purchases/{entryId}`.
//
// ⚠️ Solo toca ventas de comprador MEXICANO (`taxCountry === "MX"`): son las únicas que llevan
// CFDI. La venta a un extranjero es exportación y no lleva comprobante mexicano.
//
// Es idempotente: una venta que ya tiene su importe congelado se salta, nunca se recalcula. Eso
// es deliberado — un CFDI reexpedido tiene que dar el mismo número que el original.
//
// Uso:
//   npx tsx scripts/backfill-importe-fiscal.ts               (aplica a todas)
//   npx tsx scripts/backfill-importe-fiscal.ts --dry             (solo cuenta, no escribe)
//   npx tsx scripts/backfill-importe-fiscal.ts --dry --detalle   (además enumera las de tabla)
//   npx tsx scripts/backfill-importe-fiscal.ts --creator=<uid>

const PAGE_SIZE = 400;
const BATCH_LIMIT = 300;

function initializeAdmin() {
  if (getApps().length) return;

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

  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function main() {
  const dry = process.argv.includes("--dry");
  // Enumera las que caerían a la tasa de tabla, que son las únicas cuyo importe es
  // aproximado. Con pocas, se revisan a mano antes de escribir nada.
  const detalle = process.argv.includes("--detalle");
  const creatorArg = process.argv.find((a) => a.startsWith("--creator="));
  const onlyCreator = creatorArg ? creatorArg.replace("--creator=", "").trim() : null;
  initializeAdmin();
  const db = getFirestore();

  // La tasa de respaldo se lee UNA vez: es la misma para todo el backfill y no tiene sentido
  // pedirla por venta.
  const ratesSnap = await db.doc("config/exchangeRates").get();
  const tasaDeTabla = Number((ratesSnap.data()?.rates ?? {}).MXN);
  if (!Number.isFinite(tasaDeTabla) || tasaDeTabla <= 0) {
    console.warn("⚠️  Sin tasa de respaldo: las ventas sin cobro utilizable se quedarán fuera.");
  }

  let scanned = 0;
  let congelados = 0;
  let yaEstaban = 0;
  let noMexicanas = 0;
  let sinCobro = 0;
  let imposibles = 0;
  let delCobro = 0;
  let deTabla = 0;
  let last: QueryDocumentSnapshot | null = null;
  let batch = db.batch();
  let batchCount = 0;

  console.log(
    `▶  Backfill de pesos congelados ${onlyCreator ? `(solo ${onlyCreator})` : ""} ${dry ? "(DRY-RUN, sin escribir)" : ""}`
  );

  while (true) {
    let q = db.collectionGroup("walletLedger").orderBy("__name__").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const d = doc.data();
      const creatorId = doc.ref.parent.parent?.id ?? "";
      if (onlyCreator && creatorId !== onlyCreator) continue;

      if (leerImporteFiscal(d.fiscalMxn)) {
        // 🚨 Nunca se recalcula. Un CFDI reexpedido tiene que dar el mismo número.
        yaEstaban++;
        continue;
      }
      if (d.taxCountry !== "MX") {
        noMexicanas++;
        continue;
      }

      // El intent comparte el id determinista del asiento.
      const intentSnap = await db.doc(`paymentIntents/${doc.id}`).get();
      const cobro = intentSnap.exists ? intentSnap.data() ?? null : null;
      if (!cobro) sinCobro++;

      const pesos = importeFiscalDeLaVenta({
        baseUsd: Number(d.grossAmount) || 0,
        // El IVA mexicano de la venta del creador, congelado en el asiento. NO `taxAmount`,
        // que incluye el impuesto de lo que cobró Vibra y, con comprador extranjero, es el
        // impuesto de otro país.
        ivaUsd: Number(d.retenciones?.mxVatVenta) || 0,
        cobro,
        tasaDeTabla,
      });

      if (!pesos) {
        imposibles++;
        console.warn(`   ⚠️  sin poder congelar: ${creatorId}/${doc.id}`);
        continue;
      }
      if (pesos.fuente === "cobro") delCobro++;
      else deTabla++;

      /**
       * 🚨 Las de tabla, una por una si se piden.
       *
       * No hay histórico de tasas: `config/exchangeRates` es un solo documento que se
       * sobrescribe a diario, así que a una venta vieja se le acaba aplicando la tasa de HOY.
       * Para una venta de hace meses eso no es su tipo de cambio, es una aproximación — y de
       * ella saldría el importe de un CFDI.
       *
       * Por eso se pueden mirar antes de escribir nada. Con pocas, se revisan a mano.
       */
      if (detalle && pesos.fuente === "tabla") {
        const fecha =
          (d.occurredAt as { toDate?: () => Date } | undefined)?.toDate?.()
            ?.toISOString()
            .slice(0, 10) ?? "sin fecha";
        console.log(
          `   · tabla  ${doc.id.slice(0, 44).padEnd(44)} ${fecha}  ` +
            `${cobro ? "intent sin presentment MXN" : "SIN intent"}  →  ${pesos.total} MXN`
        );
      }

      congelados++;
      if (dry) continue;

      const valor = { ...pesos, congeladoEn: FieldValue.serverTimestamp() };
      batch.set(doc.ref, { fiscalMxn: valor }, { merge: true });
      batchCount++;

      // El espejo del comprador, que es de donde factura la global.
      const buyerId = typeof d.buyerId === "string" ? d.buyerId.trim() : "";
      if (buyerId) {
        batch.set(
          db.doc(`users/${buyerId}/purchases/${doc.id}`),
          { fiscalMxn: valor },
          { merge: true }
        );
        batchCount++;
      }

      if (batchCount >= BATCH_LIMIT) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  if (!dry && batchCount > 0) await batch.commit();

  console.log("─".repeat(60));
  console.log(`   Asientos revisados      ${scanned}`);
  console.log(`   Ya congelados           ${yaEstaban}`);
  console.log(`   No mexicanas (sin CFDI) ${noMexicanas}`);
  console.log(`   CONGELADOS              ${congelados}  (${delCobro} del cobro, ${deTabla} de tabla)`);
  console.log(`   Sin intent              ${sinCobro}`);
  console.log(`   ⚠️  Imposibles           ${imposibles}`);
  if (imposibles > 0) {
    console.log("      Estas ventas NO entrarán en la factura global. Revisar una a una.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
