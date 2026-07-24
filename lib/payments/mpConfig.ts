// Configuración de Mercado Pago del lado cliente.
//
// La Public Key NO es secreta (se usa en el navegador para el Payment Brick y la
// tokenización de tarjetas en el Bloque 2). Vive en una env var pública de Vercel:
//   NEXT_PUBLIC_MP_PUBLIC_KEY
//
// El Access Token (secreto) NUNCA llega al cliente: solo vive en Firebase Secrets
// del backend (`backend/src/payments/mpClient.ts`).

/** Public Key de Mercado Pago (cliente). Vacía si no está configurada. */
export const MP_PUBLIC_KEY = process.env.NEXT_PUBLIC_MP_PUBLIC_KEY ?? "";

/** true si el cobro está configurado en el cliente (para gating de UI). */
export function isMpConfigured(): boolean {
  return MP_PUBLIC_KEY.length > 0;
}
