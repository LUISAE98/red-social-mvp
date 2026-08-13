// Tipos compartidos de la integración de pagos (Mercado Pago — modelo agregador).
//
// Estos tipos describen los documentos de Firestore y los estados de MP que el
// backend maneja. La contabilidad por creador NO vive aquí: vive en el ledger
// (`wallet/ledger.ts`). Aquí solo modelamos el riel de dinero (cobros y retiros).

import type { LedgerServiceType } from "../wallet/ledger";

/**
 * Estado de un pago/orden en Mercado Pago (Orders/Payments API), normalizado.
 * Mapeamos las cadenas de MP a nuestro modelo interno en el webhook (Bloque 2).
 */
export type MpPaymentStatus =
  | "pending" // creado, esperando pago
  | "in_process" // en revisión de MP
  | "approved" // pagado y aprobado → dispara el ledger
  | "rejected" // rechazado
  | "refunded" // reembolsado (total)
  | "charged_back" // contracargo (disputa con el banco)
  | "cancelled";

/**
 * Intento de pago: puente entre una compra de Vibra y una orden de MP.
 * Idempotente por `externalReference` = `{sourceType}__{sourceId}` (mismo id
 * determinista que usa el ledger). Documento: `paymentIntents/{externalReference}`.
 */
export type PaymentIntent = {
  externalReference: string;
  serviceType: LedgerServiceType;
  /** Colección/entidad de origen (p.ej. "greetingRequest"). */
  sourceType: string;
  sourceId: string;
  buyerId: string;
  creatorId: string;
  /**
   * BASE de la venta (precio del creador, SIN impuesto). Es lo que cuenta como
   * ganancia del creador (el ledger la registra desde los docs de dominio). El IVA
   * se SUMA aparte al cobrar; no infla esta base.
   */
  grossAmount: number;
  currency: "MXN";
  // 🧾 IVA — Desglose fiscal estampado por chargeServiceIntent al cobrar (registro
  // para conciliación / futuro CFDI). Ausente hasta que se cobra. El creador NUNCA
  // recibe el IVA (es de Vibra hacia el SAT). Ver docs/legal/fiscal-iva-isr-plataforma.md.
  /** Base sin impuesto (= grossAmount al momento del cobro). */
  baseAmount?: number;
  /** País fiscal del comprador (ISO-2) o null si no aplica impuesto. */
  taxCountry?: string | null;
  /** Tasa aplicada (0 si no aplica). */
  taxRate?: number;
  /** Impuesto (IVA) sumado sobre la base. */
  taxAmount?: number;
  /** Total efectivamente cobrado al comprador (base + IVA). */
  chargedAmount?: number;
  status: MpPaymentStatus;
  /** Id de la orden/pago en MP (se llena cuando MP responde). */
  mpOrderId: string | null;
  mpPaymentId: string | null;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

/**
 * Cuenta de retiro del creador (CLABE). La guarda VIBRA (no MP, no el procesador).
 * El titular se coteja contra el nombre verificado en el alta de Stripe antes de aprobar.
 * Documento: `users/{creatorId}/payoutAccounts/{accountId}`.
 * Escritura SOLO backend (onCall que valida contra el alta de Stripe — Bloque 4).
 */
export type PayoutAccount = {
  creatorId: string;
  /** CLABE de 18 dígitos. */
  clabe: string;
  bankName: string;
  /** Nombre del titular declarado (debe cotejar con el nombre verificado por Stripe). */
  accountHolderName: string;
  /** Verificada = titular coincide con el alta de Stripe y aprobada por Vibra. */
  status: "pending_review" | "verified" | "rejected";
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

/**
 * Solicitud de retiro. El creador la pide; Vibra la revisa (banderas: reportes
 * abiertos, KYC del alta de Stripe, cuenta verificada) y la libera con intervención humana.
 * Documento top-level: `withdrawalRequests/{requestId}` (con `creatorId` para
 * que el panel admin liste todas y el creador solo las suyas).
 */
export type WithdrawalRequestStatus =
  | "requested" // pedida por el creador
  | "on_hold" // retenida por una bandera (reporte/aclaración)
  | "approved" // aprobada, lista para pagar
  | "paid" // pagada (money-out ejecutado)
  | "rejected"; // rechazada por Vibra

export type WithdrawalRequest = {
  creatorId: string;
  /** Monto neto solicitado en MXN (contra el saldo disponible del ledger). */
  netAmount: number;
  currency: "MXN";
  payoutAccountId: string;
  status: WithdrawalRequestStatus;
  /** Banderas capturadas al momento de la solicitud (para la revisión humana). */
  flags: {
    kycApproved: boolean;
    hasOpenReports: boolean;
    accountVerified: boolean;
  } | null;
  /** Referencia del money-out (folio SPEI o id de transferencia MP). */
  payoutReference: string | null;
  reviewedBy: string | null;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

/**
 * Referencia a una tarjeta guardada del comprador. La tarjeta la tokeniza y
 * custodia MERCADO PAGO (Customers & Cards API, PCI). Vibra guarda SOLO estas
 * referencias, nunca el número. Documento: `users/{buyerId}/paymentMethods/{cardId}`.
 */
export type SavedCardRef = {
  buyerId: string;
  mpCustomerId: string;
  mpCardId: string;
  /** Últimos 4 dígitos y marca, solo para mostrar en la UI (no sensible). */
  lastFour: string;
  brand: string;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};
