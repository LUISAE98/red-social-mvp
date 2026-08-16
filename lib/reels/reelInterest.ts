"use client";

// Qué le interesa a alguien, deducido de CUÁNTO se queda mirando.
//
// El vector de gustos que ya existía se calcula sobre `categories`, y en una
// historia de perfil esas categorías se heredan de los INTERESES DEL CREADOR, no
// del contenido. Si alguien tiene puestos "música" y "deportes", todos sus
// consejos puntúan igual aunque hablen de cosas distintas.
//
// El texto del contexto sí describe el contenido real, porque es lo que el
// comprador escribió al encargarlo. Cruzarlo con el tiempo que el espectador se
// quedó mirando da una señal mucho más fina: quedarse es interés, pasar de largo
// en dos segundos es lo contrario, y las dos cosas se aprenden.
//
// Vive aparte del recomendador de posts a propósito. Aquello puntúa categorías
// amplias; esto puntúa palabras, y mezclarlos habría contaminado ambos.

import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { tokenizeSearchText } from "@/lib/search/normalize";
import type { StoryDoc } from "@/lib/stories/types";

/** Documento único por usuario. Un mapa de palabra a peso. */
const DOC_PATH = (uid: string) => doc(db, "users", uid, "reelSignals", "terms");

/** Palabras demasiado cortas no discriminan nada. */
const MIN_TERM_LENGTH = 4;
/** Cuántas palabras se toman de cada historia. */
const MAX_TERMS_PER_STORY = 8;
/** Techo por palabra, para que una obsesión no aplaste al resto del vector. */
const MAX_TERM_WEIGHT = 12;
/** Se ignora lo que pese menos que esto al puntuar. */
const MIN_USEFUL_WEIGHT = 0.5;

/** Interés observado en una historia concreta. */
export type ReelEngagement = {
  story: StoryDoc;
  /** Milisegundos con la historia en pantalla. */
  dwellMs: number;
  /** Fracción del video que llegó a verse, de 0 a 1. */
  completion: number;
};

export type TermVector = Map<string, number>;

/** Palabras representativas del contenido de una historia. */
export function storyTerms(story: StoryDoc): string[] {
  const source = story.instructions ?? "";
  if (!source.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokenizeSearchText(source)) {
    if (token.length < MIN_TERM_LENGTH) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= MAX_TERMS_PER_STORY) break;
  }
  return out;
}

/**
 * Cuánto suma o resta esta visualización.
 *
 * Quedarse suma, y terminar el video suma más. Pasar de largo en menos de dos
 * segundos resta, poco: puede que la persona simplemente estuviera buscando otra
 * cosa, así que la señal negativa es un empujón, no un castigo.
 */
export function engagementWeight({ dwellMs, completion }: Omit<ReelEngagement, "story">): number {
  if (dwellMs < 2000) return -0.5;
  if (completion >= 0.8) return 2;
  if (dwellMs >= 8000) return 1.5;
  return 1;
}

/** Aplica una visualización sobre el vector, en memoria. */
export function applyEngagement(vector: TermVector, engagement: ReelEngagement): void {
  const weight = engagementWeight(engagement);
  if (weight === 0) return;
  for (const term of storyTerms(engagement.story)) {
    const next = (vector.get(term) ?? 0) + weight;
    // Nunca baja de cero: un desinterés puntual no debe invertir un interés real.
    vector.set(term, Math.max(0, Math.min(MAX_TERM_WEIGHT, next)));
  }
}

/**
 * Afinidad de una historia con lo que la persona se queda viendo, de 0 a 1.
 *
 * Es la proporción de palabras de la historia que pesan en el vector, ponderada
 * por cuánto pesan. Se normaliza por el número de palabras de la historia para
 * que un contexto largo no gane solo por ser largo.
 */
export function termAffinity(story: StoryDoc, vector: TermVector): number {
  if (vector.size === 0) return 0;
  const terms = storyTerms(story);
  if (terms.length === 0) return 0;

  let sum = 0;
  for (const term of terms) {
    const weight = vector.get(term) ?? 0;
    if (weight < MIN_USEFUL_WEIGHT) continue;
    sum += Math.min(1, weight / MAX_TERM_WEIGHT);
  }
  return Math.min(1, sum / terms.length);
}

export async function loadTermVector(uid: string): Promise<TermVector> {
  const vector: TermVector = new Map();
  if (!uid) return vector;
  try {
    const snap = await getDoc(DOC_PATH(uid));
    const raw = snap.data()?.terms;
    if (raw && typeof raw === "object") {
      for (const [term, weight] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof weight === "number" && Number.isFinite(weight)) vector.set(term, weight);
      }
    }
  } catch (err) {
    // Sin vector el feed sigue funcionando, solo pierde esta señal.
    console.error("[reelInterest] load", err);
  }
  return vector;
}

/**
 * Guarda el vector entero, no incrementos.
 *
 * Se escribe UNA vez por sesión (al salir del feed), no en cada historia. Con
 * incrementos habría que escribir en cada scroll, y un feed son decenas de
 * scrolls por minuto.
 */
export async function saveTermVector(uid: string, vector: TermVector): Promise<void> {
  if (!uid || vector.size === 0) return;
  const terms: Record<string, number> = {};
  for (const [term, weight] of vector) {
    if (weight >= MIN_USEFUL_WEIGHT) terms[term] = Math.round(weight * 100) / 100;
  }
  try {
    await setDoc(DOC_PATH(uid), { terms, updatedAt: serverTimestamp() }, { merge: false });
  } catch (err) {
    console.error("[reelInterest] save", err);
  }
}
