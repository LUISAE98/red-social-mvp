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
