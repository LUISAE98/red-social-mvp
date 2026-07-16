"use client";

// Señales de comportamiento del descubrimiento — 100% cliente, sin escrituras a
// Firestore. Al momento de la acción el cliente YA tiene el post (categoría, tags
// y texto), así que acumulamos peso por:
//   - categoría (cajón)         → alimenta el vector de gustos
//   - tags de la comunidad (C)  → refina dentro de la categoría
//   - palabras del texto (A)    → "contenido similar" barato, sin embeddings
// Todo con decaimiento en días (sigue tu interés ACTUAL). Los likes aportan su
// categoría vía el flame denormalizado (cross-device); tags/keywords van local.

import {
  normalizeGroupCategory,
  GROUP_CATEGORY_OPTIONS,
  type CanonicalGroupCategory,
} from "@/types/group";
import {
  extractContentKeywords,
  normalizeSearchText,
} from "@/lib/search/normalize";

// Decaimiento temporal (en días): las señales de comportamiento se enfrían solas.
export const SIGNAL_HALF_LIFE_MS = 2 * 24 * 60 * 60 * 1000; // 2 días
export const SIGNAL_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 días (tope)

/** Peso 0..1 según antigüedad: hoy=1, ~2 días≈0.5, ≥5 días=0. */
export function timeDecayWeight(ageMs: number): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= SIGNAL_MAX_AGE_MS) return 0;
  return Math.pow(0.5, ageMs / SIGNAL_HALF_LIFE_MS);
}

type SignalKind = "view" | "save" | "comment" | "search";
type ActionKind = SignalKind | "like";

// Peso de cada acción en la señal de CATEGORÍA (vector de gustos).
// Buscar es una petición EXPLÍCITA ("quiero ver esto") → señal fuerte.
const CATEGORY_KIND_WEIGHT: Record<SignalKind, number> = {
  view: 0.3,
  save: 2.5,
  comment: 2,
  search: 2.5,
};

// Peso de cada acción para tags/keywords (intención de contenido).
const ACTION_WEIGHT: Record<ActionKind, number> = {
  view: 0.4,
  save: 2,
  comment: 1.5,
  like: 1.5,
  search: 2.5,
};

const CATEGORY_KEY_PREFIX: Record<SignalKind, string> = {
  view: "red-social-mvp:viewed-categories:",
  save: "red-social-mvp:saved-categories:",
  comment: "red-social-mvp:commented-categories:",
  search: "red-social-mvp:searched-categories:",
};

// Mapa "texto normalizado → categoría canónica" para detectar cuándo una
// búsqueda corresponde a una categoría (ej. "viajes", "moda", "autos").
const CATEGORY_LOOKUP: Map<string, CanonicalGroupCategory> = (() => {
  const map = new Map<string, CanonicalGroupCategory>();
  for (const opt of GROUP_CATEGORY_OPTIONS) {
    if (opt.value === "otros") continue; // demasiado genérico
    const asWords = opt.value.replace(/_/g, " ");
    const full = normalizeSearchText(`${asWords} ${opt.label}`);
    map.set(normalizeSearchText(asWords), opt.value);
    map.set(normalizeSearchText(opt.label), opt.value);
    for (const word of full.split(" ")) {
      if (word.length >= 4 && !map.has(word)) map.set(word, opt.value);
    }
  }
  return map;
})();

function detectCategoryFromQuery(query: string): CanonicalGroupCategory | null {
  const normalized = normalizeSearchText(query);
  if (!normalized) return null;
  const direct = CATEGORY_LOOKUP.get(normalized);
  if (direct) return direct;
  for (const word of normalized.split(" ")) {
    const hit = CATEGORY_LOOKUP.get(word);
    if (hit) return hit;
  }
  return null;
}
const TAG_INTERESTS_KEY_PREFIX = "red-social-mvp:tag-interests:";
const KEYWORD_INTERESTS_KEY_PREFIX = "red-social-mvp:keyword-interests:";
const SEEN_POSTS_KEY_PREFIX = "red-social-mvp:seen-posts:";

const MAX_CATEGORY_WEIGHT = 12;
const MAX_TIMESTAMPS = 40;
const MAX_TAGS_TRACKED = 60;
const MAX_TAG_WEIGHT = 8;
const MAX_KEYWORDS_TRACKED = 150;
const MAX_KEYWORD_WEIGHT = 6;
const MAX_KEYWORDS_PER_POST = 12;
const MIN_KEYWORD_LENGTH = 3;
const SEEN_POSTS_MAX = 400;
const SEEN_POSTS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 días (anti-repetición)

type CategoryTimestamps = Record<string, number[]>;
type AccumEntry = { w: number; t: number };
type AccumStore = Record<string, AccumEntry>;
type SeenEntry = { id: string; at: number };

// ── Categorías (modelo de marcas de tiempo por acción) ─────────────────────────

function categoryKey(uid: string, kind: SignalKind): string {
  return `${CATEGORY_KEY_PREFIX[kind]}${uid}`;
}

function readCategoryTimestamps(
  uid: string,
  kind: SignalKind
): CategoryTimestamps {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(categoryKey(uid, kind));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as CategoryTimestamps)
      : {};
  } catch {
    return {};
  }
}

function recordCategorySignal(
  uid: string,
  kind: SignalKind,
  rawCategory: unknown
): void {
  const category = normalizeGroupCategory(rawCategory);
  if (!category) return;
  try {
    const now = Date.now();
    const cutoff = now - SIGNAL_MAX_AGE_MS;
    const store = readCategoryTimestamps(uid, kind);
    const prev = Array.isArray(store[category]) ? store[category] : [];
    const pruned = prev.filter((t) => typeof t === "number" && t > cutoff);
    pruned.push(now);
    store[category] = pruned.slice(-MAX_TIMESTAMPS);
    window.localStorage.setItem(categoryKey(uid, kind), JSON.stringify(store));
  } catch {}
}

// ── Acumulador decaído genérico (tags y keywords) ──────────────────────────────

function readAccum(key: string): AccumStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as AccumStore) : {};
  } catch {
    return {};
  }
}

function recordAccum(
  key: string,
  items: string[],
  addWeight: number,
  maxWeight: number,
  maxItems: number
): void {
  if (typeof window === "undefined" || items.length === 0) return;
  try {
    const now = Date.now();
    const store = readAccum(key);

    for (const item of items) {
      const prev = store[item];
      const base = prev ? prev.w * timeDecayWeight(now - prev.t) : 0;
      store[item] = { w: Math.min(base + addWeight, maxWeight), t: now };
    }

    let entries = Object.entries(store);
    if (entries.length > maxItems) {
      entries = entries
        .sort(
          (a, b) =>
            b[1].w * timeDecayWeight(now - b[1].t) -
            a[1].w * timeDecayWeight(now - a[1].t)
        )
        .slice(0, maxItems);
      window.localStorage.setItem(key, JSON.stringify(Object.fromEntries(entries)));
    } else {
      window.localStorage.setItem(key, JSON.stringify(store));
    }
  } catch {}
}

function accumWeights(key: string, minWeight: number): Map<string, number> {
  const map = new Map<string, number>();
  const now = Date.now();
  const store = readAccum(key);
  for (const [item, entry] of Object.entries(store)) {
    if (!entry || typeof entry.w !== "number" || typeof entry.t !== "number") {
      continue;
    }
    const weight = entry.w * timeDecayWeight(now - entry.t);
    if (weight >= minWeight) map.set(item, weight);
  }
  return map;
}

function normalizeTagList(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const norm = t.trim().toLowerCase();
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function extractKeywords(text: unknown): string[] {
  return extractContentKeywords(text, {
    minLength: MIN_KEYWORD_LENGTH,
    maxKeywords: MAX_KEYWORDS_PER_POST,
  });
}

function recordContentSignals(
  uid: string,
  action: ActionKind,
  tags: unknown,
  text: unknown
): void {
  if (!uid || typeof window === "undefined") return;
  const weight = ACTION_WEIGHT[action];

  const tagList = normalizeTagList(tags);
  if (tagList.length > 0) {
    recordAccum(
      `${TAG_INTERESTS_KEY_PREFIX}${uid}`,
      tagList,
      weight,
      MAX_TAG_WEIGHT,
      MAX_TAGS_TRACKED
    );
  }

  const keywords = extractKeywords(text);
  if (keywords.length > 0) {
    recordAccum(
      `${KEYWORD_INTERESTS_KEY_PREFIX}${uid}`,
      keywords,
      weight,
      MAX_KEYWORD_WEIGHT,
      MAX_KEYWORDS_TRACKED
    );
  }
}

// ── Seen (anti-repetición) ─────────────────────────────────────────────────────

function seenKey(uid: string): string {
  return `${SEEN_POSTS_KEY_PREFIX}${uid}`;
}

function readSeenEntries(uid: string): SeenEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(seenKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SeenEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── API pública de registro ────────────────────────────────────────────────────

type EngagementInput = {
  postId?: string | null;
  category?: unknown;
  tags?: unknown;
  text?: unknown;
};

/** Vista (dwell): categoría + tags + keywords, y marca el post como visto. */
export function recordPostImpression(uid: string, input: EngagementInput): void {
  if (!uid || typeof window === "undefined") return;

  const postId =
    typeof input.postId === "string" && input.postId ? input.postId : null;
  if (postId) {
    try {
      const cutoff = Date.now() - SEEN_POSTS_TTL_MS;
      const existing = readSeenEntries(uid).filter(
        (entry) => entry.at > cutoff && entry.id !== postId
      );
      const merged = [{ id: postId, at: Date.now() }, ...existing].slice(
        0,
        SEEN_POSTS_MAX
      );
      window.localStorage.setItem(seenKey(uid), JSON.stringify(merged));
    } catch {}
  }

  recordCategorySignal(uid, "view", input.category);
  recordContentSignals(uid, "view", input.tags, input.text);
}

/** Guardar (intención fuerte): categoría + tags + keywords. */
export function recordPostSaveSignal(uid: string, input: EngagementInput): void {
  recordCategorySignal(uid, "save", input.category);
  recordContentSignals(uid, "save", input.tags, input.text);
}

/** Comentar (intención fuerte): categoría + tags + keywords. */
export function recordPostCommentSignal(
  uid: string,
  input: EngagementInput
): void {
  recordCategorySignal(uid, "comment", input.category);
  recordContentSignals(uid, "comment", input.tags, input.text);
}

/** Like: tags + keywords (la categoría del like va aparte, vía el flame). */
export function recordPostLikeSignal(uid: string, input: EngagementInput): void {
  recordContentSignals(uid, "like", input.tags, input.text);
}

/**
 * Búsqueda: petición explícita del usuario. Registra la categoría (si el término
 * coincide con una) y las palabras del query como señal fuerte. Base ideal para
 * el arranque en frío: solo mostramos lo que el usuario efectivamente pidió.
 */
export function recordSearchSignal(uid: string, query: unknown): void {
  if (!uid || typeof query !== "string") return;
  const trimmed = query.trim();
  if (trimmed.length < 2) return;

  const category = detectCategoryFromQuery(trimmed);
  if (category) recordCategorySignal(uid, "search", category);
  recordContentSignals(uid, "search", [], trimmed);
}

// ── API pública de lectura (para el motor) ─────────────────────────────────────

/**
 * Pesos combinados por categoría de las señales de comportamiento locales
 * (vista + guardar + comentar), ya decaídos y ponderados. Suma directa al gusto.
 */
export function getBehaviorCategoryWeights(
  uid: string
): Map<CanonicalGroupCategory, number> {
  const combined = new Map<CanonicalGroupCategory, number>();
  if (!uid) return combined;

  (Object.keys(CATEGORY_KIND_WEIGHT) as SignalKind[]).forEach((kind) => {
    const weight = CATEGORY_KIND_WEIGHT[kind];
    const now = Date.now();
    const store = readCategoryTimestamps(uid, kind);
    for (const [key, value] of Object.entries(store)) {
      const category = normalizeGroupCategory(key);
      if (!category || !Array.isArray(value)) continue;
      let acc = 0;
      for (const t of value) {
        if (typeof t !== "number") continue;
        acc += timeDecayWeight(now - t);
      }
      if (acc <= 0) continue;
      const capped = Math.min(acc, MAX_CATEGORY_WEIGHT);
      combined.set(category, (combined.get(category) ?? 0) + capped * weight);
    }
  });

  return combined;
}

/** Tags de interés derivados del engagement (C): tag → peso decaído. */
export function getEngagementTagWeights(uid: string): Map<string, number> {
  if (!uid) return new Map();
  return accumWeights(`${TAG_INTERESTS_KEY_PREFIX}${uid}`, 0.6);
}

/** Palabras de interés derivadas del engagement (A): keyword → peso decaído. */
export function getKeywordInterests(uid: string): Set<string> {
  if (!uid) return new Set();
  return new Set(accumWeights(`${KEYWORD_INTERESTS_KEY_PREFIX}${uid}`, 0.5).keys());
}

/** Ids de posts ya vistos (para excluirlos como "nuevos" en descubrimiento). */
export function getSeenPostIds(uid: string): Set<string> {
  if (!uid) return new Set();
  const cutoff = Date.now() - SEEN_POSTS_TTL_MS;
  return new Set(
    readSeenEntries(uid)
      .filter((entry) => entry.at > cutoff)
      .map((entry) => entry.id)
  );
}
