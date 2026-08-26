// Motor fiscal — BACKEND (autoritativo). Módulo PURO: sin Firebase, sin red, sin reloj.
//
// Resuelve las dos preguntas del modelo de intermediación, que son INDEPENDIENTES entre sí y
// solo se encuentran en el asiento del ledger:
//
//   1. `resolveSaleTax`    — qué impuesto lleva la venta. Lo decide el país del COMPRADOR.
//   2. `resolveSettlement` — cuánto se le deposita al creador. Lo deciden su residencia y su
//                            régimen.
//
// Mezclarlas es el error más caro que se puede cometer aquí: el impuesto de la venta no es de
// nadie de los dos y no entra al reparto, mientras que las retenciones sí salen del pago al
// creador, pero no reducen su participación — la anticipan.
//
// 🔁 El espejo de presentación vive en `lib/tax/fiscalEngine.ts`, para que la wallet pueda
// mostrar el desglose sin recalcularlo distinto. `test/unit/fiscalEngine.test.ts` verifica que
// los dos coincidan.
//
// Documento de referencia: `docs/legal/fiscal-iva-isr-plataforma.md` §0.

import type { LedgerServiceType } from "../wallet/ledger";

/** Redondeo a centavos. Idéntico al del ledger, a propósito. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasas por ejercicio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Las tasas de retención NO son constantes: la de ISR vive en la Ley de Ingresos, que se
 * publica cada año. El 2.5% de 2026 no está en el artículo 113-A —cuyo texto base sigue
 * diciendo 1%— sino en la Ley de Ingresos de ese ejercicio.
 *
 * Por eso se guardan por año y cada cálculo estampa cuál usó: una venta de 2026 debe poder
 * recalcularse con las tasas de 2026 aunque estemos en 2028.
 *
 * 👉 PARA UN EJERCICIO NUEVO: agrega una fila. No edites las anteriores.
 */
export type Ejercicio = number;

export type TasasEjercicio = {
  /** ISR retenido a creador mexicano CON identificación fiscal. */
  isrMxConRfc: number;
  /** ISR retenido a creador mexicano SIN identificación fiscal. */
  isrMxSinRfc: number;
  /** Proporción del IVA cobrado que se retiene a creador mexicano CON RFC. */
  ivaMxConRfc: number;
  /** Proporción que se retiene sin RFC, o cobrando en cuenta fuera de México. */
  ivaMxSinRfc: number;
  /** Proporción retenida al creador extranjero que vende a comprador mexicano. */
  ivaExtranjero: number;
  /** ISR a creador extranjero cuando el pago se caracteriza como regalía. */
  isrRegalia: number;
  /** IVA de la comisión de Vibra cuando el creador es mexicano. */
  ivaComisionMx: number;
};

export const TASAS_POR_EJERCICIO: Readonly<Record<Ejercicio, TasasEjercicio>> = {
  2026: {
    isrMxConRfc: 0.025,
    isrMxSinRfc: 0.2,
    ivaMxConRfc: 0.5,
    ivaMxSinRfc: 1,
    ivaExtranjero: 1,
    isrRegalia: 0.25,
    ivaComisionMx: 0.16,
  },
};

/** Ejercicio vigente. Al cambiar de año se agrega la fila y se mueve esto. */
export const EJERCICIO_VIGENTE: Ejercicio = 2026;

export function tasasDe(ejercicio: Ejercicio): TasasEjercicio {
  const t = TASAS_POR_EJERCICIO[ejercicio];
  if (!t) throw new Error(`Sin tasas fiscales para el ejercicio ${ejercicio}.`);
  return t;
}

/**
 * ¿La comisión de Vibra al creador EXTRANJERO califica como exportación de mediación a 0%?
 *
 * 🔴 PENDIENTE DE CONFIRMAR CON EL CONTADOR. Es una operación DISTINTA de la venta: que los 11
 * servicios sean exportación **no arrastra** a la intermediación de Vibra.
 *
 * Si resultara que no califica, esa comisión lleva 16% que **absorbe Vibra**, porque el
 * creador extranjero no lo acredita. Cambiar a `false` y el motor lo refleja solo.
 */
export const COMISION_A_EXTRANJERO_ES_EXPORTACION = true;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Impuesto de la VENTA
// ─────────────────────────────────────────────────────────────────────────────

/** Régimen del IVA mexicano de una venta. Espeja `MxVatTreatment` de config.ts. */
export type TratamientoIvaMx = "domestic_16" | "export_zero" | "export_taxable";

export type EntradaVenta = {
  /** Precio base, sin impuesto, en la moneda de liquidación. */
  base: number;
  /** País del comprador (ISO-2). */
  buyerCountry: string | null | undefined;
  /** Tipo de servicio, que decide el inciso de exportación. */
  serviceType?: LedgerServiceType | null;
  /** Tasa del impuesto mexicano. Se inyecta para no acoplar el motor a la tabla de países. */
  mxVatRate?: number;
};

export type ResultadoVenta = {
  tratamiento: TratamientoIvaMx;
  /** Tasa efectivamente aplicada al comprador. */
  mxVatRate: number;
  /** IVA mexicano cobrado. **Es la base de la retención de IVA.** */
  mxVatAmount: number;
  /**
   * IVA mexicano que Vibra debe enterar SIN habérselo cobrado a nadie.
   *
   * Solo aparece en `export_taxable`: el comprador extranjero ya pagó el impuesto de su país,
   * así que ese 16% no se le traslada — sale del margen de Vibra. Nunca suma al cobro.
   */
  mxVatAbsorbido: number;
};

const IVA_MX = 0.16;

/**
 * Impuesto mexicano de una venta.
 *
 * Dos capas, en este orden: comprador en México es siempre operación doméstica; comprador
 * fuera lo decide el SERVICIO, no el país de destino, porque la lista del artículo 29-IV
 * clasifica por tipo de servicio.
 *
 * ⚠️ El impuesto del país del comprador NO se calcula aquí: lo resuelve la tabla de países
 * (`countryTaxConfig`), que sabe además si Vibra está dada de alta para recaudarlo. Este
 * motor solo necesita el IVA mexicano, porque es el único retenible.
 */
export function resolveSaleTax(entrada: EntradaVenta): ResultadoVenta {
  const base = round2(entrada.base);
  const esMexicano = (entrada.buyerCountry ?? "").toUpperCase() === "MX";
  const rate = entrada.mxVatRate ?? IVA_MX;

  if (esMexicano) {
    return {
      tratamiento: "domestic_16",
      mxVatRate: rate,
      mxVatAmount: round2(base * rate),
      mxVatAbsorbido: 0,
    };
  }

  // Comprador fuera. Los 11 servicios se tratan como exportación (confirmado 2026-08-26);
  // `export_taxable` queda por si algún servicio futuro no encuadra en el 29-IV.
  const tratamiento: TratamientoIvaMx = "export_zero";
  return {
    tratamiento,
    mxVatRate: 0,
    mxVatAmount: 0,
    mxVatAbsorbido: 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Liquidación al CREADOR
// ─────────────────────────────────────────────────────────────────────────────

export type ResidenciaCreador = "MX" | "FOREIGN";

export type PerfilFiscalCreador = {
  residency: ResidenciaCreador;
  /** ¿Entregó su identificación fiscal? Sin ella, las retenciones se disparan. */
  hasTaxId: boolean;
  /**
   * País de la cuenta donde cobra (ISO-2).
   *
   * 🚨 Es un dato FISCAL, no logístico: un creador mexicano que cobra fuera de México pasa de
   * 50% a 100% de retención de IVA. Depende de dónde cobra ÉL, no de dónde estén las cuentas
   * de Vibra.
   */
  payoutAccountCountry?: string | null;
  /**
   * Creador extranjero cuyo pago se caracteriza como REGALÍA en vez de servicio.
   * Aplica sobre todo a contenido grabado y publicaciones de pago.
   */
  esRegalia?: boolean;
  /**
   * Tasa reducida por tratado, si hay constancia de residencia fiscal en el expediente.
   * Sin constancia NO aplica, por más que exista el tratado.
   */
  tasaTratado?: number | null;
};

export type EntradaLiquidacion = {
  /** Precio base de la venta, sin impuesto. */
  base: number;
  /** IVA mexicano cobrado en esa venta (de `resolveSaleTax`). */
  mxVatAmount: number;
  creador: PerfilFiscalCreador;
  /** Comisión de Vibra sobre la base. Default 25%. */
  commissionRate?: number;
  ejercicio?: Ejercicio;
};

export type ResultadoLiquidacion = {
  /** Participación del creador antes de retenciones: base × (1 − comisión). */
  participacion: number;
  /** Comisión de Vibra, sin su impuesto. */
  comision: number;
  /** Impuesto de la comisión. Va POR ENCIMA del 25%, nunca dentro. */
  ivaComision: number;
  isrRate: number;
  isrRetenido: number;
  ivaRate: number;
  ivaRetenido: number;
  /** Lo que se deposita. */
  neto: number;
  /** Ejercicio cuyas tasas se aplicaron. Se estampa para poder recalcular después. */
  ejercicio: Ejercicio;
};

/**
 * Cuánto se le deposita al creador.
 *
 * **Una sola fórmula sirve para los cuatro escenarios**, porque lo único que cambia entre
 * ellos es cuánto vale `mxVatAmount`:
 *
 * ```
 * neto = (base + ivaVenta) − (comisión + ivaComisión) − retIVA − retISR
 * ```
 *
 * La retención de IVA es una proporción del IVA cobrado, así que cuando la venta va a 0% se
 * anula sola: no hay que ramificar. El ISR, en cambio, **no depende del comprador** — son
 * siempre 2.5% sobre la base, venda a quien venda.
 */
export function resolveSettlement(entrada: EntradaLiquidacion): ResultadoLiquidacion {
  const ejercicio = entrada.ejercicio ?? EJERCICIO_VIGENTE;
  const t = tasasDe(ejercicio);
  const base = round2(entrada.base);
  const ivaVenta = round2(entrada.mxVatAmount);
  const commissionRate = entrada.commissionRate ?? 0.25;
  const c = entrada.creador;

  const comision = round2(base * commissionRate);
  const participacion = round2(base - comision);

  // El impuesto de la comisión va POR ENCIMA del 25%. Si fuera dentro, la comisión efectiva
  // caería a 21.55% y Vibra absorbería un impuesto que no puede acreditar.
  const esMx = c.residency === "MX";
  const comisionLlevaIva = esMx || !COMISION_A_EXTRANJERO_ES_EXPORTACION;
  const ivaComision = comisionLlevaIva ? round2(comision * t.ivaComisionMx) : 0;

  // ── ISR ───────────────────────────────────────────────────────────────────
  let isrRate: number;
  if (esMx) {
    isrRate = c.hasTaxId ? t.isrMxConRfc : t.isrMxSinRfc;
  } else if (c.esRegalia) {
    // Con tratado Y constancia de residencia en el expediente baja; sin constancia, no.
    isrRate = typeof c.tasaTratado === "number" ? c.tasaTratado : t.isrRegalia;
  } else {
    // Servicio prestado enteramente fuera: sin fuente de riqueza en México.
    isrRate = 0;
  }
  const isrRetenido = round2(base * isrRate);

  // ── IVA ───────────────────────────────────────────────────────────────────
  let ivaRate: number;
  if (esMx) {
    const cobraFuera =
      !!c.payoutAccountCountry && c.payoutAccountCountry.toUpperCase() !== "MX";
    ivaRate = !c.hasTaxId || cobraFuera ? t.ivaMxSinRfc : t.ivaMxConRfc;
  } else {
    ivaRate = t.ivaExtranjero;
  }
  const ivaRetenido = round2(ivaVenta * ivaRate);

  const neto = round2(base + ivaVenta - comision - ivaComision - ivaRetenido - isrRetenido);

  return {
    participacion,
    comision,
    ivaComision,
    isrRate,
    isrRetenido,
    ivaRate,
    ivaRetenido,
    neto,
    ejercicio,
  };
}

/** ¿Corresponde emitir constancia de retenciones? Solo si hubo alguna retención mexicana. */
export function requiereCfdiRetenciones(r: ResultadoLiquidacion): boolean {
  return r.isrRetenido > 0 || r.ivaRetenido > 0;
}
