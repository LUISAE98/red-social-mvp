// Live streaming / VOD — parte del servicio de posts.
//
// Extraído de post-service.ts (que ya solo re-exporta) para reducir el tamaño de
// ese módulo. Estas funciones son wrappers de callables (Mux / Cloudflare Stream)
// y actualizaciones directas del doc del post; no comparten estado con el resto
// del servicio, por eso viven aparte de forma autocontenida.

import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import type { PostPremium } from "./types";

// ─── Live streams (Mux — VOD/RTMP) ───────────────────────────────────────────

export async function callCreateMuxLiveStream(postId: string): Promise<{
  liveStreamId: string;
  playbackId: string | null;
}> {
  const callable = httpsCallable<
    { postId: string },
    { liveStreamId: string; playbackId: string | null }
  >(functions, "createMuxLiveStream");
  const result = await callable({ postId });
  return result.data;
}

// ─── Live streams (Cloudflare Stream — live directo desde browser) ────────────

export async function callCreateCFLiveInput(postId: string): Promise<{
  liveInputId: string;
  hlsUrl: string;
}> {
  const callable = httpsCallable<
    { postId: string },
    { liveInputId: string; hlsUrl: string }
  >(functions, "createCFLiveInput");
  const result = await callable({ postId });
  return result.data;
}

export async function fetchLiveStreamCredentials(postId: string): Promise<{
  streamKey: string;
  ingestUrl: string;
  liveStreamId: string;
} | null> {
  const snap = await getDoc(doc(db, "posts", postId, "liveStream", "credentials"));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    streamKey: data.streamKey ?? "",
    ingestUrl: data.ingestUrl ?? "rtmps://global-live.mux.com:443/app",
    liveStreamId: data.liveStreamId ?? "",
  };
}

export async function saveLiveBroadcastMode(
  postId: string,
  mode: "direct" | "rtmp",
): Promise<void> {
  await updateDoc(doc(db, "posts", postId), {
    "liveData.broadcastMode": mode,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function finalizeVodSettings(
  postId: string,
  opts: {
    keepPinned: boolean;
    vodHidden: boolean;
    vodPaid: boolean;
    vodPrice: number | null;
    vodTitle: string | null;
    vodDescription?: string | null;
  }
): Promise<void> {
  const now = serverTimestamp();

  // El alcance del VOD lo hereda del live: si la transmisión fue "solo miembros"
  // (o vive en una comunidad oculta), su grabación de pago NO se vende fuera —
  // se cobra a los miembros. Si fue para "todos", la grabación sí es pública y
  // hay que marcarla como compartible, o queda en un limbo: premium con alcance
  // público que ninguna regla ni query deja ver desde afuera.
  const snap = await getDoc(doc(db, "posts", postId));
  const postData = (snap.data() ?? {}) as Record<string, unknown>;
  const liveData = (postData.liveData ?? {}) as Record<string, unknown>;

  const isGroupPost = typeof postData.groupId === "string" && postData.groupId.length > 0;
  const membersOnlyScope =
    liveData.visibilityMode === "members_only" || postData.groupVisibility === "hidden";

  const update: Record<string, unknown> = {
    "liveData.vodHidden": opts.vodHidden,
    "liveData.vodPrice": opts.vodPaid ? opts.vodPrice : null,
    "liveData.vodSettingsConfirmed": true,
    updatedAt: now,
  };

  // `isShareable` solo aplica a posts de comunidad (en perfil no lo consumen ni
  // las reglas ni las queries). Un VOD oculto nunca es compartible.
  if (isGroupPost) {
    update.isShareable = !opts.vodHidden && !membersOnlyScope;
  }

  if (!opts.keepPinned || opts.vodHidden) {
    update.isPinnedInGroup = false;
    update.groupPinnedAt = null;
    update.groupPinnedBy = null;
    update.isPinnedOnProfile = false;
    update.profilePinnedAt = null;
    update.profilePinnedBy = null;
  }

  // Always set post text for visible VODs
  if (!opts.vodHidden && opts.vodTitle) {
    const prefix = `EN VIVO - ${opts.vodTitle}`;
    update.text = opts.vodDescription ? `${prefix}\n${opts.vodDescription}` : prefix;
  }

  // El VOD hereda la exención de la transmisión: si el live fue "los miembros no
  // pagan", el miembro que lo vio gratis tampoco paga por la grabación. Sin esto,
  // el beneficio de la membresía se evaporaba en cuanto terminaba el live.
  const membersWatchedFree = liveData.paidAccessMode === "members_free_non_members_pay";

  // Convert to premium video post when creator sets a ticket price
  if (!opts.vodHidden && opts.vodPaid && opts.vodPrice && opts.vodPrice > 0) {
    const premium: PostPremium = {
      enabled: true,
      kind: "video",
      accessMode: membersOnlyScope ? "members_only" : "public",
      freeFor: membersWatchedFree && !membersOnlyScope ? "members_and_subscribers" : "none",
      price: opts.vodPrice,
      currency: "MXN",
      purchaseType: "one_time",
    };
    update.premium = premium;
    update.access = "paid";
    update.accessModel = "one_time_purchase";
    update.requiresPayment = true;
    update.oneTimePrice = opts.vodPrice;
    update.currency = "MXN";
    update.purchaseType = "video";
  } else {
    // Free or hidden VOD: clear any existing premium config
    update.premium = null;
    update.access = "free";
    update.accessModel = "free";
    update.requiresPayment = false;
    update.oneTimePrice = null;
  }

  await updateDoc(doc(db, "posts", postId), update);
}
