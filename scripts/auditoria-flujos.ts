// Auditoría de los cuatro flujos de dinero. SOLO CALCULA, no lee ni escribe nada.
//
// Cruza las dos residencias del creador con las dos del comprador, más la variante del
// mexicano que cobra fuera, y recorre las cuatro capas por las que pasa una venta:
//
//   1. COBRO      `composeCharge`     — qué paga el comprador y de qué se compone
//   2. VENTA      `resolveSaleTax`    — cuánto de ese impuesto es IVA mexicano del creador
//   3. ASIENTO    `resolveSettlement` — qué se congela y cuánto se le liquida
//   4. RETIRO     `calcularRetiro`    — qué ve y qué cobra al pedir su dinero
//
// Y aplica tres pruebas a cada flujo:
//
//   · CONSERVACIÓN — lo que paga el comprador tiene que repartirse ENTERO entre el creador,
//     Vibra y las autoridades fiscales. Si sobra o falta un centavo, hay una fuga.
//   · CUADRE       — el desglose del retiro tiene que dar lo mismo que la liquidación de la
//     venta. Es la invariante que faltaba y que costó el bug del IVA.
//   · SANIDAD      — nada negativo, y el creador nunca recibe más de lo que entró por él.

import { composeCharge } from "../backend/src/tax/composeCharge";
import {
  resolveSaleTax,
  resolveSettlement,
  calcularRetiro,
  requiereCfdiRetenciones,
  type PerfilFiscalCreador,
} from "../backend/src/tax/fiscalEngine";

const BASE = 100;
const f = (x: number) => x.toFixed(2).padStart(8);
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

type Flujo = {
  id: string;
  titulo: string;
  creador: PerfilFiscalCreador;
  comprador: string;
};

const FLUJOS: Flujo[] = [
  {
    id: "A",
    titulo: "CREADOR MEXICANO  ×  COMPRADOR MEXICANO",
    creador: { residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" },
    comprador: "MX",
  },
  {
    id: "B",
    titulo: "CREADOR MEXICANO  ×  COMPRADOR EXTRANJERO",
    creador: { residency: "MX", hasTaxId: true, payoutAccountCountry: "MX" },
    comprador: "DE",
  },
  {
    id: "C",
    titulo: "CREADOR EXTRANJERO  ×  COMPRADOR MEXICANO",
    creador: { residency: "FOREIGN", hasTaxId: true, payoutAccountCountry: "DE" },
    comprador: "MX",
  },
  {
    id: "D",
    titulo: "CREADOR EXTRANJERO  ×  COMPRADOR EXTRANJERO",
    creador: { residency: "FOREIGN", hasTaxId: true, payoutAccountCountry: "DE" },
    comprador: "DE",
  },
  {
    id: "E",
    titulo: "CREADOR MEXICANO QUE COBRA FUERA  ×  COMPRADOR MEXICANO  (variante)",
    creador: { residency: "MX", hasTaxId: true, payoutAccountCountry: "US" },
    comprador: "MX",
  },
];

let fallos = 0;

for (const flujo of FLUJOS) {
  const { creador, comprador } = flujo;

  // ── 1. COBRO ──────────────────────────────────────────────────────────────
  const cobro = composeCharge(BASE, comprador, { serviceType: "live_ticket" });

  // ── 2. VENTA ──────────────────────────────────────────────────────────────
  const venta = resolveSaleTax({ base: BASE, buyerCountry: comprador, serviceType: "live_ticket" });

  // ── 3. ASIENTO ────────────────────────────────────────────────────────────
  const liq = resolveSettlement({ base: BASE, mxVatAmount: venta.mxVatAmount, creador });

  // ── 4. RETIRO ─────────────────────────────────────────────────────────────
  // Con los contadores tal como los deja el ledger tras una venta ganada.
  const retiro = calcularRetiro({
    saldo: liq.participacion,
    ivaCobradoPendiente: venta.mxVatAmount,
    isrPendiente: liq.isrRetenido,
    ivaPendiente: liq.ivaRetenido,
    ivaComisionPendiente: liq.ivaComision,
  });

  console.log(`\n${"═".repeat(78)}`);
  console.log(`FLUJO ${flujo.id} · ${flujo.titulo}`);
  console.log("═".repeat(78));

  console.log(`\n  1· COBRO — qué paga el comprador`);
  console.log(`     precio del creador                ${f(cobro.baseAmount)}`);
  console.log(`     cargo fijo de Vibra               ${f(cobro.fixedFee)}`);
  console.log(`     conversión ${(cobro.fxFeeRate * 100).toFixed(0)}%                    ${f(cobro.fxFeeAmount)}`);
  console.log(
    `     ${(cobro.buyerTax.name ?? "sin impuesto").padEnd(33)}${f(cobro.buyerTax.amount)}` +
      `  ${cobro.buyerTax.collectedByPlatform ? "(lo entera Vibra)" : "(lo percibe la emisora)"}`
  );
  console.log(`     TOTAL                             ${f(cobro.chargedAmount)}`);

  console.log(`\n  2· VENTA — cuánto de ese impuesto es del creador`);
  console.log(`     tratamiento IVA mexicano          ${venta.tratamiento}`);
  console.log(`     IVA mexicano de SU venta          ${f(venta.mxVatAmount)}`);
  console.log(`     el resto, que grava lo de Vibra   ${f(round2(cobro.buyerTax.amount - venta.mxVatAmount))}`);

  console.log(`\n  3· ASIENTO — qué se congela`);
  console.log(`     participación (75%)               ${f(liq.participacion)}`);
  console.log(`     comisión de Vibra                 ${f(liq.comision)}`);
  console.log(`     IVA de la comisión                ${f(liq.ivaComision)}   ${liq.ivaComision === 0 ? "(exportación de mediación, 0%)" : ""}`);
  console.log(`     ISR retenido (${(liq.isrRate * 100).toFixed(1)}%)                ${f(liq.isrRetenido)}`);
  console.log(`     IVA retenido (${(liq.ivaRate * 100).toFixed(0)}%)                ${f(liq.ivaRetenido)}`);
  console.log(`     → se le liquida                   ${f(liq.neto)}`);
  console.log(`     ¿lleva CFDI de retenciones?       ${requiereCfdiRetenciones(liq) ? "SÍ" : "no"}`);

  console.log(`\n  4· RETIRO — lo que ve en la pestaña`);
  console.log(`     Tu saldo                          ${f(retiro.bruto)}`);
  if (retiro.ivaCobrado > 0)
    console.log(`     + IVA que cobraste                ${f(retiro.ivaCobrado)}`);
  if (liq.isrRetenido > 0 || liq.ivaRetenido > 0 || liq.ivaComision > 0) {
    console.log(`     − ISR retenido                    ${f(-retiro.isr)}`);
    console.log(`     − IVA retenido                    ${f(-retiro.iva)}`);
    console.log(`     − IVA de la comisión              ${f(-retiro.ivaComision)}`);
  }
  console.log(`     = Recibes                         ${f(retiro.neto)}`);
  if (retiro.ivaPorDeclarar > 0)
    console.log(`       de eso, ${retiro.ivaPorDeclarar.toFixed(2)} es IVA que declara él`);

  // ── PRUEBAS ───────────────────────────────────────────────────────────────
  console.log(`\n  ✔ PRUEBAS`);

  // CONSERVACIÓN. Todo lo que pagó el comprador tiene que tener dueño.
  const aVibra = round2(
    liq.comision + cobro.fixedFee + cobro.fxFeeAmount + cobro.roundingAdjustment
  );
  const aFisco = round2(
    liq.isrRetenido +
      liq.ivaRetenido +
      liq.ivaComision +
      (cobro.buyerTax.amount - venta.mxVatAmount)
  );
  const reparto = round2(liq.neto + aVibra + aFisco);
  const conserva = Math.abs(reparto - cobro.chargedAmount) < 0.02;
  console.log(
    `     conservación   creador ${liq.neto.toFixed(2)} + Vibra ${aVibra.toFixed(2)} + fiscos ${aFisco.toFixed(2)}` +
      ` = ${reparto.toFixed(2)}  vs cobrado ${cobro.chargedAmount.toFixed(2)}   ${conserva ? "✅" : "🔴"}`
  );
  if (!conserva) fallos++;

  // CUADRE. El retiro tiene que dar lo mismo que la liquidación.
  const cuadra = Math.abs(retiro.neto - liq.neto) < 0.02;
  console.log(
    `     cuadre         retiro ${retiro.neto.toFixed(2)} vs liquidación ${liq.neto.toFixed(2)}   ${cuadra ? "✅" : "🔴"}`
  );
  if (!cuadra) fallos++;

  // SANIDAD.
  const sano =
    liq.neto >= 0 &&
    retiro.neto >= 0 &&
    liq.isrRetenido >= 0 &&
    liq.ivaRetenido >= 0 &&
    liq.ivaComision >= 0 &&
    retiro.ivaPorDeclarar >= 0 &&
    // Nunca puede recibir más de lo que entró por su venta.
    retiro.neto <= round2(BASE + venta.mxVatAmount);
  console.log(`     sanidad        sin negativos y sin cobrar de más   ${sano ? "✅" : "🔴"}`);
  if (!sano) fallos++;
}

console.log(`\n${"═".repeat(78)}`);
console.log(
  fallos === 0
    ? `AUDITORÍA LIMPIA · ${FLUJOS.length} flujos · ${FLUJOS.length * 3} pruebas · 0 fallos`
    : `🔴 ${fallos} PRUEBAS FALLIDAS`
);
console.log("═".repeat(78));
process.exit(fallos > 0 ? 1 : 0);
