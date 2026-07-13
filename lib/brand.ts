// Constantes de marca de Vibra.
// Fuente única de verdad para el dominio público, para no volver a
// quemar strings de dominio en componentes (watermarks, etc.).

const FALLBACK_DOMAIN = "vibraon.com";

/**
 * Deriva el host público (sin esquema ni slash final) desde
 * NEXT_PUBLIC_SITE_URL. Si no está definida o es inválida, usa el fallback.
 * Ej: "https://vibraon.com/" -> "vibraon.com"
 */
function resolveBrandDomain(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return FALLBACK_DOMAIN;
  try {
    const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).host || FALLBACK_DOMAIN;
  } catch {
    return FALLBACK_DOMAIN;
  }
}

/** Dominio público de la marca, sin esquema. Ej: "vibraon.com" */
export const BRAND_DOMAIN = resolveBrandDomain();
