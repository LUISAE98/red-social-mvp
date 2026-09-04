// Qué documentos mensuales existen y cuáles están timbrados de verdad.
//
// Un CFDI existe cuando tiene folio. `timbrado: false` significa que se calculó con el
// interruptor apagado y NO se mandó nada al SAT.
import { config } from "dotenv";
import admin from "firebase-admin";

config({ path: ".env.local" });

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\n/g, "\n"),
  }),
});

const periodo = process.argv[2] ?? "2026-08";
const snap = await admin.firestore().collection("creatorMonthlyDocs").get();
const filas = snap.docs
  .filter((d) => d.id.includes(`_${periodo}_`))
  .map((d) => ({ id: d.id, ...d.data() }));

if (filas.length === 0) console.log(`Sin documentos para ${periodo}`);
for (const f of filas) {
  console.log(
    [
      f.timbrado ? "TIMBRADO" : "sin timbrar",
      f.id,
      `folio=${f.facturapiId ?? "-"}`,
      `uuid=${f.uuid ?? "-"}`,
    ].join("  ")
  );
}
process.exit(0);
