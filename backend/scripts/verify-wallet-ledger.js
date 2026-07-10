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
  const byChannel = { profile: 0, group: 0, missing: 0 };
  const groupIds = new Set();
  let withOcc = 0;
  let minD = null;
  let maxD = null;
  const months = new Set();
  led.docs.forEach((d) => {
    const s = d.data().status;
    byStatus[s] = (byStatus[s] || 0) + 1;
    const ct = d.data().channelType;
    if (ct === "group") { byChannel.group += 1; if (d.data().channelId) groupIds.add(d.data().channelId); }
    else if (ct === "profile") byChannel.profile += 1;
    else byChannel.missing += 1;
    const o = d.data().occurredAt;
    if (o && typeof o.toDate === "function") {
      withOcc += 1;
      const dt = o.toDate();
      if (!minD || dt < minD) minD = dt;
      if (!maxD || dt > maxD) maxD = dt;
      months.add(dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0"));
    }
  });
  console.log(
    "occurredAt: " + withOcc + "/" + led.size + " · rango " +
      (minD && minD.toISOString().slice(0, 10)) + " → " +
      (maxD && maxD.toISOString().slice(0, 10)) + " · meses: " +
      [...months].sort().join(", ")
  );

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
  console.log("Por canal:", JSON.stringify(byChannel), "· comunidades distintas:", groupIds.size);
  console.log("Creadores con resumen:", sum.size);
  console.log("NETO ganado histórico total:  $" + lifeNet.toFixed(2) + " MXN");
  console.log("NETO por liberar (pendiente): $" + pendNet.toFixed(2) + " MXN");
  console.log("NETO devuelto: $" + refNet.toFixed(2) + "  |  NETO perdido (rechazado): $" + rejNet.toFixed(2));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
