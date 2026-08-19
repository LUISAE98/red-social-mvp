// Última actividad del comprador por categoría (timestamp en ms), para decidir si
// hay algo NUEVO frente al "visto" (useBuyerExperiencesSeen). Se usa desde la
// página (con los arrays de useMyExperiences) y desde el hook ligero del layout.
//
// Nota: se usa `updatedAt`/`deliveredAt`/`createdAt`; NO `scheduledAt` (puede ser
// futuro y rompería la comparación "hay algo más nuevo que lo visto").

import { getSectionForMeetGreetStatus } from "@/app/components/OwnerSidebar/OwnerSidebarGreetings.parts";

type TS = { toMillis?: () => number } | null | undefined;
type ExpDoc = {
  status?: string;
  updatedAt?: TS;
  createdAt?: TS;
  deliveredAt?: TS;
};
export type ActivityRow = { data: ExpDoc };

export type CategoryLatest = { requested: number; rejected: number; delivered: number };

function ms(v: TS): number {
  return typeof v?.toMillis === "function" ? v.toMillis() : 0;
}
function rowMs(d: ExpDoc): number {
  return Math.max(ms(d.updatedAt), ms(d.deliveredAt), ms(d.createdAt));
}

/**
 * @param pendingGreetings  saludos/consejos en estado "pending" (ya pagados)
 * @param deliveredGreetings saludos/consejos entregados
 * @param rejectedGreetings saludos/consejos rechazados o en devolución
 * @param sessions          meet & greet + sesiones exclusivas (todos los estados)
 */
export function computeCategoryLatest(input: {
  pendingGreetings: ActivityRow[];
  deliveredGreetings: ActivityRow[];
  rejectedGreetings: ActivityRow[];
  sessions: ActivityRow[];
}): CategoryLatest {
  const out: CategoryLatest = { requested: 0, rejected: 0, delivered: 0 };
  const bump = (cat: keyof CategoryLatest, m: number) => {
    if (m > out[cat]) out[cat] = m;
  };

  input.pendingGreetings.forEach((r) => bump("requested", rowMs(r.data)));
  input.deliveredGreetings.forEach((r) => bump("delivered", rowMs(r.data)));
  input.rejectedGreetings.forEach((r) => bump("rejected", rowMs(r.data)));

  input.sessions.forEach((r) => {
    const st = r.data.status ?? "";
    if (st === "completed") bump("delivered", rowMs(r.data));
    else if (getSectionForMeetGreetStatus(st) === "rejected") bump("rejected", rowMs(r.data));
    else if (getSectionForMeetGreetStatus(st) === "requested") bump("requested", rowMs(r.data));
  });

  return out;
}

/** ¿Hay algo nuevo en la categoría? (actividad posterior a lo visto). */
export function isCategoryNew(latest: number, seen: number): boolean {
  return latest > 0 && latest > seen;
}

/**
 * Marca de tiempo de CADA experiencia, agrupada por categoría.
 *
 * `computeCategoryLatest` se queda solo con la más reciente, que basta para
 * saber SI hay algo nuevo. Para decir CUÁNTAS hay nuevas hace falta la lista
 * entera: el globo del menú lleva un número, no un punto.
 */
export function computeCategoryTimestamps(input: {
  pendingGreetings: ActivityRow[];
  deliveredGreetings: ActivityRow[];
  rejectedGreetings: ActivityRow[];
  sessions: ActivityRow[];
}): Record<keyof CategoryLatest, number[]> {
  const out: Record<keyof CategoryLatest, number[]> = {
    requested: [],
    rejected: [],
    delivered: [],
  };

  input.pendingGreetings.forEach((r) => out.requested.push(rowMs(r.data)));
  input.deliveredGreetings.forEach((r) => out.delivered.push(rowMs(r.data)));
  input.rejectedGreetings.forEach((r) => out.rejected.push(rowMs(r.data)));

  // Mismo reparto por estado que arriba: si las dos funciones dejaran de
  // coincidir, el número del globo no cuadraría con lo que hay en la pantalla.
  input.sessions.forEach((r) => {
    const st = r.data.status ?? "";
    const m = rowMs(r.data);
    if (st === "completed") out.delivered.push(m);
    else if (getSectionForMeetGreetStatus(st) === "rejected") out.rejected.push(m);
    else if (getSectionForMeetGreetStatus(st) === "requested") out.requested.push(m);
  });

  return out;
}

/** Cuántas experiencias tienen actividad posterior a lo ya visto. */
export function countNewExperiences(
  timestamps: Record<keyof CategoryLatest, number[]>,
  seen: CategoryLatest
): number {
  return (Object.keys(timestamps) as Array<keyof CategoryLatest>).reduce(
    (total, cat) =>
      total + timestamps[cat].filter((m) => m > 0 && m > (seen[cat] ?? 0)).length,
    0
  );
}
