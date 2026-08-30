// Ejercicio impreso del motor fiscal. SOLO CALCULA, no lee ni escribe nada.
//
// Sirve para contestar la pregunta que siempre vuelve: «¿por qué me descuentan tanto?».
// La respuesta corta es que casi nada de lo que se descuenta se PIERDE — el IVA del comprador
// pasa de largo y las retenciones son anticipos del impuesto propio del creador. Lo único
// que de verdad sale de su bolsillo es la comisión de Vibra.
//
// Por eso imprime dos cifras distintas y no una:
//   · DEPOSITADO — lo que le llega a la cuenta. Es lo que enseña la wallet.
//   · EFECTIVO   — lo que le queda de verdad después de su propia declaración.

import {
  resolveSaleTax,
  resolveSettlement,
  type PerfilFiscalCreador,
} from "../lib/tax/fiscalEngine";

const BASE = 100;
const IVA = 0.16;

type Caso = { n: string; creador: PerfilFiscalCreador; comprador: string };

const CASOS: Caso[] = [
  {
    n: "MEXICANO, cobra en MX  →  comprador MEXICANO",
    creador: { residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" },
    comprador: "MX",
  },
  {
    n: "MEXICANO, cobra en MX  →  comprador EXTRANJERO",
    creador: { residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" },
    comprador: "DE",
  },
  {
    n: "MEXICANO que COBRA FUERA  →  comprador MEXICANO",
    creador: { residency: "MX", hasTaxId: true, payoutAccountCountry: "US" },
    comprador: "MX",
  },
  {
    n: "EXTRANJERO  →  comprador MEXICANO",
    creador: { residency: "FOREIGN", hasTaxId: true, payoutAccountCountry: "DE" },
    comprador: "MX",
  },
  {
    n: "EXTRANJERO  →  comprador EXTRANJERO",
    creador: { residency: "FOREIGN", hasTaxId: true, payoutAccountCountry: "DE" },
    comprador: "DE",
  },
];

const f = (x: number) => x.toFixed(2).padStart(7);

console.log(`\nBase ${BASE} USD · comisión 25% · ejercicio 2026\n`);
console.log(
  "                                                 IVAvta  particip  ISRret  IVAret  IVAcom │ DEPOSITADO  su declaración  EFECTIVO"
);
console.log("─".repeat(140));

for (const c of CASOS) {
  const venta = resolveSaleTax({ base: BASE, buyerCountry: c.comprador });
  const liq = resolveSettlement({
    base: BASE,
    mxVatAmount: venta.mxVatAmount,
    creador: c.creador,
  });

  /**
   * Lo que el creador mexicano liquida por su cuenta después de cobrar.
   *
   * Debe al SAT el IVA que le trasladó a su comprador, y acredita dos cosas: el IVA que le
   * trasladó Vibra en su comisión y el que la plataforma ya le retuvo. El resultado puede
   * salir a favor, y entonces el «descuento» era un anticipo, no un costo.
   *
   * El ISR retenido tampoco se pierde: va a cuenta de su impuesto anual. No entra aquí porque
   * su monto final depende de sus deducciones, que Vibra no conoce.
   */
  const esMx = c.creador.residency === "MX";
  const declaracion = esMx
    ? -(venta.mxVatAmount - liq.ivaComision - liq.ivaRetenido)
    : 0;
  const efectivo = liq.neto + declaracion;

  console.log(
    `${c.n.padEnd(46)}${f(venta.mxVatAmount)} ${f(liq.participacion)} ${f(liq.isrRetenido)} ` +
      `${f(liq.ivaRetenido)} ${f(liq.ivaComision)} │${f(liq.neto)}   ${f(declaracion)}      ${f(efectivo)}`
  );
}

console.log(
  "\n«su declaración» = lo que paga (−) o recupera (+) el creador mexicano al declarar su IVA."
);
console.log(
  "El ISR retenido NO entra ahí: es anticipo de su ISR anual y depende de sus deducciones.\n"
);

// ── La pregunta de los 4 ─────────────────────────────────────────────────────
console.log("\n=== ¿DE DÓNDE SALEN LOS 4 DEL IVA DE LA COMISIÓN? ===\n");
const venta = resolveSaleTax({ base: BASE, buyerCountry: "MX" });
const mx: PerfilFiscalCreador = { residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" };
const liq = resolveSettlement({ base: BASE, mxVatAmount: venta.mxVatAmount, creador: mx });

console.log("  Son DOS ventas distintas, cada una con su propio IVA:\n");
console.log(`    1. Creador → comprador   ${f(BASE)} + ${f(venta.mxVatAmount)} de IVA = ${f(BASE + venta.mxVatAmount)}`);
console.log(`    2. Vibra   → creador     ${f(liq.comision)} + ${f(liq.ivaComision)} de IVA = ${f(liq.comision + liq.ivaComision)}   (la comisión ES un servicio)`);
console.log("\n  Los 4 NO salen de los 16. Pero tampoco se pierden, porque son acreditables:\n");
console.log(`    IVA que el creador DEBE (el que cobró)      ${f(venta.mxVatAmount)}`);
console.log(`    − IVA que le trasladó Vibra (acreditable)   ${f(-liq.ivaComision)}`);
console.log(`    − IVA que la plataforma ya le retuvo        ${f(-liq.ivaRetenido)}`);
console.log(`    = lo que paga al declarar                   ${f(venta.mxVatAmount - liq.ivaComision - liq.ivaRetenido)}`);
console.log(`\n    depositado ${f(liq.neto)}  −  declaración ${f(venta.mxVatAmount - liq.ivaComision - liq.ivaRetenido)}  =  ${f(liq.neto - (venta.mxVatAmount - liq.ivaComision - liq.ivaRetenido))}`);
console.log(`\n  Y por la otra ruta, si Vibra retuviera el IVA COMPLETO en vez de la mitad:\n`);
const retTodo = venta.mxVatAmount;
const depositoA = BASE - liq.comision - liq.ivaComision - retTodo - liq.isrRetenido + venta.mxVatAmount;
const declA = venta.mxVatAmount - liq.ivaComision - retTodo;
console.log(`    depositado ${f(depositoA)}  −  declaración ${f(declA)}  =  ${f(depositoA - declA)}`);
console.log(`\n  Mismo resultado. Lo único que cambia es cuándo tiene el dinero en la mano.`);
console.log(`\n  Su cuenta de servilleta —${BASE} − ${liq.comision} de Vibra − ${liq.isrRetenido} de ISR = ${(BASE - liq.comision - liq.isrRetenido).toFixed(2)}— da lo mismo.`);
