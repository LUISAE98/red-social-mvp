// Motor fiscal — ESPEJO DE PRESENTACIÓN. Módulo PURO: sin Firebase, sin red, sin reloj.
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
// ⚠️ ESTE ARCHIVO NO DECIDE NADA. El cálculo autoritativo vive en
// `backend/src/tax/fiscalEngine.ts`; aquí solo se replica para que la wallet pueda MOSTRAR el
// desglose sin volver a inventarlo. `test/unit/fiscalEngine.test.ts` verifica que ambos
// coincidan al centavo — si se desalinean, el creador ve un número y cobra otro.
//
// Documento de referencia: `docs/legal/fiscal-iva-isr-plataforma.md` §0.

import type { LedgerServiceType } from "@/lib/wallet/walletLedger";

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
  /**
   * ISR retenido a creador mexicano.
   *
   * 🚫 NO hay tasa "sin RFC". El artículo 113-A prevé un 20% para quien no da su RFC,
   *    pero esa tasa es INALCANZABLE aquí: la retención ocurre al PAGAR y en Vibra no se
   *    puede cobrar sin RFC dado de alta. Tenerla solo servía para asustar en pantalla a
   *    creadores que, para el momento en que cobren, siempre tendrán RFC.
   *    Eliminada el 2026-08-30 por decisión de producto.
   */
  isrMx: number;
  /** Proporción del IVA cobrado que se retiene a creador mexicano. */
  ivaMx: number;
  /**
   * Proporción retenida al mexicano que COBRA FUERA de México.
   *
   * Sobrevive a la limpieza del "sin RFC" porque es otra cosa: no depende de si dio su
   * RFC sino de dónde tiene la cuenta. Cobrando fuera se retiene el IVA completo.
   */
  ivaMxCobraFuera: number;
  /** Proporción retenida al creador extranjero que vende a comprador mexicano. */
  ivaExtranjero: number;
  /** ISR a creador extranjero cuando el pago se caracteriza como regalía. */
  isrRegalia: number;
  /** IVA de la comisión de Vibra cuando el creador es mexicano. */
  ivaComisionMx: number;
};

export const TASAS_POR_EJERCICIO: Readonly<Record<Ejercicio, TasasEjercicio>> = {
  2026: {
    isrMx: 0.025,
    ivaMx: 0.5,
    ivaMxCobraFuera: 1,
    ivaExtranjero: 1,
    isrRegalia: 0.25,
    ivaComisionMx: 0.16,
  },
};

/** Ejercicio vigente. Al cambiar de año se agrega la fila y se mueve esto. */
export const EJERCICIO_VIGENTE: Ejercicio = 2026;


/**
 * Ejercicio fiscal al que pertenece una operación.
 *
 * ⚠️ NO uses `EJERCICIO_VIGENTE` para liquidar: es una constante que se sube a mano y, si se
 * olvida en enero, todo el año nuevo se calcularía con las tasas del anterior. Peor aún, una
 * venta del 31 de diciembre que se liquida el 2 de enero pertenece al ejercicio de la VENTA,
 * no al del día en que se procesó.
 *
 * Por eso el ejercicio se deriva de la fecha de la operación, y el resultado se estampa.
 */
export function ejercicioDeFecha(fecha: Date | string | number): Ejercicio {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  const anio = d.getUTCFullYear();
  if (!Number.isFinite(anio)) throw new Error("Fecha inválida para determinar el ejercicio.");
  return anio;
}

/**
 * Versión del motor. Se estampa en cada liquidación junto al ejercicio.
 *
 * El ejercicio dice qué TASAS se usaron; esto dice qué FÓRMULA. Si mañana cambia la mecánica
 * —por ejemplo si el impuesto de la comisión pasara a ir dentro del 25%— hay que poder
 * distinguir un asiento viejo de uno nuevo sin adivinarlo por la fecha.
 */
export const MOTOR_VERSION = 1;

export function tasasDe(ejercicio: Ejercicio): TasasEjercicio {
  const t = TASAS_POR_EJERCICIO[ejercicio];
  if (!t) throw new Error(`Sin tasas fiscales para el ejercicio ${ejercicio}.`);
  return t;
}

/**
 * ¿La comisión de Vibra al creador EXTRANJERO califica como exportación de mediación a 0%?
 *
 * ✅ **CONFIRMADO POR EL FISCALISTA (2026-08-29).** Sí califica.
 *
 * Es una operación DISTINTA de la venta: que los 11 servicios del creador salgan a 0% por
 * exportación no arrastra automáticamente a la comisión que Vibra le cobra a él. Son dos
 * hechos imponibles separados y había que confirmarlo por su cuenta.
 *
 * En `true` la comisión al extranjero NO lleva IVA. En `false` llevaría el 16%, que Vibra
 * tendría que absorber de su margen porque el creador extranjero no lo puede acreditar.
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
  /** Tratamiento ya resuelto por el cobro. Si viene, manda sobre el cálculo local. */
  tratamiento?: TratamientoIvaMx;
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
 *
 * 🚨 EN EL COBRO REAL manda `composeCharge`, no esta función. Allí el tratamiento sale de
 * `mxVatTreatmentForSale`, que es la tabla que un fiscalista puede editar servicio por
 * servicio. Ésta existe para PREVISUALIZAR y para alimentar `resolveSettlement` en pruebas.
 * Si algún día divergen, la que vale es la del cobro — por eso `tratamiento` se puede
 * inyectar, para pasarle el valor autoritativo en vez de recalcularlo.
 */
export function resolveSaleTax(entrada: EntradaVenta): ResultadoVenta {
  const base = round2(entrada.base);
  const esMexicano = (entrada.buyerCountry ?? "").toUpperCase() === "MX";
  const rate = entrada.mxVatRate ?? IVA_MX;

  if (esMexicano) {
    return {
      tratamiento: entrada.tratamiento ?? "domestic_16",
      mxVatRate: rate,
      mxVatAmount: round2(base * rate),
      mxVatAbsorbido: 0,
    };
  }

  // Comprador fuera. Los 11 servicios se tratan como exportación (confirmado 2026-08-26);
  // `export_taxable` queda por si algún servicio futuro no encuadre en el 29-IV.
  const tratamiento: TratamientoIvaMx = entrada.tratamiento ?? "export_zero";
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
  /**
   * ¿Entregó su identificación fiscal?
   *
   * ⚠️ **YA NO CAMBIA NINGUNA TASA.** Desde el 2026-08-30 el mexicano se liquida siempre
   * con las mismas, porque sin RFC no puede cobrar y la tasa agravada nunca llegaba a
   * aplicarse. El campo se conserva porque el asiento lo estampa como rastro de auditoría
   * y porque la factura sí lo necesita — pero si vuelves a ramificar una tasa con esto,
   * lee antes el comentario de `isrMx`.
   */
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
   * País del documento con el que se verificó (ISO-2).
   *
   * Respaldo del anterior para decidir comisión y ruta: un creador que cobra por Wallbit
   * nunca da de alta cuenta en Stripe, así que `payoutAccountCountry` se queda vacío para
   * siempre. Ver `paisDeCobroDe` en `wallet/payoutTiers.ts`.
   *
   * ⚠️ NO sustituye al de la cuenta para lo fiscal: la retención de IVA depende de dónde
   * cobra, no de dónde es.
   */
  documentCountry?: string | null;
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
  /** Versión de la FÓRMULA, distinta del ejercicio, que es la versión de las TASAS. */
  motorVersion: number;
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
    // Siempre la misma tasa. Ver `isrMx`: sin RFC no se puede cobrar, así que la tasa
    // agravada nunca llegaría a aplicarse y solo servía para asustar en pantalla.
    isrRate = t.isrMx;
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
    ivaRate = cobraFuera ? t.ivaMxCobraFuera : t.ivaMx;
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
    motorVersion: MOTOR_VERSION,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. Desglose del RETIRO
// ─────────────────────────────────────────────────────────────────────────────

export type EntradaRetiro = {
  /** Saldo disponible: la suma de participaciones del 75%, SIN retenciones aplicadas. */
  saldo: number;
  /** Cuánto quiere retirar. Si se omite, se retira todo. */
  solicitado?: number;
  /** Retenciones acumuladas y todavía no aplicadas a ningún retiro. */
  isrPendiente: number;
  ivaPendiente: number;
  /** Impuesto de la comisión, que el creador paga y —con RFC— acredita. */
  ivaComisionPendiente: number;
};

export type ResultadoRetiro = {
  /** Lo que se retira del saldo. */
  bruto: number;
  isr: number;
  iva: number;
  ivaComision: number;
  /** Lo que de verdad le llega. */
  neto: number;
  /** Qué proporción del saldo se está retirando. 1 = todo. */
  proporcion: number;
};

/**
 * Qué recibe el creador al retirar.
 *
 * ⚠️ DECISIÓN DE PRODUCTO (Luis, 2026-08-26): las retenciones NO bajan el saldo de la wallet.
 * El creador ve su 75% íntegro y los descuentos aparecen aquí, al pulsar «Retirar». Es lo que
 * dice la ley al pie de la letra —la retención ocurre cuando se paga, no cuando se vende— y
 * evita que el saldo baje sin explicación.
 *
 * **Los retiros parciales consumen las retenciones EN PROPORCIÓN.** Aplicarlas todas al primer
 * retiro dejaría a quien saca 10 de un saldo de 1,000 pagando el impuesto de los mil; dejarlas
 * todas para el final le regalaría el primer retiro y le cobraría el último de golpe.
 */
export function calcularRetiro(entrada: EntradaRetiro): ResultadoRetiro {
  const saldo = round2(entrada.saldo);
  const bruto = round2(Math.min(entrada.solicitado ?? saldo, saldo));
  if (!(saldo > 0) || !(bruto > 0)) {
    return { bruto: 0, isr: 0, iva: 0, ivaComision: 0, neto: 0, proporcion: 0 };
  }

  const proporcion = bruto / saldo;
  const isr = round2(entrada.isrPendiente * proporcion);
  const iva = round2(entrada.ivaPendiente * proporcion);
  const ivaComision = round2(entrada.ivaComisionPendiente * proporcion);

  // El neto nunca puede ser negativo: si las retenciones se comieran el retiro, lo que
  // corresponde es no dejar retirar, no depositar en rojo.
  const neto = round2(Math.max(0, bruto - isr - iva - ivaComision));

  return { bruto, isr, iva, ivaComision, neto, proporcion };
}

/** ¿Corresponde emitir constancia de retenciones? Solo si hubo alguna retención mexicana. */
export function requiereCfdiRetenciones(r: ResultadoLiquidacion): boolean {
  return r.isrRetenido > 0 || r.ivaRetenido > 0;
}
