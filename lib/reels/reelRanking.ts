// Puntuación y mezcla del feed de reels. Lógica PURA, sin Firestore.
//
// Va aparte de las consultas por dos motivos: se puede probar sin emulador, y
// deja a la vista la única parte del feed que es una decisión de producto y no
// de infraestructura.

import { normalizeGroupCategory, type CanonicalGroupCategory } from "@/types/group";
import type { StoryDoc, StoryType } from "@/lib/stories/types";
import { isLiveItem, liveStartedAtMs, type ReelItem, type ReelLivePost } from "./reelItems";

/**
 * Cuota del carril de descubrimiento: 70% consejos, 15% saludos y 15% lives.
 *
 * Es un objetivo, no un reparto exacto. Casi nunca hay lives transmitiendo, y el
 * mezclador reparte su turno entre los demás en vez de dejar el hueco vacío. En
 * la práctica el feed se ve como un 82/18 cuando no hay nadie en vivo, y se
 * acerca a estos números cuando sí lo hay.
 */
export const REEL_QUOTA: Record<ReelLane, number> = {
  consejo: 0.7,
  saludo: 0.15,
  live: 0.15,
};

export type ReelLane = StoryType | "live";

/**
 * Media vida de la frescura, en dias.
 *
 * ⚠️ Estuvo en 30 dias y hundia lo recien publicado. Con esa media vida, dos
 * historias separadas por una semana casi empataban en frescura, asi que quien
 * decidia era la popularidad, y lo nuevo empieza con cero vistas por definicion:
 * una historia de hace dos semanas con 500 vistas sacaba 3.78 y una recien
 * publicada 1.50. Lo nuevo salia al final del feed, que es justo lo contrario de
 * lo que un feed debe hacer.
 *
 * A tres dias la frescura vuelve a distinguir lo de hoy de lo de la semana
 * pasada, que es la escala en la que la gente nota que un feed esta vivo.
 */
const RECENCY_HALF_LIFE_DAYS = 3;
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
  /**
   * Afinidad con lo que la persona SE QUEDA VIENDO, de 0 a 1. Sale del texto del
   * contexto cruzado con el tiempo de permanencia (ver `reelInterest`). Pesa más
   * que la categoría porque describe el contenido real y no los intereses
   * declarados de quien lo grabó.
   */
  interest?: number;
};

/**
 * Puntúa una historia para el carril de descubrimiento.
 *
 * Manda lo que esta persona demuestra que le interesa; despues, que sea
 * reciente; y solo entonces, cuanta gente lo ha visto.
 *
 * La frescura es un decaimiento suave y no una ventana con corte: el histórico
 * entero sigue siendo elegible, solo que lo de hoy sale antes.
 */
export function scoreStory({ story, taste, nowMs, interest = 0 }: ScoreInput): number {
  let affinity = 0;
  if (Array.isArray(story.categories)) {
    for (const raw of story.categories) {
      const cat = normalizeGroupCategory(raw);
      if (cat) affinity = Math.max(affinity, taste.get(cat) ?? 0);
    }
  }

  const ageMs = Math.max(0, nowMs - (story.createdAt?.toMillis?.() ?? nowMs));
  // Decaimiento exponencial: a los tres dias vale la mitad, y nunca llega a cero.
  const recency = Math.pow(0.5, ageMs / (RECENCY_HALF_LIFE_DAYS * DAY_MS));

  const affinityNorm = clamp01(affinity / AFFINITY_SATURATION);
  const popularityNorm = clamp01(
    Math.log1p(story.viewsCount ?? 0) / Math.log1p(POPULARITY_SATURATION),
  );

  // Las tres ya van de 0 a 1, así que el peso decide de verdad. Con gusto
  // definido, una afinidad plena (3) gana a una popularidad plena (1.5) por el
  // doble; una afinidad floja no, y eso es correcto.
  const interestNorm = clamp01(interest);

  // La permanencia pesa 4, por encima de la categoría (3). Es la única señal que
  // viene del comportamiento real de esta persona con este contenido; las demás
  // son declaradas o agregadas.
  //
  // En frío hay una excepción: aunque no haya categorías, si ya se ha quedado
  // viendo cosas la permanencia manda igual. Por eso entra en las dos ramas.
  //
  // Y la frescura pesa por encima de la popularidad, no al reves.
  //
  // La popularidad es un marcador acumulado: solo puede crecer, y lo hace con el
  // tiempo. Poniendola por delante, lo viejo gana siempre por el mero hecho de
  // llevar mas tiempo publicado, y lo nuevo no tiene forma de entrar. Sigue
  // contando —entre dos historias igual de frescas decide ella— pero deja de ser
  // una barrera de entrada.
  return taste.size > 0
    ? interestNorm * 4 + affinityNorm * 3 + popularityNorm * 1.5 + recency * 3
    : interestNorm * 4 + popularityNorm * 2 + recency * 3.5;
}

/**
 * Ordena por puntuación DESCARTANDO lo ya visto.
 *
 * ⚠️ Antes lo visto no se descartaba, se empujaba al final. La idea era que con
 * el histórico completo excluirlo vaciaría el feed, pero en la práctica el
 * resultado era peor: seguía apareciendo, y encima la cabeza del feed —lo de
 * quien sigues— arrastraba las mismas historias vistas cada vez que se abría el
 * reel. Se sentía como que el feed premiaba lo ya visto.
 *
 * Un video visto no vuelve. Si eso deja el feed corto, la respuesta es traer más
 * material, no reciclar el que la persona ya se sabe.
 *
 * Vista = dos segundos de reproducción; lo marca el propio slide.
 */
export function rankStories(
  stories: StoryDoc[],
  taste: Map<CanonicalGroupCategory, number>,
  viewedAt: Map<string, number>,
  nowMs: number,
  interestOf?: (story: StoryDoc) => number,
): StoryDoc[] {
  const fresh: Array<{ story: StoryDoc; score: number }> = [];

  for (const story of stories) {
    if (viewedAt.has(story.id)) continue;
    fresh.push({
      story,
      score: scoreStory({ story, taste, nowMs, interest: interestOf?.(story) ?? 0 }),
    });
  }

  fresh.sort((a, b) => b.score - a.score);
  return fresh.map((e) => e.story);
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
export function mixByQuota<T>(
  lanes: Partial<Record<ReelLane, T[]>>,
  quota: Record<ReelLane, number> = REEL_QUOTA,
): T[] {
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
  const out: T[] = [];

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

/**
 * Separa historias del mismo creador para que no salgan seguidas.
 *
 * El ranking ordena por calidad y el mezclador reparte entre consejos y saludos,
 * pero ninguno de los dos mira de QUIÉN es cada historia. Con pocos creadores
 * —que es siempre el principio de una plataforma— eso saca cinco seguidas de la
 * misma persona y el feed se siente repetitivo aunque el orden sea "correcto".
 *
 * Es un reparto conservador, no una reordenación: se avanza por la lista y, si
 * el siguiente es de un creador que ya salió dentro de la ventana, se busca al
 * primero que no lo esté. Si no hay ninguno, sale igual. Nunca se pierde nada ni
 * se altera el orden más de lo imprescindible.
 *
 * De quién es cada cosa se pide como función, por el mismo motivo que el carril:
 * esto reparte historias y lives, y cada uno guarda a su autor en otro campo.
 */
export function spreadByCreator<T>(
  items: T[],
  authorOf: (item: T) => string,
  minGap = 3,
): T[] {
  if (items.length <= 2 || minGap < 1) return items;

  const pending = [...items];
  const out: T[] = [];
  /** Últimos creadores emitidos, del más reciente al más antiguo. */
  const recent: string[] = [];

  while (pending.length > 0) {
    let pick = pending.findIndex((s) => !recent.includes(authorOf(s)));
    // Todos los que quedan son de creadores recientes: se acepta el primero.
    if (pick === -1) pick = 0;

    const [chosen] = pending.splice(pick, 1);
    if (!chosen) break;
    out.push(chosen);

    recent.unshift(authorOf(chosen));
    if (recent.length > minGap) recent.length = minGap;
  }

  return out;
}

/**
 * Quién GRABÓ la historia, que no siempre es quien la publicó: cuando el
 * comprador republica el saludo que le hicieron, la cara que cuenta sigue siendo
 * la del creador.
 */
export function authorOfStory(story: StoryDoc): string {
  return story.greetingCreatorId ?? story.creatorId ?? "";
}

/** Quién está detrás de cualquier cosa del feed. */
export function authorOfItem(item: ReelItem): string {
  return isLiveItem(item) ? (item.post.authorId ?? "") : authorOfStory(item.story);
}

/** A qué carril pertenece una historia. */
export function laneOfStory(story: StoryDoc): ReelLane {
  return story.type === "saludo" ? "saludo" : "consejo";
}

/** A qué carril pertenece cualquier cosa del feed. */
export function laneOfItem(item: ReelItem): ReelLane {
  return isLiveItem(item) ? "live" : laneOfStory(item.story);
}

/**
 * Separa una lista rankeada en sus carriles, conservando el orden.
 *
 * El carril se pide como función en vez de mirarlo aquí dentro porque esto se
 * usa con dos cosas distintas —historias sueltas y la mezcla de historias y
 * lives— y duplicar la función para cada una era peor que pasar la regla.
 */
export function splitLanes<T>(
  items: T[],
  laneOf: (item: T) => ReelLane,
): Partial<Record<ReelLane, T[]>> {
  const lanes: Partial<Record<ReelLane, T[]>> = {};
  for (const item of items) {
    (lanes[laneOf(item)] ??= []).push(item);
  }
  return lanes;
}

/**
 * Media vida de lo recién empezado, en minutos. Un live que lleva dos horas no
 * es peor que uno que acaba de arrancar, pero entrar al principio se disfruta
 * más que entrar al final, así que pesa un poco y no mucho.
 */
const LIVE_START_HALF_LIFE_MIN = 60;
/** Con estos espectadores la señal social ya vale su peso entero. */
const LIVE_VIEWERS_SATURATION = 500;

type RankLivesOptions = {
  /** A quién sigue el usuario. Es la señal fuerte y la única que sale gratis. */
  followedIds?: Set<string>;
  /**
   * Espectadores de cada live.
   *
   * Se inyecta porque el dato NO está en el post: vive en la subcolección
   * `liveViewers`, y contarlo cuesta una consulta por live. Quien llame decide
   * si le sale a cuenta pagarla; sin ella, el orden sigue teniendo sentido.
   */
  viewersOf?: (post: ReelLivePost) => number;
  nowMs: number;
};

/**
 * Ordena los lives entre sí.
 *
 * Es MUCHO más simple que el ranking de historias, y a propósito. Un live no
 * tiene vistas acumuladas, ni texto de contexto, ni categorías denormalizadas,
 * ni antigüedad que signifique nada: nace y muere en unas horas. Inventarle esas
 * señales para poder usar la misma fórmula habría dado un número con aspecto de
 * riguroso y sin sustancia detrás.
 *
 * Además suele haber un puñado, no cientos, así que afinar aquí rinde poco.
 */
export function rankLives(lives: ReelItem[], options: RankLivesOptions): ReelItem[] {
  const { followedIds, viewersOf, nowMs } = options;

  const scored = lives.filter(isLiveItem).map((item) => {
    const post = item.post;

    const followed = followedIds?.has(post.authorId) ? 1 : 0;

    const viewers = viewersOf?.(post) ?? 0;
    const viewersNorm =
      viewers > 0
        ? Math.min(1, Math.log10(1 + viewers) / Math.log10(1 + LIVE_VIEWERS_SATURATION))
        : 0;

    const startedMs = liveStartedAtMs(post);
    const minutesLive = startedMs > 0 ? Math.max(0, (nowMs - startedMs) / 60_000) : Infinity;
    const startRecency = Number.isFinite(minutesLive)
      ? Math.pow(2, -minutesLive / LIVE_START_HALF_LIFE_MIN)
      : 0;

    return { item, score: followed * 2 + viewersNorm * 1 + startRecency * 0.5 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((e) => e.item);
}
