// Qué compras quedaron marcadas dentro de una factura global timbrada.
//
// Sirve para ejercitar la cancelación con motivo 04: hay que darle al callable un comprador y
// una compra que estén dentro de una global viva.
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

const snap = await admin.firestore().collectionGroup("purchases").get();
let n = 0;
for (const d of snap.docs) {
  const g = d.get("globalInvoice");
  if (!g) continue;
  n++;
  // El comprador es el documento padre de la subcolección `purchases`.
  const buyerId = d.ref.parent.parent?.id ?? "(sin padre)";
  console.log(
    [
      `estado=${g.estado ?? "-"}`,
      `folio=${g.facturapiId ?? "-"}`,
      `buyerId=${buyerId}`,
      `purchaseId=${d.id}`,
      `status=${d.get("status")}`,
    ].join("  ")
  );
}
if (n === 0) console.log("Ninguna compra marcada con globalInvoice.");
process.exit(0);
