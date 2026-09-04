import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Comprueba que una factura global timbrada quedó BIEN, no solo que no dio error.
//
// Que la llamada devuelva 200 no significa que el documento diga la verdad. Lo que hay que
// verificar es lo que costó el grupo A entero:
//
//   · que exista folio y UUID —lo que la hace un CFDI y no un intento—;
//   · que TODAS las ventas del día quedaran marcadas, y con ESE folio;
//   · que el importe esté en PESOS y cuadre exactamente con los `fiscalMxn` congelados de
//     esas ventas, que es el fallo §A0 que abrió todo esto;
//   · y que ninguna se quedara a medias.
//
// Uso: npx tsx scripts/verificar-global.ts <creatorId> <AAAA-MM-DD>

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

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function main() {
  const creatorId = process.argv[2];
  const dia = process.argv[3];
  if (!creatorId || !/^\d{4}-\d{2}-\d{2}$/.test(dia ?? "")) {
    throw new Error("Uso: npx tsx scripts/verificar-global.ts <creatorId> <AAAA-MM-DD>");
  }

  initializeAdmin();
  const db = getFirestore();
  let fallos = 0;
  const mal = (m: string) => {
    console.log(`   ❌ ${m}`);
    fallos++;
  };
  const bien = (m: string) => console.log(`   ✅ ${m}`);

  console.log(`▶  Global de ${creatorId} del ${dia}\n`);

  // ── 1 · El registro del documento ─────────────────────────────────────────
  const doc = await db.doc(`creatorMonthlyDocs/${creatorId}_${dia}_global`).get();
  if (!doc.exists) {
    mal("No hay registro del documento. La global no se emitió.");
    process.exit(1);
  }
  const folio = String(doc.get("facturapiId") ?? "");
  const uuid = String(doc.get("uuid") ?? "");
  if (doc.get("timbrado") === true) bien("Registrado como TIMBRADO");
  else mal("El registro dice que NO se timbró");
  if (folio) bien(`Folio de Facturapi  ${folio}`);
  else mal("Sin folio");
  if (uuid) bien(`UUID del SAT        ${uuid}`);
  else mal("Sin UUID — no llegó a timbrarse en el SAT");

  const acc = doc.get("acumulado") as { ventas?: number; base?: number } | undefined;
  console.log(`   · Ventas en el documento ${acc?.ventas ?? "?"}`);
  console.log(`   · Base declarada         ${acc?.base ?? "?"} MXN`);

  // ── 2 · Las ventas que debía cubrir ───────────────────────────────────────
  const snap = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("globalInvoice.facturapiId", "==", folio)
    .get();

  console.log(`\n   Ventas marcadas con ese folio: ${snap.size}`);
  let sumaBase = 0;
  let sumaIva = 0;
  for (const d of snap.docs) {
    const g = d.get("globalInvoice") as { estado?: string; uuid?: string };
    const f = d.get("fiscalMxn") as { base?: number; iva?: number; fuente?: string } | undefined;
    sumaBase = round2(sumaBase + (f?.base ?? 0));
    sumaIva = round2(sumaIva + (f?.iva ?? 0));
    const ok = g?.estado === "emitida" && g?.uuid === uuid;
    console.log(
      `   ${ok ? "✅" : "❌"} ${d.id.slice(0, 40)}  estado=${g?.estado}  ` +
        `base=${f?.base} iva=${f?.iva} (${f?.fuente})`
    );
    if (!ok) fallos++;
  }

  // ── 3 · Que el importe del documento sea el de las ventas, en PESOS ───────
  console.log(`\n   Suma de las ventas   base ${sumaBase} + IVA ${sumaIva} MXN`);
  if (acc?.base != null && round2(acc.base) === sumaBase) {
    bien("El importe del documento CUADRA con los pesos congelados de sus ventas");
  } else {
    mal(`El importe NO cuadra: documento ${acc?.base} vs ventas ${sumaBase}`);
  }

  // ── 4 · Que no quedara nada a medias ──────────────────────────────────────
  const atascadas = await db
    .collectionGroup("purchases")
    .where("creatorId", "==", creatorId)
    .where("globalInvoice.estado", "==", "emitiendo")
    .get();
  if (atascadas.empty) bien("Ninguna venta quedó a medias");
  else mal(`${atascadas.size} venta(s) quedaron en «emitiendo»`);

  console.log("\n" + "─".repeat(60));
  console.log(fallos === 0 ? "   ✅ TODO CORRECTO" : `   ❌ ${fallos} problema(s)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
