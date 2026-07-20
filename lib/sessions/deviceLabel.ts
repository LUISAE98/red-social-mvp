/**
 * Utilidades puras (sin dependencias de Firebase) para describir el dispositivo
 * y la ubicación aproximada de una sesión. Se usan tanto al registrar la sesión
 * como al pintarla en la UI.
 */

type ParsedAgent = {
  browser: string | null;
  os: string | null;
};

/**
 * Parseo ligero del user agent. No pretende ser exhaustivo (para eso existen
 * librerías pesadas); solo cubre los navegadores/SO comunes lo suficiente para
 * que el usuario reconozca cada sesión. El orden de las comprobaciones importa
 * (ej. Edge/Chrome/Opera comparten tokens con Chrome).
 */
function parseUserAgent(userAgent: string): ParsedAgent {
  const ua = userAgent;

  let browser: string | null = null;
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = "Firefox";
  else if (/CriOS/i.test(ua)) browser = "Chrome";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = "Safari";

  let os: string | null = null;
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows NT/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "Mac";
  else if (/CrOS/i.test(ua)) os = "ChromeOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  return { browser, os };
}

/**
 * Etiqueta legible del dispositivo a partir del user agent,
 * ej. "Chrome · Windows", "Safari · iPhone". Cae a "Dispositivo desconocido"
 * (o el texto que se pase) cuando no se puede determinar nada.
 */
export function buildDeviceLabel(
  userAgent: string | null | undefined,
  fallback = "Dispositivo desconocido"
): string {
  const ua = (userAgent ?? "").trim();
  if (!ua) return fallback;

  const { browser, os } = parseUserAgent(ua);

  if (browser && os) return `${browser} · ${os}`;
  if (browser) return browser;
  if (os) return os;

  return fallback;
}

/**
 * Zona horaria IANA del navegador, ej. "America/Mexico_City". null si no está
 * disponible (SSR o entornos sin Intl).
 */
export function getBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.trim() ? tz.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Ubicación aproximada derivada de la zona horaria (v1, sin geo-IP).
 * "America/Mexico_City" → "Ciudad de México". Cuando el Bloque 6 (geo-IP)
 * esté disponible, esta etiqueta se sobrescribe con la ciudad/país reales.
 */
export function buildApproxLocationLabel(
  timezone: string | null | undefined
): string | null {
  const tz = (timezone ?? "").trim();
  if (!tz || !tz.includes("/")) return tz || null;

  const city = tz.split("/").pop() ?? "";
  const readable = city.replace(/_/g, " ").trim();

  if (!readable) return null;

  // Casos comunes en español para que se lea natural.
  const SPANISH_OVERRIDES: Record<string, string> = {
    "Mexico City": "Ciudad de México",
  };

  return SPANISH_OVERRIDES[readable] ?? readable;
}
