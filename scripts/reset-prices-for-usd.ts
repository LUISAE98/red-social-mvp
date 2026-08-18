// Resetea TODOS los precios denominados en MXN, antes de pasar la denominación a USD.
//
// POR QUÉ RESETEAR Y NO CONVERTIR
// Un precio no es un dato que se convierta: es una decisión comercial. Convertir 200 MXN
// deja "$11.36 USD", que no es un precio que nadie elegiría, y le congela a cada creador
// la cotización de un día cualquiera. Pre-lanzamiento nadie ha comprado de verdad, así que
// es el momento más barato para que cada quien vuelva a poner su número, ya en dólares.
//
// NO SE TOCA (a propósito):
//   · `walletLedger`  — es historia y cada asiento carga su propia `currency: "MXN"`,
//                       así que se describe solo y el display ya lo respeta.
//   · `buyerCredit`   — es DEUDA REAL con un comprador. Se convierte aparte y a conciencia,
//                       no se borra. Ver el aviso al final de la corrida.
//
// El reseteo devuelve cada cosa al estado "sin monetizar" que la app YA usa (mismo shape
// que una offering deshabilitada), para no dejar documentos en un estado imposible: una
// offering con `enabled: true` y `price: null` rompe el cobro con "Precio inválido".
//
// ⚠️ ESCRIBE. Corre en seco por defecto; exige `--apply`.
//
// Uso:
//   npx tsx scripts/reset-prices-for-usd.ts            ← simulación
//   npx tsx scripts/reset-prices-for-usd.ts --apply    ← ejecuta

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

type Dict = Record<string, unknown>;
const esNum = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);

/**
 * Apaga una offering: deja los tres campos de dinero en null y la marca deshabilitada.
 *
 * Son TRES campos, no uno (`price`, `memberPrice`, `publicPrice`) y guardan el mismo
 * importe: dejar uno vivo bastaría para cobrar pesos como dólares.
 * `visibility` NO se toca — es semántica de a quién se le muestra, no de dinero.
 */
function apagarOffering(o: Dict): { nueva: Dict; tocada: boolean } {
  const tocada = esNum(o.price) || esNum(o.memberPrice) || esNum(o.publicPrice);
  if (!tocada) return { nueva: o, tocada: false };
  return {
    nueva: { ...o, price: null, memberPrice: null, publicPrice: null, currency: null, enabled: false, visible: false },
    tocada: true,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  initializeAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log("═".repeat(74));
  console.log(apply ? "RESETEO REAL — se van a MODIFICAR documentos" : "SIMULACIÓN — no se escribe nada");
  console.log("═".repeat(74));

  let totalDocs = 0;
  let totalImportes = 0;

  // ── PERFILES ────────────────────────────────────────────────────────────────
  console.log("\n▸ users — offerings + donación");
  {
    const snap = await db.collection("users").get();
    for (const d of snap.docs) {
      const patch: Dict = {};
      let importes = 0;

      const offs = d.get("offerings");
      if (Array.isArray(offs)) {
        const res = offs.map((o) => apagarOffering((o ?? {}) as Dict));
        const n = res.filter((r) => r.tocada).length;
        if (n) { patch.offerings = res.map((r) => r.nueva); importes += n * 3; }
      }

      const don = (d.get("donation") ?? null) as Dict | null;
      const sugeridos = Array.isArray(don?.suggestedAmounts) ? (don!.suggestedAmounts as unknown[]) : [];
      if (sugeridos.length) {
        patch.donation = { ...don, suggestedAmounts: [], enabled: false, visible: false };
        importes += sugeridos.length;
      }

      if (!Object.keys(patch).length) continue;
      totalDocs++; totalImportes += importes;
      console.log(`   ${apply ? "RESET" : "DRY  "} users/${d.id} (${importes} importes)`);
      if (apply) await d.ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  // ── COMUNIDADES ─────────────────────────────────────────────────────────────
  console.log("\n▸ groups — offerings + monetización + donación");
  {
    const snap = await db.collection("groups").get();
    for (const d of snap.docs) {
      const patch: Dict = {};
      let importes = 0;

      const offs = d.get("offerings");
      if (Array.isArray(offs)) {
        const res = offs.map((o) => apagarOffering((o ?? {}) as Dict));
        const n = res.filter((r) => r.tocada).length;
        if (n) { patch.offerings = res.map((r) => r.nueva); importes += n * 3; }
      }

      // La suscripción guarda el precio por DUPLICADO (`priceMonthly` y
      // `subscriptionPriceMonthly`) más los dos de `transitions`, que son el precio
      // anterior y el siguiente de un cambio de plan a medias. Todos son pesos.
      const mon = (d.get("monetization") ?? null) as Dict | null;
      if (mon) {
        const tr = (mon.transitions ?? {}) as Dict;
        const campos = [mon.priceMonthly, mon.subscriptionPriceMonthly, tr.previousSubscriptionPriceMonthly, tr.nextSubscriptionPriceMonthly];
        const n = campos.filter(esNum).length;
        if (n) {
          patch.monetization = {
            ...mon,
            isPaid: false,
            priceMonthly: null,
            currency: null,
            subscriptionsEnabled: false,
            subscriptionPriceMonthly: null,
            subscriptionCurrency: null,
            transitions: {
              ...tr,
              previousSubscriptionPriceMonthly: null,
              nextSubscriptionPriceMonthly: null,
              subscriptionPriceChangeCurrency: null,
            },
          };
          importes += n;
        }
      }

      const don = (d.get("donation") ?? null) as Dict | null;
      const sugeridos = Array.isArray(don?.suggestedAmounts) ? (don!.suggestedAmounts as unknown[]) : [];
      if (sugeridos.length) {
        patch.donation = { ...don, suggestedAmounts: [], enabled: false, visible: false };
        importes += sugeridos.length;
      }

      if (!Object.keys(patch).length) continue;
      totalDocs++; totalImportes += importes;
      console.log(`   ${apply ? "RESET" : "DRY  "} groups/${d.id} (${importes} importes)`);
      if (apply) await d.ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  // ── POSTS DE PAGO ───────────────────────────────────────────────────────────
  console.log("\n▸ posts de pago — premium / ticket de live / VOD");
  {
    const snap = await db.collection("posts").where("requiresPayment", "==", true).get();
    for (const d of snap.docs) {
      const prem = (d.get("premium") ?? null) as Dict | null;
      const live = (d.get("liveData") ?? null) as Dict | null;
      const campos = [d.get("oneTimePrice"), prem?.price, live?.ticketPrice];
      const importes = campos.filter(esNum).length;
      if (!importes) continue;

      // Se apaga el cobro entero. Dejar `requiresPayment: true` con el precio en null
      // deja un post de pago que nadie puede comprar; el creador lo vuelve a monetizar
      // con su precio en dólares.
      const patch: Dict = { requiresPayment: false, oneTimePrice: null };
      if (prem) patch.premium = { ...prem, enabled: false, price: null, currency: null };
      if (live) patch.liveData = { ...live, ticketPrice: null };

      totalDocs++; totalImportes += importes;
      console.log(`   ${apply ? "RESET" : "DRY  "} posts/${d.id} (${importes} importes)`);
      if (apply) await d.ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    }
  }

  console.log("\n" + "═".repeat(74));
  console.log(
    apply
      ? `TOTAL — ${totalDocs} documentos reseteados · ${totalImportes} importes en pesos eliminados`
      : `TOTAL — se resetearían ${totalDocs} documentos (${totalImportes} importes). Corre con --apply.`
  );
  console.log("═".repeat(74));

  // ── El pendiente que este script NO resuelve ────────────────────────────────
  const credito = await db.collectionGroup("buyerCredit").get();
  const conSaldo = credito.docs.filter((d) => esNum(d.get("balance")) && (d.get("balance") as number) > 0);
  if (conSaldo.length) {
    console.log("\n⚠️ SIN TOCAR — saldo a favor de compradores (deuda real de Vibra):");
    conSaldo.forEach((d) => console.log(`   ${d.ref.path} → ${d.get("balance")} ${d.get("currency") ?? "MXN"}`));
    console.log("   Hay que convertirlo a USD al tipo de cambio del día y dejarlo documentado.");
    console.log("   Borrarlo sería quedarse con dinero de un comprador.");
  }
  console.log("\nDespués del reseteo: `npx tsx scripts/audit-mxn-denominated.ts` debe salir en ceros");
  console.log("(salvo walletLedger, que es histórico y conserva su propia moneda).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
