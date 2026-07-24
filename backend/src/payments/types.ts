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
  /** Monto bruto en MXN (lo que paga el comprador). */
  grossAmount: number;
  currency: "MXN";
  status: MpPaymentStatus;
  /** Id de la orden/pago en MP (se llena cuando MP responde). */
  mpOrderId: string | null;
  mpPaymentId: string | null;
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

/**
 * Cuenta de retiro del creador (CLABE). La guarda VIBRA (no MP, no Didit).
 * El titular se coteja contra el nombre verificado por Didit antes de aprobar.
 * Documento: `users/{creatorId}/payoutAccounts/{accountId}`.
 * Escritura SOLO backend (onCall que valida contra Didit — Bloque 4).
 */
export type PayoutAccount = {
  creatorId: string;
  /** CLABE de 18 dígitos. */
  clabe: string;
  bankName: string;
  /** Nombre del titular declarado (debe cotejar con el nombre KYC de Didit). */
  accountHolderName: string;
  /** Verificada = titular coincide con Didit y aprobada por Vibra. */
  status: "pending_review" | "verified" | "rejected";
  createdAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  updatedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
};

/**
 * Solicitud de retiro. El creador la pide; Vibra la revisa (banderas: reportes
 * abiertos, KYC Didit, cuenta verificada) y la libera con intervención humana.
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
