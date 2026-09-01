// TEMPORAL. Tablas de comision del flujo completo, calculadas con el motor real.
import { computeConsumptionTax, fxFeeRateForCountry, taxNameForCountry } from "../lib/tax/config";
import { resolveSaleTax, resolveSettlement } from "../lib/tax/fiscalEngine";

const BASE = 100;
const FIJO = 0.4;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const f = (n: number) => n.toFixed(2).padStart(9);

function caso(
  nombre: string,
  paisComprador: string,
  creador: "MX" | "FOREIGN",
  cobraEn: string,
  tasa = 0.25,
) {
  const publicado = r2(BASE + FIJO);
  const fxRate = fxFeeRateForCountry(paisComprador);
  const fx = r2(publicado * fxRate);
  const gravable = r2(publicado + fx);
  const imp = computeConsumptionTax(gravable, paisComprador);
  const venta = resolveSaleTax({ base: BASE, buyerCountry: paisComprador });
  const liq = resolveSettlement({
    base: BASE,
    mxVatAmount: venta.mxVatAmount,
    commissionRate: tasa,
    creador: { residency: creador, hasTaxId: true, payoutAccountCountry: cobraEn },
  });
  return {
    nombre, publicado, fx, fxRate, gravable, imp, venta, liq,
    total: r2(imp.total),
    impNombre: taxNameForCountry(paisComprador),
  };
}

const casos = [
  caso("A comprador MX  -> creador MX (cobra MX)", "MX", "MX", "MX"),
  caso("B comprador ES  -> creador MX (cobra MX)", "ES", "MX", "MX"),
  caso("C comprador MX  -> creador MX (cobra FUERA)", "MX", "MX", "ES"),
  caso("D comprador MX  -> creador extranjero", "MX", "FOREIGN", "ES"),
  caso("E comprador ES  -> creador extranjero", "ES", "FOREIGN", "ES"),
  caso("F comprador ES  -> creador extranjero 30%", "ES", "FOREIGN", "JP", 0.3),
];

console.log("\n=== 1. COBRO AL COMPRADOR - base 100 USD ===\n");
console.log("caso                                        base      fijo        FX  gravable  imp.pais     TOTAL");
for (const c of casos)
  console.log(c.nombre.padEnd(42), f(BASE), f(FIJO), f(c.fx), f(c.gravable), f(c.imp.tax), f(c.total));

console.log("\n=== 2. LIQUIDACION AL CREADOR - base 100 USD ===\n");
console.log("caso                                   IVAventa  comision    IVAcom    retISR    retIVA      NETO");
for (const c of casos) {
  const l = c.liq;
  console.log(
    c.nombre.padEnd(38),
    f(c.venta.mxVatAmount), f(l.comision), f(l.ivaComision), f(l.isrRetenido), f(l.ivaRetenido), f(l.neto),
  );
}

console.log("\n=== 3. TASAS Y TRATAMIENTO ===\n");
for (const c of casos)
  console.log(
    c.nombre.padEnd(42),
    "ISR", ((c.liq.isrRate * 100).toFixed(2) + "%").padStart(7),
    " IVAret", ((c.liq.ivaRate * 100).toFixed(0) + "%").padStart(5),
    " FX", ((c.fxRate * 100).toFixed(0) + "%").padStart(3),
    " venta", c.venta.tratamiento,
  );

console.log("\n=== 4. REPARTO DEL DINERO COBRADO ===\n");
console.log("caso                                     cobrado   creador  Vibra->SAT     VIBRA  cuadra");
for (const c of casos) {
  const l = c.liq;
  // Lo que Vibra ingresa DE VERDAD: su cargo fijo, el FX y su comision. Nada mas.
  const vibra = r2(FIJO + c.fx + l.comision);
  // Lo que Vibra entera al fisco, por cuenta ajena o propia. El IVA de la venta que NO se
  // retuvo NO va aqui: viaja dentro del pago al creador y lo declara el.
  const ivaPropio = r2(c.imp.tax - c.venta.mxVatAmount);
  const alFisco = r2(l.isrRetenido + l.ivaRetenido + l.ivaComision + ivaPropio);
  const suma = r2(l.neto + alFisco + vibra);
  console.log(
    c.nombre.padEnd(38), f(c.total), f(l.neto), f(alFisco), f(vibra),
    Math.abs(suma - c.total) < 0.011 ? "   ok" : "   x " + suma.toFixed(2),
  );
}

console.log("\n=== 5. COSTE DE STRIPE - lo absorbe Vibra, no se le descuenta al creador ===\n");
console.log("payin    2.9% + 0.30 USD    +1.5% tarjeta no estadounidense    +1% conversion");
console.log("payout   local 0.25% + 0.25 USD     wire 25 USD fijos     2 USD/mes cuenta activa");
console.log("disputa  15 USD");
console.log();
