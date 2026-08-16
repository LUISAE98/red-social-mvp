// Puntuación y mezcla del feed de reels. Lógica PURA, sin Firestore.
//
// Va aparte de las consultas por dos motivos: se puede probar sin emulador, y
// deja a la vista la única parte del feed que es una decisión de producto y no
// de infraestructura.

import { normalizeGroupCategory, type CanonicalGroupCategory } from "@/types/group";
import type { StoryDoc, StoryType } from "@/lib/stories/types";

/**
 * Cuota del carril de descubrimiento.
 *
 * El acuerdo es 70% consejos, 15% saludos y 15% lives. Los lives todavía no
 * entran al feed, así que su hueco queda declarado en cero y el resto se reparte
 * en proporción (≈82/18). Cuando entren, se cambian estos tres números y el
 * mezclador ya sabe repartir: no hay que rediseñar nada.
 */
export const REEL_QUOTA: Record<ReelLane, number> = {
  consejo: 0.82,
  saludo: 0.18,
  live: 0,
};

export type ReelLane = StoryType | "live";

/** Media vida de la frescura, en días. */
const RECENCY_HALF_LIFE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Techos de saturación. Las tres señales llegan en escalas que no se pueden
 * comparar: la frescura es 0..1, la afinidad acumula pesos sin tope (un like vale
 * 2, guardar 2.5…) y la popularidad es un logaritmo que con 20.000 vistas ya vale
 * casi 10. Ponderar eso tal cual hace que la popularidad se coma todo lo demás,
 * daba igual el peso que se le pusiera.
 *
 * Así que primero se normaliza cada una a 0..1 contra su techo, y DESPUÉS se
 * pondera. Ahí sí los pesos significan lo que dicen.
 */
const AFFINITY_SATURATION = 5;
const POPULARITY_SATURATION = 1000;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export type ScoreInput = {
  story: StoryDoc;
  /** Vector de gustos del usuario. Vacío = arranque en frío. */
  taste: Map<CanonicalGroupCategory, number>;
  nowMs: number;
};

/**
 * Puntúa una historia para el carril de descubrimiento.
 *
 * ⚠️ La fórmula NO es la del rail viejo. Aquella pesaba la frescura a 1.5 sobre
 * una ventana de 24 horas, donde todo era reciente por definición. Con el
 * histórico completo eso hundiría cualquier cosa de hace más de un día, así que
 * la frescura pasa a ser un decaimiento suave y el peso se mueve a la afinidad y
 * a la popularidad, que son las que envejecen bien.
 */
export function scoreStory({ story, taste, nowMs }: ScoreInput): number {
  let affinity = 0;
  if (Array.isArray(story.categories)) {
    for (const raw of story.categories) {
      const cat = normalizeGroupCategory(raw);
      if (cat) affinity = Math.max(affinity, taste.get(cat) ?? 0);
    }
  }

  const ageMs = Math.max(0, nowMs - (story.createdAt?.toMillis?.() ?? nowMs));
  // Decaimiento exponencial: a los 30 días vale la mitad, y nunca llega a cero.
  const recency = Math.pow(0.5, ageMs / (RECENCY_HALF_LIFE_DAYS * DAY_MS));

  const affinityNorm = clamp01(affinity / AFFINITY_SATURATION);
  const popularityNorm = clamp01(
    Math.log1p(story.viewsCount ?? 0) / Math.log1p(POPULARITY_SATURATION),
  );

  // Las tres ya van de 0 a 1, así que el peso decide de verdad. Con gusto
  // definido, una afinidad plena (3) gana a una popularidad plena (1.5) por el
  // doble; una afinidad floja no, y eso es correcto.
  return taste.size > 0
    ? affinityNorm * 3 + popularityNorm * 1.5 + recency * 1
    : popularityNorm * 3 + recency * 1.5; // frío total → lo popular y lo fresco
}

/**
 * Ordena por puntuación dejando DETRÁS lo ya visto.
 *
 * Con el histórico completo, excluir lo visto vaciaría el feed a los pocos días.
 * Y no penalizarlo lo haría repetir siempre las mismas. El punto medio es
 * empujarlo al final, y dentro de esa cola, lo visto hace más tiempo primero:
 * si vuelve a aparecer, que sea lo que menos recuerdas.
 */
export function rankStories(
  stories: StoryDoc[],
  taste: Map<CanonicalGroupCategory, number>,
  viewedAt: Map<string, number>,
  nowMs: number,
): StoryDoc[] {
  const fresh: Array<{ story: StoryDoc; score: number }> = [];
  const seen: Array<{ story: StoryDoc; viewedAt: number }> = [];

  for (const story of stories) {
    const seenAt = viewedAt.get(story.id);
    if (seenAt === undefined) {
      fresh.push({ story, score: scoreStory({ story, taste, nowMs }) });
    } else {
      seen.push({ story, viewedAt: seenAt });
    }
  }

  fresh.sort((a, b) => b.score - a.score);
  seen.sort((a, b) => a.viewedAt - b.viewedAt);

  return [...fresh.map((e) => e.story), ...seen.map((e) => e.story)];
}

/**
 * Reparte por carriles respetando la cuota, sin dejar huecos.
 *
 * El reparto se lleva por DEUDA acumulada: en cada posición sale el carril con
 * más deuda pendiente respecto a su cuota. Si un carril se queda sin material
 * —hoy los lives, siempre; los saludos, casi— su turno lo ocupa el siguiente con
 * más deuda en vez de perderse. Así una cuota imposible no deja el feed corto.
 *
 * El orden de entrada de cada carril se respeta, así que lo que ya venía
 * rankeado sigue rankeado dentro de su carril.
 */
export function mixByQuota(
  lanes: Partial<Record<ReelLane, StoryDoc[]>>,
  quota: Record<ReelLane, number> = REEL_QUOTA,
): StoryDoc[] {
  const cursors: Record<string, number> = {};
  const debt: Record<string, number> = {};
  const active: ReelLane[] = [];

  for (const lane of Object.keys(quota) as ReelLane[]) {
    const items = lanes[lane] ?? [];
    if (items.length === 0 || quota[lane] <= 0) continue;
    cursors[lane] = 0;
    debt[lane] = quota[lane];
    active.push(lane);
  }
  if (active.length === 0) return [];

  // Con un solo carril con material no hay nada que repartir.
  if (active.length === 1) {
    const only = active[0]!;
    return [...(lanes[only] ?? [])];
  }

  const total = active.reduce((sum, lane) => sum + (lanes[lane]?.length ?? 0), 0);
  const out: StoryDoc[] = [];

  for (let emitted = 0; emitted < total; emitted++) {
    // El de más deuda que aún tenga material.
    let pick: ReelLane | null = null;
    for (const lane of active) {
      if (cursors[lane]! >= (lanes[lane]?.length ?? 0)) continue;
      if (pick === null || debt[lane]! > debt[pick]!) pick = lane;
    }
    if (pick === null) break;

    out.push(lanes[pick]![cursors[pick]!]!);
    cursors[pick]! += 1;
    // Quien sale paga una unidad; los demás acumulan su cuota.
    debt[pick]! -= 1;
    for (const lane of active) debt[lane]! += quota[lane];
  }

  return out;
}

/** Separa una lista rankeada en sus carriles, conservando el orden. */
export function splitLanes(stories: StoryDoc[]): Partial<Record<ReelLane, StoryDoc[]>> {
  const lanes: Partial<Record<ReelLane, StoryDoc[]>> = {};
  for (const story of stories) {
    const lane: ReelLane = story.type === "saludo" ? "saludo" : "consejo";
    (lanes[lane] ??= []).push(story);
  }
  return lanes;
}
