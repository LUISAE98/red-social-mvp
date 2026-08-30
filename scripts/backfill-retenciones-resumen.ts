// Reconstruye los contadores de retenciones del RESUMEN de la wallet desde los asientos.
//
// 🩺 QUÉ ESTABA MAL
//
// Los asientos ya traen sus retenciones congeladas —`scripts/backfill-retenciones-ledger.ts`
// las calculó para las ventas viejas y desde el 2026-08-26 cada venta las graba al nacer—,
// pero el resumen del creador nunca las acumuló: `lifetimeRetained*` y `pendingRetained*`
// están en cero para casi todos.
//
// Eso importa porque el retiro NO se calcula recorriendo los asientos, se lee de
// `pendingRetained*`. Con esos campos en cero, el creador retiraría su neto COMPLETO y las
// retenciones nunca se le descontarían — Vibra tendría que enterar al SAT dinero que ya pagó.
//
// 🧮 DE DÓNDE SALE CADA CIFRA
//
// Los asientos son la fuente de verdad; el resumen es una caché. Así que se recalcula entero
// en vez de sumar diferencias, que es lo único que converge si el script se corre dos veces.
//
//   lifetimeRetained*  = suma de los asientos en estado "earned".
//   pendingRetained*   = lo mismo, PORQUE nadie ha retirado todavía.
//
// ⚠️ ESA SEGUNDA IGUALDAD SOLO VALE HOY. Un creador que ya hubiera retirado tendría parte de
//    esas retenciones ya enteradas, y volver a ponerlas en `pending*` se las cobraría dos
//    veces. El script se NIEGA a tocar a quien tenga `withdrawnNet > 0` y lo reporta, para
//    que se resuelva a mano en vez de en silencio.
//
// Los asientos "refunded" y "rejected" no cuentan: al revertirse, su retención dejó de
// deberse. Los "pending" tampoco: su dinero aún no entra al saldo, y la retención se acumula
// cuando se libera.
//
// ⚠️ ESCRIBE. Corre en seco por defecto; exige `--apply`.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\n/g, "\n"),
    }),
  });
}
const db = admin.firestore();

const APLICAR = process.argv.includes("--apply");

function n(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}
function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

type Acumulado = {
  isr: number;
  iva: number;
  comision: number;
  tax: number;
  earned: number;
};

async function acumularDe(uid: string): Promise<Acumulado> {
  const asientos = await db.collection("users").doc(uid).collection("walletLedger").get();
  const acc: Acumulado = { isr: 0, iva: 0, comision: 0, tax: 0, earned: 0 };
  for (const doc of asientos.docs) {
    const e = doc.data();
    if (e.status !== "earned") continue;
    acc.earned++;
    acc.isr += n(e.retenciones?.isrRetenido);
    acc.iva += n(e.retenciones?.ivaRetenido);
    acc.comision += n(e.retenciones?.ivaComision);
    acc.tax += n(e.taxAmount);
  }
  acc.isr = round2(acc.isr);
  acc.iva = round2(acc.iva);
  acc.comision = round2(acc.comision);
  acc.tax = round2(acc.tax);
  return acc;
}

async function main() {
  const resumenes = await db.collectionGroup("walletSummary").get();
  console.log(`${resumenes.size} resúmenes · modo ${APLICAR ? "APLICAR" : "SECO"}\n`);

  let tocados = 0;
  let saltados = 0;
  let iguales = 0;

  for (const doc of resumenes.docs) {
    const uid = doc.ref.parent.parent?.id;
    if (!uid) {
      console.log(`  ⚠️  ${doc.ref.path} sin uid padre, se salta`);
      saltados++;
      continue;
    }
    const d = doc.data();
    const acc = await acumularDe(uid);

    // Quien ya retiró tiene parte de esto enterado. No se adivina.
    const yaRetiro = n(d.withdrawnNet) > 0 || n(d.withdrawnGross) > 0;

    const nuevo = {
      lifetimeRetainedIsr: acc.isr,
      lifetimeRetainedIva: acc.iva,
      lifetimeCommissionVat: acc.comision,
      lifetimeTaxCollected: acc.tax,
      ...(yaRetiro
        ? {}
        : {
            pendingRetainedIsr: acc.isr,
            pendingRetainedIva: acc.iva,
            pendingCommissionVat: acc.comision,
          }),
    };

    const cambia = Object.entries(nuevo).some(([k, v]) => Math.abs(n(d[k]) - (v as number)) > 0.005);

    console.log(`uid ${uid}  (${acc.earned} asientos ganados)`);
    console.log(
      `  life  isr ${n(d.lifetimeRetainedIsr)} → ${acc.isr}   iva ${n(d.lifetimeRetainedIva)} → ${acc.iva}   com ${n(d.lifetimeCommissionVat)} → ${acc.comision}   tax ${n(d.lifetimeTaxCollected)} → ${acc.tax}`
    );
    if (yaRetiro) {
      console.log(
        `  🚨 YA RETIRÓ (${n(d.withdrawnNet)}). No se tocan las pendientes: revisar a mano.`
      );
      saltados++;
    } else {
      console.log(
        `  pend  isr ${n(d.pendingRetainedIsr)} → ${acc.isr}   iva ${n(d.pendingRetainedIva)} → ${acc.iva}   com ${n(d.pendingCommissionVat)} → ${acc.comision}`
      );
    }

    if (!cambia) {
      console.log(`  = ya estaba bien\n`);
      iguales++;
      continue;
    }
    if (APLICAR) {
      await doc.ref.set(
        { ...nuevo, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      console.log(`  ✅ escrito\n`);
    } else {
      console.log(`  (seco)\n`);
    }
    tocados++;
  }

  console.log(
    `\nResumen · ${tocados} a corregir · ${iguales} ya correctos · ${saltados} con retiro previo sin tocar`
  );
  if (!APLICAR) console.log("Nada se escribió. Vuelve a correrlo con --apply.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
