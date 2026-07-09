// Verificación rápida del backfill: cuenta entradas y suma resúmenes.
const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, "..", "..", ".env.local");
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const clean = (v) => (v || "").replace(/^["']|["']$/g, "");

const admin = require("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: clean(env.FIREBASE_PROJECT_ID),
    clientEmail: clean(env.FIREBASE_CLIENT_EMAIL),
    privateKey: clean(env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n"),
  }),
});
const db = admin.firestore();

(async () => {
  const led = await db.collectionGroup("walletLedger").get();
  const byStatus = {};
  led.docs.forEach((d) => {
    const s = d.data().status;
    byStatus[s] = (byStatus[s] || 0) + 1;
  });

  const sum = await db.collectionGroup("walletSummary").get();
  let lifeNet = 0, pendNet = 0, refNet = 0, rejNet = 0;
  sum.docs.forEach((d) => {
    const x = d.data();
    lifeNet += x.lifetimeEarnedNet || 0;
    pendNet += x.pendingNet || 0;
    refNet += x.refundedNet || 0;
    rejNet += x.rejectedNet || 0;
  });

  console.log("Entradas en el ledger:", led.size, JSON.stringify(byStatus));
  console.log("Creadores con resumen:", sum.size);
  console.log("NETO ganado histórico total:  $" + lifeNet.toFixed(2) + " MXN");
  console.log("NETO por liberar (pendiente): $" + pendNet.toFixed(2) + " MXN");
  console.log("NETO devuelto: $" + refNet.toFixed(2) + "  |  NETO perdido (rechazado): $" + rejNet.toFixed(2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
