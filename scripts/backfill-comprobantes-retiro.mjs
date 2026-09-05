// Genera el comprobante de los retiros que ya estaban PAGADOS antes de que existiera.
//
// El enganche solo se dispara en la transición a `paid`, así que los retiros cerrados antes del
// 2026-09-05 se quedaron sin documento. Este script los recoge.
//
// 🚨 NO INVENTA NADA. Usa exactamente los mismos campos que el enganche en vivo, así que un
//    retiro de Wallbit sin conciliar sale con lo acreditado y el tipo de cambio en `null`, que
//    es la verdad. Rellenar esos huecos con supuestos sería peor que dejarlos vacíos.
//
// ⚠️ Es IDEMPOTENTE: el id del comprobante es el del retiro. Correrlo dos veces sobreescribe el
//    mismo documento, no crea duplicados.
//
// Uso:
//   npx tsx scripts/backfill-comprobantes-retiro.mjs            → simulación
//   npx tsx scripts/backfill-comprobantes-retiro.mjs --hazlo    → escribe

import { config } from "dotenv";
import admin from "firebase-admin";

config({ path: ".env.local" });

const enSerio = process.argv.includes("--hazlo");

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

const texto = (v) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : null;
};
const numeroOnulo = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const snap = await db.collection("withdrawalRequests").where("status", "==", "paid").get();
console.log(`retiros pagados: ${snap.size}`);

let creados = 0;
let yaEstaban = 0;

for (const d of snap.docs) {
  const r = d.data();
  const creatorId = String(r.creatorId ?? "");
  if (!creatorId) {
    console.log(`  ⚠️ ${d.id} sin creador, se salta`);
    continue;
  }

  const ref = db
    .collection("users")
    .doc(creatorId)
    .collection("comprobantesRetiro")
    .doc(d.id);

  if ((await ref.get()).exists) {
    yaEstaban++;
    continue;
  }

  const acreditado = numeroOnulo(r.acreditado);
  const comprobante = {
    creatorId,
    withdrawalId: d.id,
    currency: String(r.currency ?? "USD"),
    bruto: round2(num(r.saldo)),
    neto: round2(num(r.neto)),
    acreditado: acreditado === null ? null : round2(acreditado),
    monedaAcreditada: texto(r.acreditadoCurrency),
    tipoCambio: numeroOnulo(r.tipoCambio),
    route: texto(r.route),
    payoutCountry: texto(r.payoutCountry),
    cuentaLast4: texto(r.declaredAccountLast4),
    titular: texto(r.declaredHolderName),
    referencia: texto(r.outboundPaymentId) ?? texto(r.paymentReference),
    solicitadoEn: r.createdAt ?? null,
    pagadoEn: r.paidAt ?? null,
    creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    /** Para poder distinguir después lo reconstruido de lo emitido en su momento. */
    reconstruido: true,
  };

  console.log(
    `  ${d.id} · ${creatorId} · ${comprobante.neto} ${comprobante.currency}` +
      (comprobante.acreditado
        ? ` → ${comprobante.acreditado} ${comprobante.monedaAcreditada}`
        : " (sin conciliar)")
  );

  if (enSerio) {
    await ref.set(comprobante, { merge: true });
    creados++;
  }
}

console.log(
  enSerio
    ? `\nCreados ${creados}. Ya existían ${yaEstaban}.`
    : `\n(Simulación. Ya existían ${yaEstaban}. Añade --hazlo para escribir.)`
);
process.exit(0);
