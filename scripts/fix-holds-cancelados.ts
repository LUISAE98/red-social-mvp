// Pone al día los documentos cuya retención SÍ se canceló en Stripe pero que se quedaron
// con `paymentStatus: "authorized"`.
//
// El rechazo cancelaba el hold y no lo anotaba en el documento, así que para el resto del
// sistema el cobro seguía vivo: el barrido del día 6 los recogía en cada pasada y al
// comprador se le seguía ofreciendo «pedir devolución» por un dinero ya devuelto.
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

const COLECCIONES = ["greetingRequests", "exclusiveSessionRequests", "meetGreetRequests"];
// Rechazadas: nadie va a entregarlas, así que su retención no debe seguir "authorized".
const SIN_ENTREGA = ["rejected", "auto_rejected_no_show"];

(async () => {
  const aplicar = process.argv.includes("--apply");
  const db = admin.firestore();
  let total = 0;

  for (const col of COLECCIONES) {
    const snap = await db.collection(col).where("paymentStatus", "==", "authorized").get();
    const afectados = snap.docs.filter((d) => SIN_ENTREGA.includes(String(d.get("status") ?? "")));
    if (!afectados.length) continue;
    console.log(`${col}: ${afectados.length}`);
    for (const d of afectados) {
      console.log(`   ${d.id} — status ${d.get("status")}`);
      if (aplicar) {
        await d.ref.update({
          paymentStatus: "canceled",
          holdCanceledAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });
      }
      total++;
    }
  }

  if (!total) { console.log("Nada que poner al día."); return; }
  console.log(aplicar ? `\nListo: ${total} puestos al día.` : `\nEN SECO (${total}). Para escribir: --apply`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
