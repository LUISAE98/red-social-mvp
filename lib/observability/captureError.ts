// Reporte de errores a Sentry con contexto. Fuente única para los catch de
// flujos críticos (dinero, acceso a salas pagadas, KYC, wallet) que hoy tragan
// el error con console.error y quedan INVISIBLES en producción.
//
// Sentry ya está inicializado en cliente/servidor/edge (ver instrumentation*.ts,
// sentry.*.config.ts). Este helper solo añade la captura manual con tags para
// poder filtrar por área y por código de error de Cloud Functions.

import * as Sentry from "@sentry/nextjs";

export type ErrorContext = {
  /** Área/flujo del error: "payments" | "livekit" | "kyc" | "wallet" | … */
  scope?: string;
  /** Código de HttpsError si aplica (p.ej. "permission-denied", "failed-precondition"). */
  code?: string;
  /** Datos extra NO sensibles para depurar (ids, estado). Nunca PII ni datos de tarjeta. */
  extra?: Record<string, unknown>;
};

/**
 * Reporta un error a Sentry con contexto. Seguro por diseño: NUNCA lanza (si el
 * propio Sentry fallara, cae a un no-op). En desarrollo además hace console.error
 * para conservar la visibilidad local que tenían los catch originales.
 */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  const { scope, code, extra } = context;
  try {
    Sentry.captureException(error, {
      tags: {
        ...(scope ? { scope } : {}),
        ...(code ? { code } : {}),
      },
      ...(extra ? { extra } : {}),
    });
  } catch {
    // El reporte de un error jamás debe romper el flujo que lo originó.
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(`[${scope ?? "error"}]`, error);
  }
}
