// Inventario de TODO lo que está guardado en Firestore denominado en MXN.
//
// POR QUÉ EXISTE
// Al pasar `SETTLEMENT_CURRENCY` a USD, cualquier importe que siga siendo un número en
// pesos se va a leer como dólares. Un servicio de 200 pesos se cobraría como 200 dólares
// (~17× de más). Este script mide el alcance real de la conversión ANTES de tocar la
// constante, y sirve otra vez DESPUÉS para comprobar que no quedó nada sin migrar.
//
// Es de SOLO LECTURA. No escribe nada.
//
// Uso:  npx tsx scripts/audit-mxn-denominated.ts

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import * as admin from "firebase-admin";

function initializeAdmin() {
  if (admin.apps.length) return;
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL ?? process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = (
    process.env.FIREBASE_PRIVATE_KEY ?? process.env.FIREBASE_ADMIN_PRIVATE_KEY
  )?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Faltan credenciales de Admin SDK en .env.local");
  }
  admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

type Row = { que: string; docs: number; importes: number; min: number | null; max: number | null };

function resumen(que: string, valores: number[], docs: number): Row {
  return {
    que,
    docs,
    importes: valores.length,
    min: valores.length ? Math.min(...valores) : null,
    max: valores.length ? Math.max(...valores) : null,
  };
}

/** Recorre las offerings de un perfil o comunidad y saca sus precios. */
function preciosDeOfferings(offerings: unknown): number[] {
  if (!Array.isArray(offerings)) return [];
  return offerings.map((o) => num((o as Record<string, unknown>)?.price)).filter((n): n is number => n !== null);
}

async function main() {
  initializeAdmin();
  const db = admin.firestore();
  const filas: Row[] = [];

  // ── Perfiles: offerings + donación ────────────────────────────────────────
  {
    const snap = await db.collection("users").get();
    const v: number[] = [];
    let docs = 0;
    snap.docs.forEach((d) => {
      const p = [
        ...preciosDeOfferings(d.get("offerings")),
        ...[num((d.get("donation") as Record<string, unknown>)?.["min"])].filter((x): x is number => x !== null),
      ];
      if (p.length) { docs++; v.push(...p); }
    });
    filas.push(resumen("users — offerings + donación", v, docs));
  }

  // ── Comunidades: offerings + monetización + donación ──────────────────────
  {
    const snap = await db.collection("groups").get();
    const v: number[] = [];
    let docs = 0;
    snap.docs.forEach((d) => {
      const mon = (d.get("monetization") ?? {}) as Record<string, unknown>;
      const p = [
        ...preciosDeOfferings(d.get("offerings")),
        ...[num(mon.priceMonthly), num(mon.price), num((d.get("donation") as Record<string, unknown>)?.["min"])]
          .filter((x): x is number => x !== null),
      ];
      if (p.length) { docs++; v.push(...p); }
    });
    filas.push(resumen("groups — offerings + monetización", v, docs));
  }

  // ── Posts: premium, ticket de live, VOD ───────────────────────────────────
  {
    const snap = await db.collection("posts").where("requiresPayment", "==", true).get();
    const v: number[] = [];
    let docs = 0;
    snap.docs.forEach((d) => {
      const prem = (d.get("premium") ?? {}) as Record<string, unknown>;
      const live = (d.get("liveData") ?? {}) as Record<string, unknown>;
      const p = [num(d.get("oneTimePrice")), num(prem.price), num(live.ticketPrice)]
        .filter((x): x is number => x !== null);
      if (p.length) { docs++; v.push(...p); }
    });
    filas.push(resumen("posts de pago — premium / ticket / VOD", v, docs));
  }

  // ── Suscripciones vivas ───────────────────────────────────────────────────
  {
    const snap = await db.collection("groupSubscriptions").get();
    const v = snap.docs.map((d) => num(d.get("priceMonthly"))).filter((x): x is number => x !== null);
    filas.push(resumen("groupSubscriptions — priceMonthly", v, snap.size));
  }

  // ── Saldo a favor del comprador (dinero real que se le debe) ──────────────
  {
    const snap = await db.collectionGroup("buyerCredit").get();
    const v = snap.docs.map((d) => num(d.get("balance"))).filter((x): x is number => x !== null);
    filas.push(resumen("buyerCredit — saldo a favor 💰", v, snap.size));
  }

  // ── Ledger: llevan su propia `currency`, pero hay que saber cuántos ───────
  {
    const snap = await db.collectionGroup("walletLedger").get();
    const porMoneda: Record<string, number> = {};
    snap.docs.forEach((d) => {
      const c = String(d.get("currency") ?? "(sin moneda)");
      porMoneda[c] = (porMoneda[c] ?? 0) + 1;
    });
    console.log("\n▸ walletLedger por moneda:", JSON.stringify(porMoneda));
    const v = snap.docs.map((d) => num(d.get("grossAmount"))).filter((x): x is number => x !== null);
    filas.push(resumen("walletLedger — asientos históricos", v, snap.size));
  }

  // ── Resumen de wallet (agregados, sin moneda por entrada) ─────────────────
  {
    const snap = await db.collectionGroup("walletSummary").get();
    const v = snap.docs.map((d) => num(d.get("lifetimeGross"))).filter((x): x is number => x !== null);
    filas.push(resumen("walletSummary — acumulados", v, snap.size));
  }

  console.log("\n" + "═".repeat(86));
  console.log("IMPORTES DENOMINADOS EN MXN GUARDADOS EN FIRESTORE");
  console.log("═".repeat(86));
  console.log(
    "\n" +
      ["QUÉ".padEnd(44), "DOCS".padStart(6), "IMPORTES".padStart(10), "MÍN".padStart(9), "MÁX".padStart(10)].join("")
  );
  console.log("─".repeat(86));
  filas.forEach((f) =>
    console.log(
      [
        f.que.padEnd(44),
        String(f.docs).padStart(6),
        String(f.importes).padStart(10),
        (f.min ?? "—").toString().padStart(9),
        (f.max ?? "—").toString().padStart(10),
      ].join("")
    )
  );
  console.log("─".repeat(86));
  console.log(
    ["TOTAL".padEnd(44), String(filas.reduce((a, f) => a + f.docs, 0)).padStart(6),
     String(filas.reduce((a, f) => a + f.importes, 0)).padStart(10)].join("")
  );
  console.log("\n⚠️ `buyerCredit` es dinero que Vibra LE DEBE a compradores reales:");
  console.log("   convertirlo mal no es un precio mal puesto, es una deuda mal saldada.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
