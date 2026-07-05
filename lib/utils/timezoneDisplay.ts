// Returns the viewer's IANA timezone string, e.g. "America/Mexico_City"
export function getViewerTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// Returns a human-friendly timezone label, e.g. "Mexico_City (CST)"
export function getTimezoneLabel(tz: string): string {
  try {
    const now = new Date();
    const offset =
      new Intl.DateTimeFormat("es-MX", {
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

// Returns "14:00" in a given IANA timezone
function timeInZone(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-MX", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "--:--";
  }
}

// Returns "10 de Julio del 2026 a las 14:00 hrs" in a given IANA timezone
function fullDateInZone(date: Date, tz: string): string {
  try {
    const day = new Intl.DateTimeFormat("es-MX", { timeZone: tz, day: "numeric" }).format(date);
    const month = new Intl.DateTimeFormat("es-MX", { timeZone: tz, month: "long" }).format(date);
    const year = new Intl.DateTimeFormat("es-MX", { timeZone: tz, year: "numeric" }).format(date);
    const time = timeInZone(date, tz);
    return `${day} de ${month.charAt(0).toUpperCase() + month.slice(1)} del ${year} a las ${time} hrs`;
  } catch {
    return date.toLocaleString("es-MX");
  }
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
  creatorTimezone?: string | null
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
    localFull: fullDateInZone(date, viewerTz),
    localTime: timeInZone(date, viewerTz),
    viewerLabel: getTimezoneLabel(viewerTz),
    creatorTime: sameZone ? null : timeInZone(date, creatorTz!),
    creatorLabel: sameZone ? null : getTimezoneLabel(creatorTz!),
    showBoth: !sameZone,
  };
}
