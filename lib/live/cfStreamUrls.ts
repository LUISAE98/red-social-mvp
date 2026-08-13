// Allowlist de destinos salientes hacia Cloudflare Stream.
//
// Varias rutas de `app/api/` hacen fetch server-side a una URL que viene del
// cliente o de un documento de Firestore que el creador puede editar. Sin una
// lista permitida eso es un SSRF: el servidor de Vercel alcanza metadatos de
// infraestructura y servicios internos que el navegador jamás tocaría, y en el
// caso del proxy de viewers además devuelve la respuesta al atacante.
//
// Regla única: https, sin credenciales embebidas, sin puerto explícito y host
// dentro del dominio de Cloudflare Stream.

const CF_STREAM_HOST = "cloudflarestream.com";

/**
 * ¿Es `raw` una URL de Cloudflare Stream a la que podemos hacer fetch?
 *
 * Rechaza los disfraces habituales porque `new URL()` ya resuelve el host real:
 *  · `https://customer-x.cloudflarestream.com@evil.com/…` → hostname `evil.com`.
 *  · `https://evil.com/?d=.cloudflarestream.com`          → hostname `evil.com`.
 *  · `http://…`, `file://…`, `https://10.0.0.1:8080/…`    → protocolo/puerto.
 */
export function isCloudflareStreamUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port) return false;

  const host = url.hostname.toLowerCase();
  return host === CF_STREAM_HOST || host.endsWith(`.${CF_STREAM_HOST}`);
}

/**
 * Resuelve una URL que puede venir relativa (Cloudflare devuelve el recurso
 * WHIP en la cabecera `Location`, y el RFC permite que sea relativa) contra la
 * URL base de la petición, y la valida. Devuelve null si no es de Cloudflare.
 */
export function resolveCloudflareStreamUrl(
  raw: string | null | undefined,
  base: string
): string | null {
  if (!raw) return null;

  let absolute: string;
  try {
    absolute = new URL(raw, base).toString();
  } catch {
    return null;
  }

  return isCloudflareStreamUrl(absolute) ? absolute : null;
}
