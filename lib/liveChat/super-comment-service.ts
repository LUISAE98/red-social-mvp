import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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
    currency: "MXN",
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
      currency: "MXN",
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
  scheduledAtMs?: number,
): Promise<void> {
  await updateDoc(doc(db, "posts", postId, "superComments", superComment.id), {
    played: true,
    playedAt: serverTimestamp(),
    ...(scheduledAtMs !== undefined ? { scheduledAt: Timestamp.fromMillis(scheduledAtMs) } : {}),
  });
}

// Pushes the overlay to viewers via liveData.activeSuper.
// Call this AFTER the stream delay so viewers see it in sync with the video.
export async function pushActiveSuperToViewers(
  postId: string,
  superComment: SuperComment,
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
  };
  await updateDoc(doc(db, "posts", postId), {
    "liveData.activeSuper": activeSuper,
    updatedAt: serverTimestamp(),
  });
}

export function clearActiveSuper(postId: string): Promise<void> {
  return updateDoc(doc(db, "posts", postId), {
    "liveData.activeSuper": null,
    updatedAt: serverTimestamp(),
  });
}
