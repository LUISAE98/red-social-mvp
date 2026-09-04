// Anula el REGISTRO de un comprobante mensual para poder volver a emitirlo.
//
// 🚨 ESTO NO CANCELA EL CFDI EN FACTURAPI. Solo quita el candado que impide volver a emitir.
//
//    El candado existe para que un mes no se timbre dos veces, así que quitarlo a mano es
//    justamente desactivar una protección. En sandbox es aceptable —el CFDI viejo queda huérfano
//    y no le importa a nadie— pero **en producción esto deja dos comprobantes vivos del mismo
//    periodo**, que es exactamente lo que la máquina existe para evitar.
//
//    Para producción hace falta cancelar de verdad contra Facturapi, y eso solo lo puede hacer
//    una función desplegada, porque la llave vive como secreto de Firebase y no en `.env.local`.
//
// El registro no se borra: se copia a `creatorMonthlyDocsAnulados` con el motivo y la fecha, para
// que quede el rastro de que hubo un comprobante ahí y por qué se retiró.
//
// Uso:
//   npx tsx scripts/anular-comprobante-mensual.mjs <creatorId> <periodo> <tipo> [--hazlo]
//   npx tsx scripts/anular-comprobante-mensual.mjs OrW9osod… 2026-08 retenciones --hazlo
//
// Sin `--hazlo` solo enseña lo que haría.

import { config } from "dotenv";
import admin from "firebase-admin";

config({ path: ".env.local" });

const [creatorId, periodo, tipo] = process.argv.slice(2);
const enSerio = process.argv.includes("--hazlo");

if (!creatorId || !periodo || !tipo) {
  console.error("Faltan argumentos: <creatorId> <periodo> <tipo> [--hazlo]");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();
const id = `${creatorId}_${periodo}_${tipo}`;
const ref = db.collection("creatorMonthlyDocs").doc(id);
const snap = await ref.get();

if (!snap.exists) {
  console.log(`No existe ${id}. Nada que anular.`);
  process.exit(0);
}

const datos = snap.data();
console.log(`Documento: ${id}`);
console.log(`  timbrado: ${datos.timbrado ? "SÍ" : "no"}`);
console.log(`  folio:    ${datos.facturapiId ?? "-"}`);
console.log(`  uuid:     ${datos.uuid ?? "-"}`);

if (!enSerio) {
  console.log("\n(Simulación. Añade --hazlo para anularlo de verdad.)");
  process.exit(0);
}

await db
  .collection("creatorMonthlyDocsAnulados")
  .doc(`${id}_${Number(new Date(datos.createdAt?.toDate?.() ?? Date.now()))}`)
  .set({
    ...datos,
    idOriginal: id,
    motivo: "reemisión tras corregir las reglas de validación del SAT",
    /*
     * Se deja constancia de que el CFDI sigue vivo allá. Quien lea esto dentro de un año tiene
     * que poder saber que el folio de arriba NO está cancelado en Facturapi.
     */
    cfdiCanceladoEnFacturapi: false,
    anuladoEn: admin.firestore.FieldValue.serverTimestamp(),
  });

await ref.delete();

console.log(`\nAnulado. Archivado en creatorMonthlyDocsAnulados.`);
console.log(`⚠️ El CFDI ${datos.facturapiId ?? "-"} SIGUE VIVO en Facturapi.`);
process.exit(0);
