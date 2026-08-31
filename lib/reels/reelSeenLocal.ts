"use client";

// Memoria de "ya lo vi" para quien no tiene cuenta.
//
// Con cuenta real, lo visto se guarda en `userStoryViews` y viaja contigo a
// cualquier aparato. Sin cuenta no hay dónde guardarlo: las reglas de esa
// colección exigen cuenta no anónima, y con razón — es contenido del usuario.
//
// El resultado era que un invitado recargaba Vibra Express y volvía a ver
// exactamente lo mismo desde el principio. Aquí se guarda en SU navegador: no
// viaja entre aparatos y se pierde si borra datos, que para un invitado es
// exactamente lo que cabe esperar.
//
// ⚠️ Esto NO es un control de acceso ni una fuente de verdad. Solo evita repetir
// contenido. Que alguien lo borre o lo manipule no da acceso a nada: lo peor que
// consigue es volver a ver lo que ya vio.

/** Dónde vive. */
const KEY = "vibra_reel_seen";

/**
 * Cuántas recordar. Mismo espíritu que el tope del historial con cuenta: más
 * allá de esto una historia vuelve a contar como nueva, y así el almacenamiento
 * del navegador no crece sin fin.
 */
const MAX = 500;

type SeenMap = Record<string, number>;

function read(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SeenMap;
  } catch {
    // Modo privado, almacenamiento lleno o contenido corrupto. Sin memoria el
    // feed sigue funcionando, solo repite.
    return {};
  }
}

function write(map: SeenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Silencio deliberado: no poder recordar no es un error que reportarle a
    // nadie.
  }
}

/** Lo que este navegador recuerda haber visto, en el formato del feed. */
export function loadLocalSeen(): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, at] of Object.entries(read())) {
    if (typeof at === "number") out.set(id, at);
  }
  return out;
}

/** Recuerda una historia como vista. */
export function markSeenLocally(storyId: string): void {
  if (!storyId) return;
  const map = read();
  if (map[storyId]) return;
  map[storyId] = Date.now();

  const ids = Object.keys(map);
  if (ids.length > MAX) {
    // Se van las más antiguas: si algo tiene que volver a aparecer, que sea lo
    // que menos recuerdas.
    ids
      .sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0))
      .slice(0, ids.length - MAX)
      .forEach((id) => delete map[id]);
  }

  write(map);
}
