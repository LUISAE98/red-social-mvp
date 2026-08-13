// Fechas, horas y números con el idioma ACTIVO del usuario.
//
// 🚨 POR QUÉ EXISTE ESTE ARCHIVO 🚨
//
// La app tenía "es-MX" clavado en ~90 sitios. A un usuario con la interfaz en finés o en
// griego se le mostraban las fechas en español ("Miércoles 22:45 hrs", "15 de Julio de
// 2026") y los números con separadores mexicanos, dentro de una UI por lo demás traducida.
//
// Y no bastaba con cambiar el locale, porque varios sitios ARMABAN la fecha concatenando:
//
//     `${day} de ${month} de ${year}`     → el "de … de" es gramática española
//     `${hh}:${mm} hrs`                   → "hrs" no existe en un reloj de 12 horas
//     `${day} de ${month} del ${year} a las ${time} hrs`
//
// Eso no se traduce con una clave: hay que dejar que Intl decida el ORDEN de los campos
// (en-US pone el mes primero), el nombre del mes y si el reloj es de 12 o 24 horas.
//
// Regla para código nuevo: nunca escribas un locale literal ni concatenes partes de una
// fecha. Usa estas funciones con el locale que da `useLocale()` de next-intl.

import { intlLocale } from "@/i18n/locales";

/** Cualquier cosa de la que se pueda sacar una fecha: Date, ms, ISO o Timestamp de Firestore. */
export type DateLike = Date | number | string | { toDate: () => Date } | null | undefined;

/** Normaliza a Date, o null si no hay fecha válida. Espeja `toDateSafe` de OwnerSidebar. */
export function toDate(value: DateLike): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Fecha/hora formateada con el locale activo. Sustituye a
 * `new Intl.DateTimeFormat("es-MX", opts).format(d)`.
 *
 * Devuelve null si no hay fecha, para que quien llama decida el placeholder en vez de
 * imprimir "Invalid Date".
 */
export function formatDateTime(
  value: DateLike,
  locale: string,
  opts: Intl.DateTimeFormatOptions = {}
): string | null {
  const d = toDate(value);
  if (!d) return null;
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), opts).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Solo la hora ("22:45" o "10:45 PM" según el idioma). Sin "hrs": lo pone Intl si toca. */
export function formatTime(value: DateLike, locale: string): string | null {
  return formatDateTime(value, locale, { hour: "2-digit", minute: "2-digit" });
}

/** Fecha larga: "15 de julio de 2026" · "15. heinäkuuta 2026" · "July 15, 2026". */
export function formatDateLong(value: DateLike, locale: string): string | null {
  return formatDateTime(value, locale, { day: "numeric", month: "long", year: "numeric" });
}

/** Fecha corta numérica: "15/07/2026" · "7/15/2026". */
export function formatDateShort(value: DateLike, locale: string): string | null {
  return formatDateTime(value, locale, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Fecha larga + hora, en una sola cadena y con el separador que use el idioma. */
export function formatDateTimeLong(value: DateLike, locale: string): string | null {
  return formatDateTime(value, locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Primera letra en mayúscula, respetando el idioma.
 *
 * Muchos idiomas escriben el día de la semana y el mes en minúscula (finés, sueco, inglés
 * no, español sí en medio de frase) y varios diseños los quieren capitalizados. Se usa
 * `toLocaleUpperCase` y no `toUpperCase` porque en turco la "i" en mayúscula es "İ", no "I".
 *
 * Acepta null para poder encadenarlo directo sobre un `formatDateTime`.
 */
export function capitalizeFirst(text: string | null, locale: string): string | null {
  if (!text) return text;
  return text.charAt(0).toLocaleUpperCase(intlLocale(locale)) + text.slice(1);
}

/**
 * Día de la semana + hora: "Miércoles 22:45" · "Keskiviikko 22.45" · "Wednesday 10:45 PM".
 */
export function formatWeekdayTime(value: DateLike, locale: string): string | null {
  const d = toDate(value);
  if (!d) return null;
  const weekday = capitalizeFirst(formatDateTime(d, locale, { weekday: "long" }), locale) ?? "";
  const time = formatTime(d, locale) ?? "";
  return `${weekday} ${time}`.trim();
}

/**
 * Número con el locale activo: agrupación de miles y separador decimal del idioma
 * (1.763,87 en español · 1 763,87 en finés · 1,763.87 en inglés).
 * Sustituye a `n.toLocaleString("es-MX")`.
 */
export function formatNumber(
  value: number | null | undefined,
  locale: string,
  opts: Intl.NumberFormatOptions = {}
): string {
  if (value == null || !isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat(intlLocale(locale), opts).format(value);
  } catch {
    return String(value);
  }
}
