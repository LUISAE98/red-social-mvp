"use client";

// Señales de comportamiento del descubrimiento (Fase 3+) — 100% cliente, sin
// escrituras a Firestore. Al momento de la acción el cliente YA tiene el post
// (con su `groupCategory`), así que acumulamos peso por categoría en localStorage:
//   - vista (dwell)   → señal débil
//   - guardar         → intención fuerte
//   - comentar        → intención fuerte
// Todas con marca de tiempo para aplicar decaimiento en días (siguen tu interés
// ACTUAL). Los likes van aparte (denormalizados en el flame, cross-device).

import {
  normalizeGroupCategory,
  type CanonicalGroupCategory,
} from "@/types/group";

// Decaimiento temporal (en días): las señales de comportamiento se enfrían solas.
// Vida media 2 días; se ignora todo lo de más de 5 días.
export const SIGNAL_HALF_LIFE_MS = 2 * 24 * 60 * 60 * 1000; // 2 días
export const SIGNAL_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000; // 5 días (tope)

/** Peso 0..1 según antigüedad: hoy=1, ~2 días≈0.5, ≥5 días=0. */
export function timeDecayWeight(ageMs: number): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= SIGNAL_MAX_AGE_MS) return 0;
  return Math.pow(0.5, ageMs / SIGNAL_HALF_LIFE_MS);
}

type SignalKind = "view" | "save" | "comment";

// Peso relativo de cada acción en el vector de gustos (por acción, ya decaída).
const KIND_WEIGHT: Record<SignalKind, number> = {
  view: 0.3, // ver es la señal más débil/ruidosa
  save: 2.5, // guardar es intención fuerte (≈ like)
  comment: 2, // comentar es intención fuerte
};

const SIGNAL_KEY_PREFIX: Record<SignalKind, string> = {
  view: "red-social-mvp:viewed-categories:",
  save: "red-social-mvp:saved-categories:",
  comment: "red-social-mvp:commented-categories:",
};

const SEEN_POSTS_KEY_PREFIX = "red-social-mvp:seen-posts:";

// Tope del peso decaído acumulado por categoría/acción (evita que una domine).
const MAX_CATEGORY_WEIGHT = 12;
// Máximo de marcas de tiempo guardadas por categoría (acota tamaño en storage).
const MAX_TIMESTAMPS = 40;
const SEEN_POSTS_MAX = 400;
const SEEN_POSTS_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 días (anti-repetición)

type CategoryTimestamps = Record<string, number[]>;
type SeenEntry = { id: string; at: number };

function signalKey(uid: string, kind: SignalKind): string {
  return `${SIGNAL_KEY_PREFIX[kind]}${uid}`;
}

function seenKey(uid: string): string {
  return `${SEEN_POSTS_KEY_PREFIX}${uid}`;
}

function readTimestamps(uid: string, kind: SignalKind): CategoryTimestamps {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(signalKey(uid, kind));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as CategoryTimestamps)
      : {};
  } catch {
    return {};
  }
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

// Acumula una marca de tiempo para la categoría de una acción (con poda por TTL).
function recordCategorySignal(
  uid: string,
  kind: SignalKind,
  rawCategory: unknown
): void {
  if (!uid || typeof window === "undefined") return;
  const category = normalizeGroupCategory(rawCategory);
  if (!category) return;

  try {
    const now = Date.now();
    const cutoff = now - SIGNAL_MAX_AGE_MS;
    const store = readTimestamps(uid, kind);
    const prev = Array.isArray(store[category]) ? store[category] : [];
    const pruned = prev.filter((t) => typeof t === "number" && t > cutoff);
    pruned.push(now);
    store[category] = pruned.slice(-MAX_TIMESTAMPS);
    window.localStorage.setItem(signalKey(uid, kind), JSON.stringify(store));
  } catch {}
}

// Peso decaído por categoría para una acción concreta (capado).
function decayedWeights(
  uid: string,
  kind: SignalKind
): Map<CanonicalGroupCategory, number> {
  const map = new Map<CanonicalGroupCategory, number>();
  const now = Date.now();
  const store = readTimestamps(uid, kind);
  for (const [key, value] of Object.entries(store)) {
    const category = normalizeGroupCategory(key);
    if (!category || !Array.isArray(value)) continue;
    let weight = 0;
    for (const t of value) {
      if (typeof t !== "number") continue;
      weight += timeDecayWeight(now - t);
    }
    if (weight <= 0) continue;
    map.set(category, Math.min(weight, MAX_CATEGORY_WEIGHT));
  }
  return map;
}

/**
 * Registra que el usuario vio un post (dwell). Suma peso a su categoría y lo
 * marca como visto (anti-repetición).
 */
export function recordPostImpression(
  uid: string,
  input: { postId?: string | null; category?: unknown }
): void {
  if (!uid || typeof window === "undefined") return;

  // Anti-repetición: marcar el id como visto (capado + TTL)
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
}

/** Registra que el usuario guardó un post (intención fuerte). */
export function recordPostSaveSignal(uid: string, category: unknown): void {
  recordCategorySignal(uid, "save", category);
}

/** Registra que el usuario comentó un post (intención fuerte). */
export function recordPostCommentSignal(uid: string, category: unknown): void {
  recordCategorySignal(uid, "comment", category);
}

/**
 * Pesos combinados por categoría de TODAS las señales de comportamiento locales
 * (vista + guardar + comentar), ya decaídos y multiplicados por su peso relativo.
 * Listo para sumar directo al vector de gustos.
 */
export function getBehaviorCategoryWeights(
  uid: string
): Map<CanonicalGroupCategory, number> {
  const combined = new Map<CanonicalGroupCategory, number>();
  if (!uid) return combined;

  (Object.keys(KIND_WEIGHT) as SignalKind[]).forEach((kind) => {
    const weight = KIND_WEIGHT[kind];
    for (const [category, value] of decayedWeights(uid, kind)) {
      combined.set(category, (combined.get(category) ?? 0) + value * weight);
    }
  });

  return combined;
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
