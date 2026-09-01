/**
 * ¿Puede este creador retirar, y si no, qué le falta?
 *
 * `requestWithdrawal` tiene seis puertas y todas fallan con el mismo tipo de error, así que
 * desde la interfaz solo se ve «no se pudo». Esto las mira una por una y dice cuál está
 * cerrada, para no ir probando a ciegas.
 *
 * 🟢 **Solo lee.** No escribe nada ni mueve dinero.
 *
 * ── CÓMO SE CORRE ───────────────────────────────────────────────────────────────────────
 *
 *     node scripts/estado-retiro.mjs <uid-del-creador>
 *
 * El uid sale de la URL de su perfil, o del panel de administración.
 */

import "dotenv/config";
import admin from "firebase-admin";

/*
 * Las credenciales viven en `.env.local`. Se cargan con dotenv y NO a mano: la llave privada
 * es multilinea y cualquier parser que parta por saltos de linea la rompe.
 *
 *     DOTENV_CONFIG_PATH=.env.local node -r dotenv/config scripts/estado-retiro.mjs <uid>
 */

const uid = process.argv[2];
if (!uid) {
  console.error("\n  node scripts/estado-retiro.mjs <uid-del-creador>\n");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // La llave viene con los saltos de línea escapados.
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();

const ok = (b) => (b ? "✅" : "❌");
const linea = (b, titulo, detalle) =>
  console.log(`  ${ok(b)}  ${titulo.padEnd(34)} ${detalle ?? ""}`);

/* 🚨 El perfil de COBRO no vive en `users` sino en `creatorTaxProfiles`. Ahí están el sello,
   el destinatario de Stripe y el país de la cuenta; en `users` solo está el nombre. */
const [perfilSnap, resumenSnap, kycSnap, usuarioSnap] = await Promise.all([
  db.collection("creatorTaxProfiles").doc(uid).get(),
  db.collection("users").doc(uid).collection("walletSummary").doc("current").get(),
  db.collection("kyc").doc(uid).get(),
  db.collection("users").doc(uid).get(),
]);

if (!perfilSnap.exists && !usuarioSnap.exists) {
  console.error(`\nNo existe el usuario ${uid}.\n`);
  process.exit(1);
}
const p = perfilSnap.data() ?? {};
const s = resumenSnap.data() ?? {};
const k = kycSnap.data() ?? {};
const u = usuarioSnap.data() ?? {};

console.log(`\n══ ${p.displayName ?? p.username ?? uid} ══\n`);

// ── 1. Identidad ─────────────────────────────────────────────────────────
const kycAprobado = k.status === "approved" || p.kycApproved === true;
linea(kycAprobado, "1 · Identidad verificada (Didit)", `estado: ${k.status ?? "sin sesión"}`);

// ── 2. Cuenta de cobro ───────────────────────────────────────────────────
const declarada = !!p.payoutAccountDeclared;
const coincide = p.declaredAccountMatches !== false;
const stripeListo = p.stripeAccountStatus === "verified" || p.stripeAccountStatus === "active";
linea(declarada, "2a · Cuenta declarada", declarada ? "sí" : "falta el formulario");
linea(coincide, "2b · Coincide con la de Stripe", coincide ? "sí" : "🚨 NO coinciden");
linea(stripeListo, "2c · Alta en Stripe completa", `estado: ${p.stripeAccountStatus ?? "sin alta"}`);
console.log(`      destinatario: ${p.stripeRecipientId ?? "—"}`);
console.log(`      país de la cuenta: ${p.payoutAccountCountry ?? "—"}   documento: ${p.country ?? "—"}`);

// ── 3. Sello fiscal, solo para mexicanos ─────────────────────────────────
const paisDoc = String(p.country ?? p.documentCountry ?? "").toUpperCase();
const paisCuenta = String(p.payoutAccountCountry ?? "").toUpperCase();
const esMexicano =
  p.residency === "MX" || (p.residency !== "FOREIGN" && (paisDoc === "MX" || paisCuenta === "MX"));

if (esMexicano) {
  const caduca = p.csdExpiresAt?.toDate?.() ?? (p.csdExpiresAt ? new Date(p.csdExpiresAt) : null);
  const vigente = p.csdStatus === "valid" && (!caduca || caduca > new Date());
  linea(vigente, "3 · Sello digital vigente", `estado: ${p.csdStatus ?? "sin sello"}${caduca ? `, caduca ${caduca.toISOString().slice(0, 10)}` : ""}`);
} else {
  console.log("  ➖  3 · Sello digital                  no aplica, no es mexicano");
}

// ── 4. Saldo ─────────────────────────────────────────────────────────────
/*
 * 🚨 El saldo retirable es `lifetimeEarnedNet − withdrawnNet`, la MISMA cuenta que hace
 *    `requestWithdrawal`. No es `pendingNet`, que es otra cosa: el dinero de ventas todavía
 *    no liberado. Un creador puede tener `pendingNet` en cero y 300 USD retirables.
 */
const saldo = Number(s.lifetimeEarnedNet ?? 0) - Number(s.withdrawnNet ?? 0);
const MINIMO = 300; // el del tramo estándar; el de wire son 500
console.log("");
linea(saldo >= MINIMO, "4 · Saldo sobre el mínimo", `${saldo.toFixed(2)} USD de ${MINIMO} necesarios`);
console.log(`      ganado ${Number(s.lifetimeEarnedNet ?? 0).toFixed(2)} · ya retirado ${Number(s.withdrawnNet ?? 0).toFixed(2)}`);
console.log(`      IVA cobrado pendiente: ${Number(s.pendingMxVatCollected ?? 0).toFixed(2)}`);
console.log(
  `      retenciones pendientes: ISR ${Number(s.pendingRetainedIsr ?? 0).toFixed(2)} · ` +
    `IVA ${Number(s.pendingRetainedIva ?? 0).toFixed(2)} · comisión ${Number(s.pendingCommissionVat ?? 0).toFixed(2)}`
);

// ── 5. Solicitudes abiertas ──────────────────────────────────────────────
const abiertas = await db
  .collection("withdrawalRequests")
  .where("creatorId", "==", uid)
  .where("status", "in", ["pending", "approved", "sent"])
  .get();

console.log("");
linea(
  abiertas.empty,
  "5 · Sin retiro en curso",
  abiertas.empty ? "ninguno" : `🚨 ${abiertas.size} abierto(s): ${abiertas.docs.map((d) => `${d.id} (${d.data().status})`).join(", ")}`
);

console.log("\n══ Historial de retiros ══\n");
const todos = await db
  .collection("withdrawalRequests")
  .where("creatorId", "==", uid)
  .limit(15)
  .get();
if (todos.empty) {
  console.log("  Ninguno todavía.");
} else {
  for (const d of todos.docs) {
    const w = d.data();
    console.log(
      `  ${d.id}  ${String(w.status).padEnd(9)} neto ${Number(w.neto ?? 0).toFixed(2)} ${w.currency ?? ""}` +
        (w.acreditado ? `  →  ${Number(w.acreditado).toFixed(2)} ${w.acreditadoCurrency} @ ${w.tipoCambio}` : "") +
        (w.rejectionReason ? `\n      motivo: ${w.rejectionReason}` : "")
    );
  }
}

console.log("");
process.exit(0);
