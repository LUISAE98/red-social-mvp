import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import type { SuperComment, SuperCommentConfig, SuperCommentTier } from "./types";
import { DEFAULT_SUPER_COMMENT_CONFIG } from "./types";
import type { ActiveSuperComment } from "@/lib/posts/types";

// ── Config del usuario ──────────────────────────────────────────────────────

export async function getSuperCommentConfig(
  userId: string,
): Promise<SuperCommentConfig> {
  const snap = await getDoc(
    doc(db, "users", userId, "settings", "superCommentConfig"),
  );
  if (!snap.exists()) return { ...DEFAULT_SUPER_COMMENT_CONFIG };
  const data = snap.data();
  return {
    enabled: data.enabled ?? true,
    currency: SETTLEMENT_CURRENCY,
    tiers: (data.tiers as SuperCommentTier[]) ?? DEFAULT_SUPER_COMMENT_CONFIG.tiers,
  };
}

export async function saveSuperCommentConfig(
  userId: string,
  config: SuperCommentConfig,
): Promise<void> {
  await setDoc(
    doc(db, "users", userId, "settings", "superCommentConfig"),
    { ...config, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// ── Config por live ─────────────────────────────────────────────────────────

export async function copySuperCommentConfigToLive(
  postId: string,
  config: SuperCommentConfig,
): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.superCommentConfig": config,
    updatedAt: serverTimestamp(),
  });
}

export async function updateLiveSuperCommentEnabled(
  postId: string,
  enabled: boolean,
): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.superCommentConfig.enabled": enabled,
    updatedAt: serverTimestamp(),
  });
}

// ── Submit (pago simulado) ──────────────────────────────────────────────────

export async function submitSuperCommentAsGuest(params: {
  postId: string;
  guestId: string;
  username: string;
  text: string;
  tier: SuperCommentTier;
}): Promise<string> {
  const res = await fetch("/api/super-comment-submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postId: params.postId,
      guestId: params.guestId,
      username: params.username,
      text: params.text,
      tierId: params.tier.id,
      tierName: params.tier.name,
      color: params.tier.color,
      displaySeconds: params.tier.displaySeconds,
      amount: params.tier.price,
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Error al enviar supercomentario");
  }
  const data = await res.json() as { id: string };
  return data.id;
}

export async function submitSuperComment(params: {
  postId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  text: string;
  tier: SuperCommentTier;
}): Promise<string> {
  const ref = await addDoc(
    collection(db, "posts", params.postId, "superComments"),
    {
      userId: params.userId,
      username: params.username,
      avatarUrl: params.avatarUrl,
      text: params.text,
      tierId: params.tier.id,
      tierName: params.tier.name,
      color: params.tier.color,
      displaySeconds: params.tier.displaySeconds,
      amount: params.tier.price,
      currency: SETTLEMENT_CURRENCY,
      status: "paid",
      hidden: false,
      isDeleted: false,
      played: false,
      createdAt: serverTimestamp(),
    },
  );
  return ref.id;
}

// ── Suscripción (feed del creador) ──────────────────────────────────────────

export function subscribeSuperComments(
  postId: string,
  onData: (items: SuperComment[]) => void,
  onError?: (err: Error) => void,
): () => void {
  // Sólo orderBy para evitar índice compuesto; filtros en cliente.
  const q = query(
    collection(db, "posts", postId, "superComments"),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      const items: SuperComment[] = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<SuperComment, "id">) }))
        .filter((d) => !d.isDeleted && d.status === "paid");
      onData(items);
    },
    (err) => onError?.(err),
  );
}

// Suscripción para el viewer — excluye ocultos y borrados
export function subscribeVisibleSuperComments(
  postId: string,
  onData: (items: SuperComment[]) => void,
): () => void {
  const q = query(
    collection(db, "posts", postId, "superComments"),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(q, (snap) => {
    const items: SuperComment[] = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<SuperComment, "id">) }))
      .filter((d) => !d.isDeleted && !d.hidden && d.status === "paid");
    onData(items);
  });
}

// ── Acciones del creador ────────────────────────────────────────────────────

export function hideSuperComment(postId: string, superCommentId: string): Promise<void> {
  return updateDoc(
    doc(db, "posts", postId, "superComments", superCommentId),
    { hidden: true },
  );
}

export function showSuperComment(postId: string, superCommentId: string): Promise<void> {
  return updateDoc(
    doc(db, "posts", postId, "superComments", superCommentId),
    { hidden: false },
  );
}

export function deleteSuperComment(postId: string, superCommentId: string): Promise<void> {
  return updateDoc(
    doc(db, "posts", postId, "superComments", superCommentId),
    { isDeleted: true },
  );
}

// Marks the super comment as played.
// scheduledAtMs: a client-side future timestamp (Date.now() + LEAD_MS) used by all
// devices to show the overlay simultaneously, regardless of Firestore propagation delay.
export async function playSuperComment(
  postId: string,
  superComment: SuperComment,
): Promise<void> {
  await updateDoc(doc(db, "posts", postId, "superComments", superComment.id), {
    played: true,
    playedAt: serverTimestamp(),
  });
}

export async function pushActiveSuperToViewers(
  postId: string,
  superComment: SuperComment,
  scheduledAtMs?: number,
  /**
   * Frase ya pronunciable, armada por el creador en su idioma y con el importe
   * que el fan pagó. Viaja hecha porque quien la lee —un espectador o el
   * Browser Source de OBS— no tiene ni ese idioma ni esos datos.
   */
  spokenText?: string | null,
  /**
   * Idioma del creador. Viaja hasta `liveOverlays` porque el Browser Source de
   * OBS lee ese documento y no tiene sesión: allí no hay otra forma de saber en
   * qué idioma leer el supercomentario.
   */
  creatorLocale?: string | null,
): Promise<void> {
  const activeSuper: ActiveSuperComment = {
    id: superComment.id,
    userId: superComment.userId,
    username: superComment.username,
    avatarUrl: superComment.avatarUrl,
    text: superComment.text,
    tierName: superComment.tierName,
    color: superComment.color,
    amount: superComment.amount,
    displaySeconds: superComment.displaySeconds,
    spokenText: spokenText ?? null,
    ...(scheduledAtMs !== undefined ? { scheduledAt: scheduledAtMs } : {}),
  };
  await Promise.all([
    updateDoc(doc(db, "posts", postId), {
      "liveData.activeSuper": activeSuper,
      updatedAt: serverTimestamp(),
    }),
    // liveOverlays es legible sin auth — permite el Browser Source de OBS en grupos privados
    // obsReady: null limpia la señal anterior para que el handshake funcione correctamente
    setDoc(doc(db, "liveOverlays", postId), {
      activeSuper,
      creatorLocale: creatorLocale ?? null,
      obsReady: null,
      updatedAt: serverTimestamp(),
    }, { merge: true }),
  ]);
}

export async function clearActiveSuper(postId: string): Promise<void> {
  await Promise.all([
    updateDoc(doc(db, "posts", postId), {
      "liveData.activeSuper": null,
      updatedAt: serverTimestamp(),
    }),
    setDoc(doc(db, "liveOverlays", postId), {
      activeSuper: null,
      updatedAt: serverTimestamp(),
    }, { merge: true }),
  ]);
}

/**
 * Frase que la voz del live lee para un supercomentario o una donación.
 *
 * ⚠️ La donación se lee con lo que el fan PAGÓ, en SU moneda —lo que guarda
 * `presentmentAmount`—, no con `amount`, que es la base del creador. La voz decía
 * "donó 7 pesos" a quien acababa de pagar 148.99 MXN: leía la base en dólares y encima
 * la llamaba pesos.
 *
 * El nombre de la moneda se resuelve con `Intl.DisplayNames`, así que se lee "pesos
 * mexicanos" o "euros" en vez de deletrear el código. Si el navegador no lo soporta, se
 * cae al código, que se entiende aunque suene peor.
 */
export function frasePorVoz(
  sc: {
    username: string;
    text?: string | null;
    amount: number;
    presentmentAmount?: number;
    presentmentCurrency?: string;
  },
  locale: string,
  /**
   * Traductor del grupo `live`, en el idioma DEL CREADOR.
   *
   * Va por parámetro porque esta frase se arma en el lado del creador y se
   * pronuncia con su voz: el idioma de quien escucha no pinta nada aquí.
   */
  t: (key: string, values?: Record<string, string>) => string
): string {
  if (sc.text) return t("spokenSaid", { user: sc.username, text: sc.text });

  const monto = sc.presentmentAmount ?? sc.amount;
  const moneda = sc.presentmentCurrency ?? "USD";
  let nombre = moneda;
  try {
    const dn = new Intl.DisplayNames([locale], { type: "currency" });
    nombre = dn.of(moneda) ?? moneda;
  } catch {
    // Navegador sin DisplayNames: se queda el código.
  }
  const cifra = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(monto);
  return t("donatedTts", { user: sc.username, amount: `${cifra} ${nombre}` });
}
