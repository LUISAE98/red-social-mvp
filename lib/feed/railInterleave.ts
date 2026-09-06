/**
 * Reparto de los huecos del feed entre los dos rails.
 *
 * Las posiciones ya las decide `buildRandomRecommendationSlots`, con la semilla
 * estable de la sesión. Lo que se hace aquí es repartirlas: el primer hueco es
 * de recomendaciones, el segundo de reels, el tercero de recomendaciones… y así.
 * Turnándose, el feed no encadena dos rails del mismo tipo y se lee con más
 * variedad, que es de lo que se trata.
 *
 * Cada tipo lleva ADEMÁS su propio contador (0, 1, 2…). Es lo que hace que dos
 * apariciones del mismo rail no enseñen lo mismo: el de recomendaciones ya lo
 * usaba como `railIndex`, y el de reels lo usa para llevarse otro trozo del feed
 * compartido (ver `useReelRailSlice`).
 *
 * Todo esto es determinista: mismas posiciones y mismo reparto en cada render.
 * Si dependiera del azar, al cargar más publicaciones los rails cambiarían de
 * tipo y de contenido a media pantalla, que es justo lo que hay que evitar.
 */

import { buildRandomRecommendationSlots } from "@/app/components/GroupRecommendations/recommendation-engine";

export type TipoRail = "recomendaciones" | "reels";

export type HuecoRail = {
  tipo: TipoRail;
  /** Cuántos rails de ESE tipo van ya delante. Empieza en 0. */
  indice: number;
};

/**
 * Qué rail va detrás de cada publicación.
 *
 * La clave es la posición dentro del feed (1 = detrás de la primera
 * publicación), igual que la usaba el rail de recomendaciones.
 */
export function buildRailPlan(totalPosts: number, seed: number): Map<number, HuecoRail> {
  const plan = new Map<number, HuecoRail>();
  if (totalPosts <= 0) return plan;

  const posiciones = [...buildRandomRecommendationSlots(totalPosts, seed)].sort((a, b) => a - b);

  const contadores: Record<TipoRail, number> = { recomendaciones: 0, reels: 0 };

  posiciones.forEach((posicion, i) => {
    const tipo: TipoRail = i % 2 === 0 ? "recomendaciones" : "reels";
    plan.set(posicion, { tipo, indice: contadores[tipo] });
    contadores[tipo] += 1;
  });

  return plan;
}

/**
 * Igual, pero para las pantallas donde solo va el rail de reels: hoy las
 * comunidades, que nunca han llevado el de recomendaciones. Meter ahí
 * recomendaciones de OTRAS comunidades se leería como una fuga hacia fuera.
 */
export function buildReelRailPlan(totalPosts: number, seed: number): Map<number, HuecoRail> {
  const plan = new Map<number, HuecoRail>();
  if (totalPosts <= 0) return plan;

  const posiciones = [...buildRandomRecommendationSlots(totalPosts, seed)].sort((a, b) => a - b);

  posiciones.forEach((posicion, i) => {
    plan.set(posicion, { tipo: "reels", indice: i });
  });

  return plan;
}
