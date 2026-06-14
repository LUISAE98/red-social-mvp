const VISIT_KEY = (entityId: string) => `vibra:last-visit:${entityId}`;

export function getLastVisitTimestamp(entityId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(VISIT_KEY(entityId));
    if (!raw) return 0;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

export function setLastVisitTimestamp(entityId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VISIT_KEY(entityId), String(Date.now()));
  } catch {}
}
