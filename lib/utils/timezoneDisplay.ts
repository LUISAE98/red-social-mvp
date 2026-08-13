import { intlLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/i18n/dateTime";

// Returns the viewer's IANA timezone string, e.g. "America/Mexico_City"
export function getViewerTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// Returns a human-friendly timezone label, e.g. "Mexico_City (CST)"
export function getTimezoneLabel(tz: string, locale: string): string {
  try {
    const now = new Date();
    const offset =
      new Intl.DateTimeFormat(intlLocale(locale), {
        timeZone: tz,
        timeZoneName: "short",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    const city = tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
    return offset ? `${city} (${offset})` : city;
  } catch {
    return tz;
  }
}

// Hora corta en una zona IANA. Sin `hour12: false`: el reloj de 12 o 24 horas lo decide
// el idioma (en inglés "2:00 PM", en finés "14.00"), no nosotros.
function timeInZone(date: Date, tz: string, locale: string): string {
  return (
    formatDateTime(date, locale, { timeZone: tz, hour: "2-digit", minute: "2-digit" }) ?? "--:--"
  );
}

// Fecha completa en una zona IANA.
//
// ⚠️ Antes esto devolvía "10 de Julio del 2026 a las 14:00 hrs", armado a mano. Los tres
// pegamentos ("de", "del", "a las") y el sufijo "hrs" son gramática ESPAÑOLA: en cualquier
// otro idioma quedaba una frase en español dentro de una UI traducida. Ahora el orden de
// los campos y el separador los pone Intl según el idioma.
function fullDateInZone(date: Date, tz: string, locale: string): string {
  return (
    formatDateTime(date, locale, {
      timeZone: tz,
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) ?? "—"
  );
}

export type ScheduledAtDisplay = {
  /** Full date in viewer's timezone, e.g. "10 de Julio del 2026 a las 14:00 hrs" */
  localFull: string;
  /** Short time in viewer's timezone, e.g. "14:00" */
  localTime: string;
  /** Viewer's timezone label */
  viewerLabel: string;
  /** Short time in creator's timezone — null if same zone or unknown */
  creatorTime: string | null;
  /** Creator's timezone label — null if same zone or unknown */
  creatorLabel: string | null;
  /** true when viewer and creator are in different timezones */
  showBoth: boolean;
};

/** Accepts any date-like value (ISO string, Date, Firestore Timestamp, number). */
export function formatScheduledAt(
  scheduledAt: unknown,
  creatorTimezone: string | null | undefined,
  locale: string
): ScheduledAtDisplay | null {
  if (!scheduledAt) return null;

  let date: Date;
  if (scheduledAt instanceof Date) {
    date = scheduledAt;
  } else if (typeof scheduledAt === "string" || typeof scheduledAt === "number") {
    date = new Date(scheduledAt);
  } else if (
    typeof scheduledAt === "object" &&
    scheduledAt !== null &&
    "toDate" in scheduledAt &&
    typeof (scheduledAt as { toDate?: unknown }).toDate === "function"
  ) {
    date = (scheduledAt as { toDate: () => Date }).toDate();
  } else {
    return null;
  }

  if (isNaN(date.getTime())) return null;

  const viewerTz = getViewerTimezone();
  const creatorTz = creatorTimezone ?? null;
  const sameZone = !creatorTz || creatorTz === viewerTz;

  return {
    localFull: fullDateInZone(date, viewerTz, locale),
    localTime: timeInZone(date, viewerTz, locale),
    viewerLabel: getTimezoneLabel(viewerTz, locale),
    creatorTime: sameZone ? null : timeInZone(date, creatorTz!, locale),
    creatorLabel: sameZone ? null : getTimezoneLabel(creatorTz!, locale),
    showBoth: !sameZone,
  };
}
