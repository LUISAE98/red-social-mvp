// Calcula las retenciones de los asientos del ledger anteriores al 2026-08-26.
//
// Desde esa fecha cada venta congela sus retenciones al registrarse. Las anteriores no las
// tienen, así que el acumulado del creador y lo que se puede cuadrar contra el SAT arrancan
// incompletos.
//
// 🧮 CÓMO SE RECALCULA UNA VENTA VIEJA
//
// Con las tasas de SU ejercicio, no las de hoy: el motor las guarda por año justamente para
// esto. El ejercicio sale de `occurredAt` (la fecha real de la venta) y, si falta, de
// `createdAt`. Una venta de diciembre liquidada en enero pertenece a diciembre.
//
// ⚠️ EL PERFIL FISCAL ES EL DE HOY, NO EL DE ENTONCES
//
// No hay historial de perfiles: no se puede saber si el creador tenía RFC el día de la venta.
// Se usa el actual y **queda marcado** en el asiento (`retenciones.backfilled: true`) para que
// nadie lo confunda con una retención calculada en su momento. Es una reconstrucción, no un
// registro. Si el creador subió su RFC después, su venta vieja sale con la retención buena en
// vez de la del 20% que le habría tocado — conviene saberlo antes de cuadrar con el contador.
//
// ⚠️ ESCRIBE. Corre en seco por defecto; exige `--apply`.
//
// 🚫 NO recalcula los acumulados del resumen (`lifetimeRetained*`). Sumar retenciones viejas
//    ahí descuadraría el saldo, que hoy NO las resta. Cuando el bloque 7 las aplique al saldo,
//    ese acumulado se reconstruye entero desde los asientos, que es lo consistente.

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import * as admin from "firebase-admin";
import {
  resolveSaleTax,
  resolveSettlement,
  ejercicioDeFecha,
  TASAS_POR_EJERCICIO,
  type PerfilFiscalCreador,
} from "../backend/src/tax/fiscalEngine";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    }),
  });
}

/** Ejercicios con tasas cargadas. Fuera de ellos no se inventa nada. */
const EJERCICIOS = Object.keys(TASAS_POR_EJERCICIO).map(Number);
const MIN_EJERCICIO = Math.min(...EJERCICIOS);
const MAX_EJERCICIO = Math.max(...EJERCICIOS);

function fechaDe(x: FirebaseFirestore.DocumentData): Date | null {
  const t = x.occurredAt ?? x.createdAt ?? null;
  if (!t) return null;
  if (typeof t.toDate === "function") return t.toDate() as Date;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

(async () => {
  const aplicar = process.argv.includes("--apply");
  /**
   * Rehacer también los asientos que YA tienen retenciones.
   *
   * Hace falta cuando cambian las TASAS, no solo cuando faltan datos. Al eliminar el motor
   * "sin RFC" el 2026-08-30, los asientos existentes quedaron congelados con un ISR del 20%
   * que ya no corresponde a nadie, y sin esto seguirían descontándoselo al creador.
   *
   * ⚠️ Reescribe un cálculo ya hecho. Fuera de un cambio de tasas, NO lo uses.
   */
  const recalcular = process.argv.includes("--recalcular");
  const db = admin.firestore();

  // Perfiles fiscales, leídos una vez: son pocos y se reutilizan en cada asiento.
  const perfiles = new Map<string, PerfilFiscalCreador>();
  const perfilesSnap = await db.collection("creatorTaxProfiles").get();
  for (const d of perfilesSnap.docs) {
    const x = d.data();
    perfiles.set(d.id, {
      residency: x.residency === "FOREIGN" ? "FOREIGN" : "MX",
      hasTaxId: typeof x.taxId === "string" && x.taxId.trim().length > 0,
      payoutAccountCountry:
        typeof x.payoutAccountCountry === "string" ? x.payoutAccountCountry : null,
    });
  }
  console.log(`Perfiles fiscales cargados: ${perfiles.size}`);

  const asientos = await db.collectionGroup("walletLedger").get();
  console.log(`Asientos en el ledger: ${asientos.size}\n`);

  let tocados = 0;
  let yaTenian = 0;
  let sinFecha = 0;
  let fueraDeRango = 0;
  let sinPerfil = 0;
  const totales = { isr: 0, iva: 0, ivaComision: 0 };

  for (const d of asientos.docs) {
    const x = d.data();
    if (x.retenciones && typeof x.retenciones === "object" && !recalcular) {
      yaTenian++;
      continue;
    }

    const creatorId = String(x.creatorId ?? d.ref.parent.parent?.id ?? "");
    if (!creatorId) continue;

    const fecha = fechaDe(x);
    if (!fecha) {
      sinFecha++;
      continue;
    }
    const ejercicio = ejercicioDeFecha(fecha);
    if (ejercicio < MIN_EJERCICIO || ejercicio > MAX_EJERCICIO) {
      fueraDeRango++;
      console.log(`   — ${d.id.slice(0, 24)}: ejercicio ${ejercicio} sin tasas cargadas`);
      continue;
    }

    const perfil = perfiles.get(creatorId);
    if (!perfil) sinPerfil++;
    // Sin perfil se asume mexicano, igual que en el ledger. `hasTaxId` ya no mueve ninguna
    // tasa desde el 2026-08-30; se sigue mandando por el rastro que estampa el asiento.
    const usado: PerfilFiscalCreador = perfil ?? {
      residency: "MX",
      hasTaxId: false,
      payoutAccountCountry: null,
    };

    const base = Number(x.grossAmount) || 0;
    if (!(base > 0)) continue;

    // ⚠️ NO se usa `taxAmount`: ése es el impuesto del TOTAL cobrado, que incluye el cargo
    // fijo de Vibra y el 2% de conversión. La retención cae solo sobre la venta del creador.
    // Con comprador extranjero el motor devuelve cero, que es lo correcto (exportación).
    const ventaFiscal = resolveSaleTax({
      base,
      buyerCountry: typeof x.taxCountry === "string" ? x.taxCountry : null,
      serviceType: x.type ?? null,
    });

    const liq = resolveSettlement({
      base,
      mxVatAmount: ventaFiscal.mxVatAmount,
      creador: usado,
      ejercicio,
    });

    totales.isr += liq.isrRetenido;
    totales.iva += liq.ivaRetenido;
    totales.ivaComision += liq.ivaComision;
    tocados++;

    console.log(
      `   ${String(x.type ?? "?").padEnd(18)} ${fecha.toISOString().slice(0, 10)} ` +
        `base ${base.toFixed(2)} → ISR ${liq.isrRetenido.toFixed(2)} · IVA ${liq.ivaRetenido.toFixed(2)}`
    );

    if (aplicar) {
      await d.ref.set(
        {
          retenciones: {
            comision: liq.comision,
            ivaComision: liq.ivaComision,
            isrRate: liq.isrRate,
            isrRetenido: liq.isrRetenido,
            ivaRate: liq.ivaRate,
            ivaRetenido: liq.ivaRetenido,
            neto: liq.neto,
            ejercicio: liq.ejercicio,
            motorVersion: liq.motorVersion,
            residency: usado.residency,
            hasTaxId: usado.hasTaxId,
            payoutAccountCountry: usado.payoutAccountCountry ?? null,
            // 🚩 Marca de reconstrucción: se calculó DESPUÉS, con el perfil de hoy.
            backfilled: true,
            backfilledAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
        { merge: true }
      );
    }
  }

  console.log("\n─────────────────────────────────────────");
  console.log(`Modo                  : ${recalcular ? "RECALCULAR (rehace las existentes)" : "solo faltantes"}`);
  console.log(`Ya tenían retenciones : ${yaTenian}`);
  console.log(`Sin fecha usable      : ${sinFecha}`);
  console.log(`Ejercicio sin tasas   : ${fueraDeRango}`);
  console.log(`Sin perfil fiscal     : ${sinPerfil}  (se asumió mexicano; ya no hay tasa "sin RFC")`);
  console.log(`A reconstruir         : ${tocados}`);
  console.log(`  ISR total           : ${totales.isr.toFixed(2)}`);
  console.log(`  IVA retenido total  : ${totales.iva.toFixed(2)}`);
  console.log(`  IVA de comisión     : ${totales.ivaComision.toFixed(2)}`);
  console.log(
    aplicar ? "\nListo: escrito." : "\nEN SECO. Para escribir: npx tsx scripts/backfill-retenciones-ledger.ts --apply"
  );
  process.exit(0);
})();
