// Estado de verificación de identidad (KYC) del creador.
// El backend (Didit webhook) es el único que escribe estos valores en kyc/{uid}.

export type KycStatus =
  | "not_started" // aún no inicia la verificación
  | "pending" // sesión creada / en progreso
  | "in_review" // marcada para revisión manual
  | "approved" // verificado — habilita retiros
  | "declined"; // rechazada — puede reintentar

export type KycRecord = {
  status: KycStatus;
  /** Bandera durable que consumirá el flujo de retiro. */
  kycApproved: boolean;
  /** Motivo de rechazo, si aplica. */
  reason: string | null;
};
