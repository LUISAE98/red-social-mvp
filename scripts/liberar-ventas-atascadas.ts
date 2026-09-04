import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// Suelta las ventas que se quedaron apartadas por una factura global que nunca se confirmó.
//
// EL ESTADO QUE REPARA
//
// La emisión de la global va en tres pasos —apartar, timbrar, confirmar— para que un fallo a
// la mitad no pueda timbrar la misma venta dos veces (`pendientesimpuestos.md` §A2). Si el
// timbrado falla, las ventas se quedan en `globalInvoice.estado = "emitiendo"` y **quedan
// fuera de cualquier global futura**. Es deliberado: mejor atascada y visible que colada.
//
// 🚨 PERO SOLTARLAS NO ES INOCUO. Si el CFDI SÍ llegó a timbrarse y lo que falló fue la
//    confirmación, soltarlas las devuelve al circuito y la próxima global las incluiría —
//    timbradas dos veces, que es justo lo que aquellos tres pasos evitan.
//
//    Por eso esto NO es una herramienta de rutina y no vive en el panel: se corre a mano,
//    después de comprobar en Facturapi que no existe la factura de ese periodo. Con Facturapi
//    en modo prueba el riesgo es un CFDI de prueba duplicado, sin efectos fiscales; en
//    producción hay que mirarlo antes, sin excepción.
//
// ⚠️ Se acota SIEMPRE a un creador. Una herramienta que repara a mano el estado de facturación
// no debe poder barrer la plataforma entera de un comando; y de paso la consulta usa el índice
// compuesto que ya existe, en vez de pedir uno de campo para toda la colección.
//
// Uso:
//   npx tsx scripts/liberar-ventas-atascadas.ts --creator=<uid> --dry
//   npx tsx scripts/liberar-ventas-atascadas.ts --creator=<uid>
//   npx tsx scripts/liberar-ventas-atascadas.ts --creator=<uid> --periodo=2026-08-31

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
    throw new Error("Faltan credenciales de Admin SDK en .env.local");
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function main() {
  const dry = process.argv.includes("--dry");
  const arg = process.argv.find((a) => a.startsWith("--periodo="));
  const soloPeriodo = arg ? arg.replace("--periodo=", "").trim() : null;
  const argC = process.argv.find((a) => a.startsWith("--creator="));
  const creatorId = argC ? argC.replace("--creator=", "").trim() : null;
  if (!creatorId) throw new Error("Falta --creator=<uid>");

  initializeAdmin();
  const db = getFirestore();

  console.log(
    `▶  Ventas atascadas de ${creatorId} ${soloPeriodo ? `del ${soloPeriodo}` : ""} ${
      dry ? "(DRY-RUN, sin escribir)" : ""
    }`
  );

  const snap = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("globalInvoice.estado", "==", "emitiendo")
    .get();

  const batch = db.batch();
  let sueltas = 0;
  let saltadas = 0;

  for (const d of snap.docs) {
    const g = d.get("globalInvoice") as { periodo?: string; facturapiId?: string } | undefined;
    if (soloPeriodo && g?.periodo !== soloPeriodo) continue;

    /**
     * 🚨 Con folio NO se suelta.
     *
     * Un `emitiendo` que ya tiene `facturapiId` significa que el CFDI existe y lo que falló
     * fue algo posterior. Soltarla la devolvería al circuito y se timbraría otra vez. Ese caso
     * se arregla confirmándola, no liberándola.
     */
    if (g?.facturapiId) {
      console.log(`   ⚠️  CON FOLIO, se salta: ${d.ref.path}  folio=${g.facturapiId}`);
      saltadas++;
      continue;
    }

    console.log(`   · ${d.ref.path}  periodo=${g?.periodo ?? "?"}`);
    if (!dry) batch.set(d.ref, { globalInvoice: FieldValue.delete() }, { merge: true });
    sueltas++;
  }

  if (!dry && sueltas > 0) await batch.commit();

  console.log("─".repeat(60));
  console.log(`   Atascadas encontradas ${snap.size}`);
  console.log(`   ${dry ? "Se soltarían" : "SUELTAS"}            ${sueltas}`);
  console.log(`   Saltadas por tener folio ${saltadas}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
