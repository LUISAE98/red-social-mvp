"use client";

// Lado cliente del blindaje de contenido de PAGO (ver
// `backend/src/protectedPlayback.ts`).
//
// En un post de pago, el documento del post ya NO trae playbackId ni URL HLS:
// esos campos viven en `posts/{postId}/protectedPlayback/current`, cerrado por
// reglas a quien tiene derecho (autor, moderación, comprador con `postAccess`
// activo, o miembro cuando el premium es `freeFor: members_and_subscribers`).
//
// Este hook lee ese subdocumento y `mergeProtectedPlayback` lo vuelve a inyectar
// en el post, de forma que TODO lo que ya consumía `post.playback` /
// `post.videoData` / `post.media[]` / `post.liveData` sigue funcionando igual
// para quien sí pagó, sin tocar los reproductores.

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Post, PostMedia } from "./types";

type PlayableFields = {
  url?: string | null;
  hlsUrl?: string | null;
  playbackId?: string | null;
  assetId?: string | null;
  mp4Url?: string | null;
  vodUrl?: string | null;
};

export type ProtectedPlayback = {
  playback?: PlayableFields;
  videoData?: PlayableFields;
  liveData?: PlayableFields;
  /** Clave: id del media, o `index_{n}` si el item no tenía id. */
  media?: Record<string, PlayableFields>;
};

/** Un post está paywalled si cobra acceso (premium de post o boleto de live/VOD). */
export function isPaywalledPost(post: Pick<Post, "requiresPayment" | "premium">): boolean {
  return post.requiresPayment === true || post.premium?.enabled === true;
}

/**
 * Trae las coordenadas reproducibles protegidas. `enabled` debe ser true solo
 * cuando el viewer tiene motivos para tener acceso (compró, es miembro con
 * acceso gratis, es el autor o modera): así no se disparan lecturas que las
 * reglas van a rechazar.
 */
export function useProtectedPlayback(
  postId: string,
  enabled: boolean
): ProtectedPlayback | null {
  const [data, setData] = useState<ProtectedPlayback | null>(null);

  useEffect(() => {
    if (!enabled || !postId) {
      setData(null);
      return;
    }

    let cancelled = false;

    getDoc(doc(db, "posts", postId, "protectedPlayback", "current"))
      .then((snap) => {
        if (cancelled) return;
        setData(snap.exists() ? (snap.data() as ProtectedPlayback) : null);
      })
      // Sin acceso (o post sin blindaje) → se queda bloqueado, que es lo correcto.
      .catch(() => {
        if (!cancelled) setData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [postId, enabled]);

  return data;
}

/** Solo se inyectan valores REALES: nunca se pisa el post con nulls. */
function definedFields(fields: PlayableFields | undefined): PlayableFields {
  if (!fields) return {};
  const out: PlayableFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim()) {
      out[key as keyof PlayableFields] = value;
    }
  }
  return out;
}

function mergeFields<T extends object>(
  target: T | null | undefined,
  fields: PlayableFields | undefined
): T | null | undefined {
  const clean = definedFields(fields);
  if (Object.keys(clean).length === 0) return target;
  return { ...((target ?? {}) as T), ...clean };
}

/**
 * Re-inyecta en el post lo que devolvió `useProtectedPlayback`. Si no hay nada
 * que inyectar devuelve el MISMO objeto (identidad estable → sin renders extra).
 */
export function mergeProtectedPlayback<T extends Post>(
  post: T,
  protectedPlayback: ProtectedPlayback | null
): T {
  if (!protectedPlayback) return post;

  const next: T = { ...post };
  let touched = false;

  if (protectedPlayback.playback) {
    next.playback = mergeFields(post.playback, protectedPlayback.playback) as Post["playback"];
    touched = true;
  }

  if (protectedPlayback.videoData) {
    next.videoData = mergeFields(post.videoData, protectedPlayback.videoData) as Post["videoData"];
    touched = true;
  }

  if (protectedPlayback.liveData) {
    next.liveData = mergeFields(post.liveData, protectedPlayback.liveData) as Post["liveData"];
    touched = true;
  }

  const mediaSecrets = protectedPlayback.media;
  if (mediaSecrets && Array.isArray(post.media)) {
    next.media = post.media.map((item, index) => {
      const key = item?.id ?? `index_${index}`;
      const clean = definedFields(mediaSecrets[key]);
      if (Object.keys(clean).length === 0) return item;
      touched = true;
      return { ...item, ...clean } as PostMedia;
    });
  }

  return touched ? next : post;
}
