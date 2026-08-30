/**
 * Libro mayor de wallet (Opción A).
 *
 * Fuente de verdad de las ganancias del creador. Cada venta genera UNA entrada
 * en `users/{creatorId}/walletLedger/{entryId}` y se mantiene un resumen
 * agregado en `users/{creatorId}/walletSummary/current` de forma transaccional,
 * para que Finanzas lea un solo documento (rápido y auditable).
 *
 * Estados de una entrada:
 *  - "pending"  : pagado pero no entregado (grupo B: saludos, consejos, sesiones).
 *  - "earned"   : cuenta como ganancia del creador.
 *  - "refunded" : estaba "earned" y se reembolsó (resta de ganado).
 *  - "rejected" : estaba "pending" y se rechazó/no se entregó (dinero perdido).
 *
 * Estas funciones son helpers: las Cloud Functions de cada servicio las llaman
 * en el momento correcto (Fase 2). No procesan pagos por sí mismas.
 */

import * as admin from "firebase-admin";
import {
  resolveSaleTax,
  resolveSettlement,
  ejercicioDeFecha,
  type PerfilFiscalCreador,
} from "../tax/fiscalEngine";
import {
  payoutTermsOf,
  paisDeCobroDe,
  PAYOUT_TERMS_PROVISIONAL,
  type PayoutTerms,
} from "./payoutTiers";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

/**
 * Comisión del caso ESTÁNDAR. El creador recibe el neto (1 - comisión).
 *
 * 25% desde 2026-07-31 (reparto 75/25). Ver docs/modelo-financiero.md.
 *
 * ⚠️ **Ya no es LA comisión de todos (2026-08-27).** Depende del país de la cuenta de cobro:
 * donde la transferencia bancaria es cara son 30%. La comisión de cada venta sale de
 * `payoutTermsOf` y se CONGELA en el asiento. Esta constante sigue siendo el caso estándar,
 * que es el de 45 de los 74 países pagables y el que se muestra a quien todavía no tiene
 * cuenta. Ver `docs/payout-tiers.md`.
 */
export const WALLET_COMMISSION_RATE = 0.25;
export const WALLET_NET_RATE = 1 - WALLET_COMMISSION_RATE; // 0.75

/**
 * Moneda de LIQUIDACIÓN de Vibra (en la que se guarda el ledger y se cobra en Stripe).
 * USD desde el corte a Vibra On, LLC (2026-08-18). ⚠️ Mantener en sync con
 * SETTLEMENT_CURRENCY del frontend en lib/currency/catalog.ts.
 * El comprador siempre ve y paga en su moneda local (ver tax/presentment.ts).
 *
 * ⚠️ Los asientos ANTERIORES al corte llevan `currency: "MXN"` propio y se quedan así:
 * son historia y se describen solos. No se convierten.
 */
export const SETTLEMENT_CURRENCY = "USD";

/**
 * Cargo fijo por transacción que ABSORBE EL COMPRADOR (no el creador). Se suma al
 * precio base del creador antes del impuesto: el comprador paga (base + cargo) + impuesto,
 * el creador recibe 75% de la base. Protege el margen en cobros chicos. Ver docs/modelo-financiero.md (D1).
 *
 * 💵 $0.40 = $0.30 del fijo de Stripe en EE. UU. + $0.05 de Radar, con el margen que
 * exige que Stripe cobre su PORCENTAJE también sobre este cargo (mínimo real
 * 0.35÷(1−tasa): 0.361 nacional, 0.370 internacional).
 */
export const FIXED_SERVICE_FEE_USD = 0.4;

/**
 * Mínimo de una donación, en la moneda de liquidación.
 *
 * ⚠️ ESPEJO de `DONATION_MIN_AMOUNT_USD` en lib/currency/catalog.ts. Hay un test que
 * compara los dos: si se separan, un creador podría configurar un monto que el servidor
 * rechaza al cobrar, o al revés.
 *
 * Era 50 y estaba pensado en pesos. Con la denominación en USD pedía 50 dólares por
 * donación, así que ninguna de las sugeridas por defecto se podía pagar.
 */
export const DONATION_MIN_AMOUNT_USD = 3;

/**
 * Mínimo de un contenido de pago (post premium, ticket de live, VOD).
 *
 * ⚠️ ESPEJO de `PREMIUM_MIN_PRICE_USD` en lib/currency/catalog.ts, con test de paridad.
 *
 * Antes `createPost` usaba un 10 escrito a mano, que eran DIEZ PESOS de cuando la
 * plataforma cobraba en MXN. Con la denominación en USD pasaron a ser diez dólares y el
 * servidor rechazaba cualquier publicación de pago por debajo de eso — un post de 3 USD
 * salía como «El precio no es válido» aunque el panel dijera que era correcto.
 */
export const PREMIUM_MIN_PRICE_USD = 1.5;

/**
 * Mínimo de una entrada a una transmisión en vivo.
 *
 * ⚠️ ESPEJO de `LIVE_TICKET_MIN_PRICE_USD` en lib/currency/catalog.ts, con test de paridad.
 *
 * Se guarda aparte de `PREMIUM_MIN_PRICE_USD` aunque hoy valgan lo mismo: son dos
 * decisiones de producto distintas y unificarlas haría que cambiar una moviera la otra
 * sin que nadie lo pidiera.
 */
export const LIVE_TICKET_MIN_PRICE_USD = 1.5;

/**
 * Mínimo de un supercomentario (el precio de su nivel).
 * ⚠️ ESPEJO de `SUPER_COMMENT_MIN_PRICE_USD` en lib/currency/catalog.ts, con test de paridad.
 */
export const SUPER_COMMENT_MIN_PRICE_USD = 1.5;

/**
 * Mínimo de la cuota mensual de una comunidad.
 * ⚠️ ESPEJO de `SUBSCRIPTION_MIN_PRICE_USD` en lib/currency/catalog.ts, con test de paridad.
 */
export const SUBSCRIPTION_MIN_PRICE_USD = 1.5;

/**
 * Mínimo por experiencia que el creador entrega, por clave de servicio.
 *
 * ⚠️ ESPEJO de `SERVICE_MIN_PRICE_USD` en lib/currency/catalog.ts, con test de paridad.
 *
 * Hasta ahora estos mínimos vivían SOLO en el panel de configuración, es decir, solo en el
 * navegador. El precio del cobro lo lee el servidor del perfil del creador, así que no era
 * un agujero de seguridad, pero sí dejaba pasar un precio por debajo del mínimo guardado
 * con un cliente modificado.
 */
export const SERVICE_MIN_PRICE_USD: Readonly<Record<string, number>> = {
  greeting: 3,
  advice: 3,
  exclusive_session: 9,
  live_session: 9,
};

export type LedgerServiceType =
  | "supercomment"
  | "profile_donation"
  | "live_donation"
  | "live_ticket"
  | "premium_post"
  | "greeting"
  | "advice"
  | "exclusive_session"
  | "live_session"
  | "subscription"
  | "vod_ticket";

export type LedgerStatus = "pending" | "earned" | "refunded" | "rejected";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Neto (lo que recibe el creador) a partir del bruto (lo que pagó el cliente).
 *
 * Sin comisión explícita usa la estándar, que es lo correcto para quien todavía no tiene
 * cuenta de cobro y para las llamadas que solo quieren una estimación. Quien registra una
 * venta de verdad SÍ debe pasarla, porque es la que se congela en el asiento.
 */
export function netFromGross(gross: number, commissionRate?: number): number {
  const rate = typeof commissionRate === "number" ? commissionRate : WALLET_COMMISSION_RATE;
  return round2(gross * (1 - rate));
}

/** Normaliza la fecha real de la venta a Timestamp; si no hay, usa el reloj del servidor. */
function toOccurredAt(value?: unknown) {
  if (value instanceof admin.firestore.Timestamp) return value;
  if (value instanceof Date) return admin.firestore.Timestamp.fromDate(value);
  if (
    value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return admin.firestore.Timestamp.fromDate(
      (value as { toDate: () => Date }).toDate()
    );
  }
  return FieldValue.serverTimestamp();
}

function ledgerCollection(creatorId: string) {
  return db.collection("users").doc(creatorId).collection("walletLedger");
}

function summaryRef(creatorId: string) {
  return db
    .collection("users")
    .doc(creatorId)
    .collection("walletSummary")
    .doc("current");
}

/** Id determinista por venta → idempotencia (no duplica la misma entrada). */
function deterministicEntryId(sourceType: string, sourceId: string): string {
  return `${sourceType}__${sourceId}`;
}

type SummaryData = {
  currency: string;
  lifetimeEarnedGross: number;
  lifetimeEarnedNet: number;
  withdrawnGross: number;
  withdrawnNet: number;
  pendingGross: number;
  pendingNet: number;
  refundedGross: number;
  refundedNet: number;
  rejectedGross: number;
  rejectedNet: number;
  /**
   * 🧾 IVA — Total de impuesto COBRADO al comprador en ventas ya ganadas (va al SAT,
   * NO es del creador). Solo informativo/transparencia; no suma a las ganancias.
   * Se acumula al ganar y se resta al reembolsar, en paralelo a lifetimeEarnedNet.
   */
  lifetimeTaxCollected: number;
  /**
   * 🧾 RETENCIONES acumuladas de las ventas ya ganadas.
   *
   * ⚠️ NO están restadas de `lifetimeEarnedNet`. Se llevan aparte a propósito, porque
   * aplicarlas al saldo cambia lo que ven todos los creadores a la vez y eso va en su propio
   * paso. Aquí solo se cuentan, para poder cuadrar contra lo enterado al SAT.
   *
   * Se suman al ganar y se restan al revertir, en paralelo a `lifetimeEarnedNet`.
   */
  /**
   * 🧾 Retenciones ACUMULADAS DE POR VIDA. Solo suben.
   *
   * Sirven para el informe anual y para explicarle al creador cuánto se ha pagado al SAT por
   * él. **No sirven para calcular un retiro**: si ya retiró una vez, estas cifras siguen
   * incluyendo lo retenido de aquellas ventas y descontarlas otra vez sería cobrárselas dos
   * veces. Para eso están los campos `pending*` de abajo.
   */
  lifetimeRetainedIsr: number;
  lifetimeRetainedIva: number;
  /** Impuesto de la comisión de Vibra. Lo paga el creador y, si tiene RFC, lo acredita. */
  lifetimeCommissionVat: number;

  /**
   * 🧾 Retenciones de lo que TODAVÍA NO SE HA RETIRADO.
   *
   * Es lo que hay que descontar cuando el creador pide su dinero. Suben al ganar y bajan al
   * retirar o al revertir, así que en todo momento reflejan solo las ventas cuyo importe
   * sigue en su saldo disponible.
   *
   * 🚨 Cada una viene de la venta que la generó, con el país de SU comprador: una venta a un
   * mexicano lleva IVA retenido y una a un alemán no, porque su IVA mexicano es cero por
   * exportación. No es un porcentaje sobre el total, es la suma de casos distintos.
   */
  pendingRetainedIsr: number;
  pendingRetainedIva: number;
  pendingCommissionVat: number;
};

function emptySummary(): SummaryData {
  return {
    currency: SETTLEMENT_CURRENCY,
    lifetimeEarnedGross: 0,
    lifetimeEarnedNet: 0,
    withdrawnGross: 0,
    withdrawnNet: 0,
    pendingGross: 0,
    pendingNet: 0,
    refundedGross: 0,
    refundedNet: 0,
    rejectedGross: 0,
    rejectedNet: 0,
    lifetimeTaxCollected: 0,
    lifetimeRetainedIsr: 0,
    lifetimeRetainedIva: 0,
    lifetimeCommissionVat: 0,
    pendingRetainedIsr: 0,
    pendingRetainedIva: 0,
    pendingCommissionVat: 0,
  };
}

export type RecordEarningParams = {
  type: LedgerServiceType;
  /** Monto bruto en MXN (lo que paga el cliente). */
  grossAmount: number;
  /** Colección/entidad de origen (p.ej. "greetingRequest"). */
  sourceType: string;
  /** Id del documento de origen. */
  sourceId: string;
  buyerId?: string | null;
  /**
   * true  = grupo A (cuenta como ganado apenas se paga) → estado "earned".
   * false = grupo B (cuenta al entregar/concluir) → estado "pending".
   */
  earnedImmediately: boolean;
  /** Fecha REAL de la venta (para gráficas de tiempo). Si no, usa el reloj. */
  occurredAt?: unknown;
  /** Canal que originó la venta: perfil del creador o una comunidad. */
  channelType?: "profile" | "group";
  /** Id de la comunidad si channelType = "group"; null para perfil. */
  channelId?: string | null;
  /** Id del post del live si la venta pertenece a una transmisión; null si no. */
  liveId?: string | null;
  /** Id de la publicación (para tickets: post premium / VOD); null si no aplica. */
  postId?: string | null;
  /** 🧾 IVA — País fiscal del comprador (ISO-2) o null. Solo registro/transparencia. */
  taxCountry?: string | null;
  /** 🧾 IVA — Impuesto COBRADO al comprador (va al SAT, NO es del creador). Default 0. */
  taxAmount?: number;
};

/**
 * Lee el perfil fiscal del creador para calcular sus retenciones.
 *
 * ⚠️ Se lee EN EL MOMENTO DE LA VENTA y se congela en el asiento. Si el creador sube su RFC
 * mañana, las ventas de hoy siguen con la retención que les tocaba: la retención se determina
 * cuando nace la obligación, no cuando el creador arregla sus papeles.
 *
 * Sin perfil, la suposición es la MÁS CONSERVADORA que no perjudica al creador: mexicano sin
 * identificación fiscal retiene 20% de ISR, y quedarse corto es un pasivo de Vibra. Por eso
 * `hasTaxId` sale de lo que haya, y el país de cobro se asume México (ver §0.6 del documento
 * fiscal, pendiente de la pantalla donde el creador lo elige).
 */
async function perfilFiscalDe(creatorId: string): Promise<PerfilFiscalCreador> {
  try {
    const [snap, kycSnap] = await Promise.all([
      db.collection("creatorTaxProfiles").doc(creatorId).get(),
      db.collection("kyc").doc(creatorId).get(),
    ]);
    const d = snap.exists ? snap.data() ?? {} : {};
    const kyc = kycSnap.exists ? kycSnap.data() ?? {} : {};
    const residency = d.residency === "FOREIGN" ? "FOREIGN" : "MX";
    return {
      residency,
      hasTaxId: typeof d.taxId === "string" && d.taxId.trim().length > 0,
      payoutAccountCountry:
        typeof d.payoutAccountCountry === "string" ? d.payoutAccountCountry : null,
      /**
       * País del documento del KYC, de respaldo para quien no tiene cuenta de Stripe.
       *
       * Se lee en la MISMA transacción de lectura que el perfil, no en una aparte: es un
       * dato más del creador y separarlo solo añadiría una consulta.
       */
      documentCountry:
        typeof kyc?.documentCountry === "string" ? kyc.documentCountry : null,
    };
  } catch {
    // Un fallo de lectura no puede tumbar una venta ya cobrada. Se asume el caso base.
    return {
      residency: "MX",
      hasTaxId: false,
      payoutAccountCountry: null,
      documentCountry: null,
    };
  }
}

/**
 * Registra una venta pagada en el libro mayor. Idempotente por (sourceType, sourceId).
 */
export async function recordEarning(
  creatorId: string,
  params: RecordEarningParams
): Promise<void> {
  const gross = round2(params.grossAmount);
  // 🧾 IVA — Impuesto cobrado al comprador (informativo; no es del creador).
  const taxAmount = round2(params.taxAmount ?? 0);
  const status: LedgerStatus = params.earnedImmediately ? "earned" : "pending";
  const entryRef = ledgerCollection(creatorId).doc(
    deterministicEntryId(params.sourceType, params.sourceId)
  );
  const sRef = summaryRef(creatorId);

  // Contador público de experiencias. Va aquí y no en otro lado porque ESTE es
  // el embudo por el que pasan las once formas de vender: contando aquí no hay
  // una venta que se escape ni una que se cuente dos veces —el id de la entrada
  // es determinista y arriba se sale si ya existía—.
  //
  // Una venta hecha dentro de una comunidad suma en las dos cuentas: en la del
  // creador, porque la hizo él, y en la de la comunidad, porque ahí ocurrió.
  const creatorRef = db.collection("users").doc(creatorId);
  const groupRef =
    params.channelType === "group" && params.channelId
      ? db.collection("groups").doc(params.channelId)
      : null;

  // 🧾 RETENCIONES. Se calculan FUERA de la transacción a propósito: leer el perfil fiscal
  // dentro obligaría a incluirlo en el conjunto de lectura y a reintentar la transacción
  // completa cada vez que el creador tocara sus datos, por una venta que no tiene nada que
  // ver. El perfil cambia rara vez; la venta es la que no puede fallar.
  const perfil = await perfilFiscalDe(creatorId);

  /**
   * 💰 LA COMISIÓN DE ESTA VENTA, decidida por el país de la CUENTA DE COBRO.
   *
   * 25% en los 45 países de transferencia local, 30% en los 29 donde solo llega el wire y
   * cuesta 25 USD fijos. Ver `docs/payout-tiers.md`.
   *
   * Se resuelve aquí, junto al perfil, y se CONGELA en el asiento unas líneas más abajo. Es
   * lo que hace cumplible la promesa de no recalcular hacia atrás: si el creador se muda o
   * cambia de banco, sus ventas anteriores conservan la comisión que tenían.
   *
   * ⚠️ Sin país conocido —o con un país sin ruta de pago— se aplica la ESTÁNDAR. La venta ya
   * se cobró al comprador y el asiento no se puede rechazar; entre las dos, la benigna para
   * el creador es la baja. Que no se le pueda pagar es un problema del retiro, no del
   * registro, y se resuelve en el gate con `isPayableCountry`.
   */
  const terms: Readonly<PayoutTerms> =
    payoutTermsOf(paisDeCobroDe(perfil)) ?? PAYOUT_TERMS_PROVISIONAL;
  const net = netFromGross(gross, terms.commissionRate);

  /**
   * ⚠️ LA BASE DE LA RETENCIÓN ES LA VENTA DEL CREADOR, NO EL TOTAL COBRADO.
   *
   * `taxAmount` es el impuesto que pagó el comprador, y ese se calcula sobre TODO lo que se le
   * cobra: el precio del creador **más el cargo fijo de Vibra y el 2% de conversión**. Dentro
   * de un mismo cobro conviven dos ventas —la del creador y la de Vibra— y solo la primera es
   * suya.
   *
   * Con un precio de 100 y cargo de 3, el comprador paga 16.48 de IVA. Del creador son 16.00;
   * los 0.48 restantes son de Vibra. Retenerle los 16.48 sería retenerle impuesto de una venta
   * que no hizo.
   *
   * Y `taxAmount` tampoco sirve con comprador extranjero: ahí es el IVA de SU país, no el
   * mexicano. Retener sobre él sería una retención mexicana sobre un impuesto alemán.
   *
   * Por eso la base se recalcula con el motor: el IVA mexicano que corresponde a la venta del
   * creador y a nadie más. Con comprador fuera da cero —exportación— y la retención se anula
   * sola, sin ramificar.
   */
  const ventaFiscal = resolveSaleTax({
    base: gross,
    buyerCountry: params.taxCountry,
    serviceType: params.type,
  });

  const liquidacion = resolveSettlement({
    base: gross,
    mxVatAmount: ventaFiscal.mxVatAmount,
    creador: perfil,
    ejercicio: ejercicioDeFecha(new Date()),
    // La MISMA del asiento. Sin pasarla, el motor caía a su 25% de respaldo y a un creador
    // de 30% se le calculaba el IVA de una comisión que no es la suya.
    commissionRate: terms.commissionRate,
  });

  await db.runTransaction(async (tx) => {
    // Todas las lecturas ANTES de cualquier escritura: es la regla de las
    // transacciones de Firestore.
    const [entrySnap, sSnap, creatorSnap, groupSnap] = await Promise.all([
      tx.get(entryRef),
      tx.get(sRef),
      tx.get(creatorRef),
      groupRef ? tx.get(groupRef) : Promise.resolve(null),
    ]);
    if (entrySnap.exists) return; // ya registrado

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    tx.set(entryRef, {
      creatorId,
      type: params.type,
      status,
      grossAmount: gross,
      netAmount: net,
      /**
       * 💰 CONGELADOS. La comisión que se aplicó y de dónde salió.
       *
       * `payoutCountry` se guarda aunque sea `null` para que un asiento viejo se pueda
       * explicar solo, sin ir a buscar cómo estaba el perfil aquel día — que es justo el
       * dato que ya no existe cuando el creador cambia de banco.
       */
      commissionRate: terms.commissionRate,
      commissionTier: terms.tier,
      payoutCountry: perfil.payoutAccountCountry ?? null,
      // 🧾 IVA — desglose fiscal por venta (informativo; el IVA va al SAT, no al creador).
      taxCountry: params.taxCountry ?? null,
      taxAmount,
      /**
       * 🧾 RETENCIONES de esta venta, congeladas con las tasas y el perfil de HOY.
       *
       * ⚠️ `netAmount` sigue siendo la participación del 75% y NO se toca aquí. Restar las
       * retenciones del saldo es un cambio visible para todos los creadores a la vez, y va en
       * su propio paso junto con la pantalla que se lo explica. Registrarlas ahora sin
       * aplicarlas permite auditar y cuadrar sin mover el dinero de nadie por sorpresa.
       */
      retenciones: {
        comision: liquidacion.comision,
        ivaComision: liquidacion.ivaComision,
        isrRate: liquidacion.isrRate,
        isrRetenido: liquidacion.isrRetenido,
        ivaRate: liquidacion.ivaRate,
        ivaRetenido: liquidacion.ivaRetenido,
        neto: liquidacion.neto,
        ejercicio: liquidacion.ejercicio,
        motorVersion: liquidacion.motorVersion,
        // Con qué perfil se calculó. Sin esto no se puede explicar una retención vieja.
        residency: perfil.residency,
        hasTaxId: perfil.hasTaxId,
        payoutAccountCountry: perfil.payoutAccountCountry ?? null,
      },
      currency: SETTLEMENT_CURRENCY,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      buyerId: params.buyerId ?? null,
      channelType: params.channelType ?? "profile",
      channelId: params.channelId ?? null,
      liveId: params.liveId ?? null,
      postId: params.postId ?? null,
      createdAt: now,
      occurredAt: toOccurredAt(params.occurredAt),
      earnedAt: status === "earned" ? now : null,
      settledAt: null,
      reversedAt: null,
    });

    if (status === "earned") {
      s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross + gross);
      s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet + net);
      // 🧾 IVA — el impuesto se cobra al ganar (venta inmediata). En pending se cuenta al liberar.
      s.lifetimeTaxCollected = round2((s.lifetimeTaxCollected ?? 0) + taxAmount);
      s.lifetimeRetainedIsr = round2((s.lifetimeRetainedIsr ?? 0) + liquidacion.isrRetenido);
      s.lifetimeRetainedIva = round2((s.lifetimeRetainedIva ?? 0) + liquidacion.ivaRetenido);
      s.lifetimeCommissionVat = round2((s.lifetimeCommissionVat ?? 0) + liquidacion.ivaComision);
      // Y las pendientes, que son las que se descontarán cuando pida su dinero.
      s.pendingRetainedIsr = round2((s.pendingRetainedIsr ?? 0) + liquidacion.isrRetenido);
      s.pendingRetainedIva = round2((s.pendingRetainedIva ?? 0) + liquidacion.ivaRetenido);
      s.pendingCommissionVat = round2((s.pendingCommissionVat ?? 0) + liquidacion.ivaComision);
    } else {
      s.pendingGross = round2(s.pendingGross + gross);
      s.pendingNet = round2(s.pendingNet + net);
    }

    tx.set(sRef, { ...s, currency: SETTLEMENT_CURRENCY, updatedAt: now }, { merge: true });

    // Se suma en cuanto la venta ocurre, no cuando el dinero se libera: la
    // experiencia ya pasó. Y no se resta al devolver — decisión de producto, el
    // número solo sube.
    //
    // Se comprueba que el documento exista antes de escribirlo. Con `merge` a
    // secas, una comunidad ya borrada reviviría como un documento fantasma con
    // un solo campo dentro.
    if (creatorSnap.exists) {
      tx.set(
        creatorRef,
        { experiencesCount: FieldValue.increment(1) },
        { merge: true }
      );
    }

    if (groupRef && groupSnap?.exists) {
      tx.set(
        groupRef,
        { experiencesCount: FieldValue.increment(1) },
        { merge: true }
      );
    }
  });
}

/**
 * Sella la fecha real de venta en una entrada YA existente (para el backfill
 * de datos históricos que se registraron sin occurredAt).
 */
export async function stampOccurredAt(
  creatorId: string,
  sourceType: string,
  sourceId: string,
  occurredAt: Date
): Promise<void> {
  const ref = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set(
    { occurredAt: admin.firestore.Timestamp.fromDate(occurredAt) },
    { merge: true }
  );
}

/**
 * Sella el canal (perfil/comunidad) en una entrada YA existente, para el
 * backfill de datos que se registraron antes de trackear canal.
 */
export async function stampChannel(
  creatorId: string,
  sourceType: string,
  sourceId: string,
  channelType: "profile" | "group",
  channelId: string | null
): Promise<void> {
  const ref = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.set({ channelType, channelId: channelId ?? null }, { merge: true });
}

/**
 * Grupo B: pasa una entrada "pending" a "earned" (servicio entregado/concluido).
 */
export async function settleEarning(
  creatorId: string,
  sourceType: string,
  sourceId: string
): Promise<void> {
  const entryRef = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const sRef = summaryRef(creatorId);

  await db.runTransaction(async (tx) => {
    const [entrySnap, sSnap] = await Promise.all([tx.get(entryRef), tx.get(sRef)]);
    if (!entrySnap.exists) return;
    const e = entrySnap.data() as {
      status: LedgerStatus;
      grossAmount: number;
      netAmount: number;
      taxAmount?: number;
      retenciones?: { isrRetenido?: number; ivaRetenido?: number; ivaComision?: number };
    };
    if (e.status !== "pending") return; // solo pending -> earned

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    tx.update(entryRef, { status: "earned", earnedAt: now, settledAt: now });

    s.pendingGross = round2(s.pendingGross - e.grossAmount);
    s.pendingNet = round2(s.pendingNet - e.netAmount);
    s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross + e.grossAmount);
    s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet + e.netAmount);
    // 🧾 IVA — al liberar (entregado) se cuenta el impuesto cobrado de esta venta.
    s.lifetimeTaxCollected = round2((s.lifetimeTaxCollected ?? 0) + (e.taxAmount ?? 0));
    // Las retenciones se congelaron al registrar la venta; aquí solo se acumulan.
    s.lifetimeRetainedIsr = round2((s.lifetimeRetainedIsr ?? 0) + (e.retenciones?.isrRetenido ?? 0));
    s.lifetimeRetainedIva = round2((s.lifetimeRetainedIva ?? 0) + (e.retenciones?.ivaRetenido ?? 0));
    s.lifetimeCommissionVat = round2((s.lifetimeCommissionVat ?? 0) + (e.retenciones?.ivaComision ?? 0));
    // Y a las pendientes, que son las que se descuentan cuando pida su dinero.
    //
    // 🚨 Esta venta ACABA de entrar al saldo disponible, así que su retención acaba de
    //    entrar a la deuda con el SAT. Omitirlas aquí — como se omitían — dejaba que todo
    //    lo del grupo B (lo que se libera al entregar) se retirara SIN retener nada.
    s.pendingRetainedIsr = round2((s.pendingRetainedIsr ?? 0) + (e.retenciones?.isrRetenido ?? 0));
    s.pendingRetainedIva = round2((s.pendingRetainedIva ?? 0) + (e.retenciones?.ivaRetenido ?? 0));
    s.pendingCommissionVat = round2((s.pendingCommissionVat ?? 0) + (e.retenciones?.ivaComision ?? 0));

    tx.set(sRef, { ...s, currency: SETTLEMENT_CURRENCY, updatedAt: now }, { merge: true });
  });
}

/**
 * Revierte una entrada:
 *  - si estaba "earned"  → "refunded" (resta de ganado, suma a devuelto).
 *  - si estaba "pending":
 *      · por defecto → "rejected" (resta de por-liberar, suma a perdido).
 *      · con `asRefund: true` → "refunded" (resta de por-liberar, suma a DEVUELTO). Se
 *        usa cuando el COMPRADOR pide la devolución de una experiencia no entregada: para
 *        el creador cuenta como DEVOLUCIÓN, no como "perdido".
 */
export async function reverseEarning(
  creatorId: string,
  sourceType: string,
  sourceId: string,
  opts?: { asRefund?: boolean }
): Promise<void> {
  const entryRef = ledgerCollection(creatorId).doc(
    deterministicEntryId(sourceType, sourceId)
  );
  const sRef = summaryRef(creatorId);

  await db.runTransaction(async (tx) => {
    const [entrySnap, sSnap] = await Promise.all([tx.get(entryRef), tx.get(sRef)]);
    if (!entrySnap.exists) return;
    const e = entrySnap.data() as {
      status: LedgerStatus;
      grossAmount: number;
      netAmount: number;
      taxAmount?: number;
      retenciones?: { isrRetenido?: number; ivaRetenido?: number; ivaComision?: number };
    };
    if (e.status !== "earned" && e.status !== "pending") return; // ya revertido

    const s = sSnap.exists ? (sSnap.data() as SummaryData) : emptySummary();
    const now = FieldValue.serverTimestamp();

    if (e.status === "earned") {
      tx.update(entryRef, { status: "refunded", reversedAt: now });
      s.lifetimeEarnedGross = round2(s.lifetimeEarnedGross - e.grossAmount);
      s.lifetimeEarnedNet = round2(s.lifetimeEarnedNet - e.netAmount);
      // 🧾 IVA — al reembolsar una venta ganada, se descuenta el IVA que se había cobrado.
      s.lifetimeTaxCollected = round2((s.lifetimeTaxCollected ?? 0) - (e.taxAmount ?? 0));
      // Y las retenciones se revierten con él: si la venta se deshace, lo retenido sobre
      // ella deja de deberse. Quedan en el asiento como historial, pero no en el acumulado.
      s.lifetimeRetainedIsr = round2((s.lifetimeRetainedIsr ?? 0) - (e.retenciones?.isrRetenido ?? 0));
      s.lifetimeRetainedIva = round2((s.lifetimeRetainedIva ?? 0) - (e.retenciones?.ivaRetenido ?? 0));
      s.lifetimeCommissionVat = round2((s.lifetimeCommissionVat ?? 0) - (e.retenciones?.ivaComision ?? 0));
      // Y de las pendientes también: ese importe ya no está en su saldo, así que tampoco
      // puede seguir descontándose de su próximo retiro.
      //
      // ⚠️ Nunca por debajo de cero. Si la venta es anterior a que existieran estos campos,
      // su retención nunca llegó a sumarse y restarla dejaría el acumulado en negativo, que
      // luego se convertiría en un retiro INFLADO.
      s.pendingRetainedIsr = round2(
        Math.max(0, (s.pendingRetainedIsr ?? 0) - (e.retenciones?.isrRetenido ?? 0))
      );
      s.pendingRetainedIva = round2(
        Math.max(0, (s.pendingRetainedIva ?? 0) - (e.retenciones?.ivaRetenido ?? 0))
      );
      s.pendingCommissionVat = round2(
        Math.max(0, (s.pendingCommissionVat ?? 0) - (e.retenciones?.ivaComision ?? 0))
      );
      s.refundedGross = round2(s.refundedGross + e.grossAmount);
      s.refundedNet = round2(s.refundedNet + e.netAmount);
    } else if (opts?.asRefund) {
      // pending → DEVUELTO (el comprador pidió devolución de algo no entregado).
      tx.update(entryRef, { status: "refunded", reversedAt: now });
      s.pendingGross = round2(s.pendingGross - e.grossAmount);
      s.pendingNet = round2(s.pendingNet - e.netAmount);
      s.refundedGross = round2(s.refundedGross + e.grossAmount);
      s.refundedNet = round2(s.refundedNet + e.netAmount);
    } else {
      tx.update(entryRef, { status: "rejected", reversedAt: now });
      s.pendingGross = round2(s.pendingGross - e.grossAmount);
      s.pendingNet = round2(s.pendingNet - e.netAmount);
      s.rejectedGross = round2(s.rejectedGross + e.grossAmount);
      s.rejectedNet = round2(s.rejectedNet + e.netAmount);
    }

    tx.set(sRef, { ...s, currency: SETTLEMENT_CURRENCY, updatedAt: now }, { merge: true });
  });
}
