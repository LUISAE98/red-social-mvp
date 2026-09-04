import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ¿Hay con qué probar el timbrado en sandbox?
//
// Antes de encender `TIMBRAR` conviene saber si existe siquiera un creador capaz de emitir:
// hace falta organización en Facturapi Y sello vigente. Sin eso, encenderlo solo produce
// avisos de «sin sello» y no prueba nada.
//
// También lista los días con ventas congeladas, que son los únicos que una factura global
// puede cubrir.
//
// Uso: npx tsx scripts/estado-timbrado.ts

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

/** El día mexicano de un instante. México es UTC-6 fijo desde 2022. */
function diaMx(d: Date): string {
  const l = new Date(d.getTime() - 6 * 3_600_000);
  return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}-${String(
    l.getUTCDate()
  ).padStart(2, "0")}`;
}

async function main() {
  initializeAdmin();
  const db = getFirestore();

  console.log("▶  ¿Se puede timbrar en sandbox?\n");

  // ── Quién puede emitir ────────────────────────────────────────────────────
  const perfiles = await db.collection("creatorTaxProfiles").get();
  let conOrg = 0;
  let conSello = 0;
  const listos: string[] = [];
  for (const p of perfiles.docs) {
    const org = String(p.get("facturapiOrgId") ?? "").trim();
    const sello = p.get("csdStatus");
    if (org) conOrg++;
    if (sello === "valid") conSello++;
    if (org && sello === "valid") listos.push(p.id);
  }
  console.log(`   Perfiles fiscales          ${perfiles.size}`);
  console.log(`   Con organización Facturapi ${conOrg}`);
  console.log(`   Con sello vigente          ${conSello}`);
  console.log(`   ✅ LISTOS PARA EMITIR       ${listos.length}`);
  for (const c of listos) console.log(`      · ${c}`);

  // ── Qué días tienen ventas que una global podría cubrir ───────────────────
  const compras = await db.collectionGroup("purchases").get();
  const porDia = new Map<string, { creadores: Set<string>; ventas: number }>();
  let sinCongelar = 0;
  for (const d of compras.docs) {
    const x = d.data();
    if (x.status !== "paid") continue;
    if (x.invoiced === true || x.globalInvoice || x.nominativaEnCurso) continue;
    if (!x.fiscalMxn) {
      sinCongelar++;
      continue;
    }
    const cuando = (x.occurredAt as { toDate?: () => Date } | undefined)?.toDate?.();
    if (!cuando) continue;
    const dia = diaMx(cuando);
    const e = porDia.get(dia) ?? { creadores: new Set<string>(), ventas: 0 };
    e.ventas++;
    e.creadores.add(String(x.creatorId ?? ""));
    porDia.set(dia, e);
  }

  console.log(`\n   Compras sin pesos congelados ${sinCongelar}`);
  console.log(`   Días con ventas facturables  ${porDia.size}\n`);

  const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [dia, e] of dias) {
    const emitibles = [...e.creadores].filter((c) => listos.includes(c));
    console.log(
      `   ${dia}  ${String(e.ventas).padStart(3)} venta(s)  ` +
        `${e.creadores.size} creador(es)  ` +
        (emitibles.length > 0 ? `✅ ${emitibles.length} puede(n) emitir` : "⬜ ninguno puede emitir")
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
