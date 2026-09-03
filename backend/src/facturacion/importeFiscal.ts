// Los pesos de una venta, congelados el día que ocurrió.
//
// El ledger vive en dólares (`SETTLEMENT_CURRENCY`), pero el CFDI es un documento mexicano y va
// en pesos. Este módulo resuelve la única pregunta que separa esos dos mundos: **cuántos pesos
// fue esta venta**, y lo hace UNA VEZ, en el momento de la venta.
//
// ⚠️ POR QUÉ SE CONGELA Y NO SE CALCULA AL TIMBRAR
//
// Un CFDI reexpedido dos años después tiene que dar exactamente el mismo número. Si la cifra se
// recalculara al emitir, dependería de la tasa de ese día y cada reexpedición daría un importe
// distinto — que es justo lo que una autoridad fiscal no puede aceptar.
//
// ⚠️ DE DÓNDE SALE EL TIPO DE CAMBIO: DEL COBRO, NO DE UNA TABLA
//
// La tasa verdadera de cada operación está implícita en lo que se cobró: si al comprador se le
// cargaron $1,850 MXN por algo de 100 USD, el tipo de cambio de ESA operación fue 18.50. No hay
// que ir a preguntárselo a nadie.
//
// `config/exchangeRates` solo entra como respaldo, y queda marcado como tal, porque sale de una
// API pública gratuita (`backend/src/exchangeRates.ts`) y **no del DOF**. Sirve para presentar
// precios; no es la fuente que uno querría defender ante el SAT.
//
// Detalle y decisiones: `pendientesimpuestos.md` §A0.

/** De dónde salió el tipo de cambio de un importe congelado. */
export type FuenteTipoCambio = "cobro" | "tabla";

/** Los pesos de una venta, congelados. Todo redondeado a centavos. */
export type ImporteFiscalMxn = {
  /** Base más IVA. Siempre igual a `base + iva`, exactamente. */
  total: number;
  /** Base sin impuesto. */
  base: number;
  /** IVA mexicano de la venta. Cero en exportación. */
  iva: number;
  /** Pesos por dólar aplicados. */
  tipoCambio: number;
  fuente: FuenteTipoCambio;
};

/**
 * Los campos del `paymentIntents/{id}` que hacen falta para despejar el tipo de cambio.
 *
 * Se tipan como `unknown` a propósito: vienen de Firestore, donde nada garantiza la forma.
 */
export type DatosDelCobro = {
  presentmentCurrency?: unknown;
  presentmentAmount?: unknown;
  settlementAmount?: unknown;
  creditApplied?: unknown;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function numeroPositivo(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 🚨 Banda de cordura del tipo de cambio.
 *
 * No está para opinar sobre el mercado —el peso puede irse a donde quiera— sino para atrapar un
 * dato corrupto antes de que se convierta en un CFDI equivocado. El error realista es de unidad:
 * un importe guardado en centavos daría una tasa cien veces mayor, y eso sí se detecta.
 *
 * Fuera de la banda no se rompe nada: se cae al respaldo, que es peor pero no es falso.
 */
const TIPO_CAMBIO_MIN = 1;
const TIPO_CAMBIO_MAX = 1000;

/**
 * Despeja el tipo de cambio real de un cobro en pesos.
 *
 * ```
 * tipoCambio = presentmentAmount / (settlementAmount − creditApplied)
 * ```
 *
 * 🚨 El divisor es el **remanente**, no el total. Si el comprador pagó parte con saldo a favor,
 * a la tarjeta solo se le cargó el resto, y `presentmentAmount` es el presentment de ESE resto.
 * Dividir entre el total daría una tasa artificialmente baja y una factura corta.
 *
 * Devuelve `null` cuando no se puede despejar: no se cobró en pesos, no hubo cargo (pagó todo con
 * saldo), o los números no son creíbles.
 */
export function tipoCambioDelCobro(cobro: DatosDelCobro | null | undefined): number | null {
  if (!cobro) return null;
  if (String(cobro.presentmentCurrency ?? "").toUpperCase() !== "MXN") return null;

  const cobrado = numeroPositivo(cobro.presentmentAmount);
  const total = numeroPositivo(cobro.settlementAmount);
  if (cobrado === null || total === null) return null;

  const credito = Number(cobro.creditApplied);
  const remanente = total - (Number.isFinite(credito) && credito > 0 ? credito : 0);
  // Pagó todo con saldo: no hubo cargo del que despejar nada.
  if (!(remanente > 0)) return null;

  const tasa = cobrado / remanente;
  if (!Number.isFinite(tasa)) return null;
  if (tasa < TIPO_CAMBIO_MIN || tasa > TIPO_CAMBIO_MAX) return null;
  return tasa;
}

/**
 * Convierte una venta a pesos con un tipo de cambio dado.
 *
 * 🚨 Cuadra el total contra sus partes. Redondear base e IVA por separado deja un centavo suelto
 * una de cada tantas veces, y un CFDI cuyos conceptos no suman el total es un CFDI que el SAT
 * rechaza. El residuo se le carga al IVA, que es la partida que se despeja, nunca a la base.
 *
 * Si no hay IVA —exportación a 0%— el total es la base y no hay nada que cuadrar.
 */
export function convertirAPesos(params: {
  baseUsd: number;
  ivaUsd: number;
  tipoCambio: number;
  fuente: FuenteTipoCambio;
}): ImporteFiscalMxn {
  const { tipoCambio, fuente } = params;
  const baseUsd = Number.isFinite(params.baseUsd) ? params.baseUsd : 0;
  const ivaUsd = Number.isFinite(params.ivaUsd) ? params.ivaUsd : 0;

  const base = round2(baseUsd * tipoCambio);
  const total = round2((baseUsd + ivaUsd) * tipoCambio);
  // El IVA es lo que falta para el total, no su propia multiplicación redondeada.
  const iva = round2(total - base);

  return { total, base, iva, tipoCambio, fuente };
}

/**
 * Los pesos de una venta, listos para congelar.
 *
 * Primero intenta el cobro real; si no se puede, cae a la tasa de la tabla que se le pase. Sin
 * ninguna de las dos devuelve `null`, y el llamador decide qué hacer — que en la venta es seguir
 * adelante sin congelar nada, porque **un cobro no se rompe por no poder documentarlo todavía**.
 * Lo que quede sin congelar lo recoge el backfill.
 */
export function importeFiscalDeLaVenta(params: {
  baseUsd: number;
  ivaUsd: number;
  cobro?: DatosDelCobro | null;
  /** Pesos por dólar de `config/exchangeRates`. Respaldo. */
  tasaDeTabla?: number | null;
}): ImporteFiscalMxn | null {
  const delCobro = tipoCambioDelCobro(params.cobro);
  if (delCobro !== null) {
    return convertirAPesos({
      baseUsd: params.baseUsd,
      ivaUsd: params.ivaUsd,
      tipoCambio: delCobro,
      fuente: "cobro",
    });
  }

  const tabla = numeroPositivo(params.tasaDeTabla);
  if (tabla !== null && tabla >= TIPO_CAMBIO_MIN && tabla <= TIPO_CAMBIO_MAX) {
    return convertirAPesos({
      baseUsd: params.baseUsd,
      ivaUsd: params.ivaUsd,
      tipoCambio: tabla,
      fuente: "tabla",
    });
  }

  return null;
}

/**
 * Lee un importe congelado de un documento de Firestore.
 *
 * Devuelve `null` si falta o está incompleto, para que quien lo consuma pueda distinguir «esta
 * venta es anterior al congelado» de «esta venta vale cero pesos».
 */
export function leerImporteFiscal(v: unknown): ImporteFiscalMxn | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const total = Number(o.total);
  const base = Number(o.base);
  const iva = Number(o.iva);
  const tipoCambio = Number(o.tipoCambio);
  if (![total, base, iva, tipoCambio].every((n) => Number.isFinite(n))) return null;
  if (!(total > 0) || !(tipoCambio > 0)) return null;
  return {
    total,
    base,
    iva,
    tipoCambio,
    fuente: o.fuente === "tabla" ? "tabla" : "cobro",
  };
}
