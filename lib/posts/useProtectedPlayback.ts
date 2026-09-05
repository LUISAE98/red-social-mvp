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
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
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
  /**
   * "signed" = el asset de Mux está en playback firmado: el playbackId por sí
   * solo no reproduce, hay que pedir un permiso temporal al backend.
   */
  playbackPolicy?: "signed" | null;
};

type SignedEntry = { playbackId: string; hlsUrl: string; thumbnailUrl: string };
type SignedPlaybackResponse = {
  postId: string;
  expiresInSeconds: number;
  signed: Record<string, SignedEntry>;
};

/**
 * Permisos de reproducción ya pedidos, por publicación.
 *
 * 🚨 Medido en Sentry (30 días): `getMuxPlaybackToken` se llamó **145 veces**
 * con una mediana de **287 ms** y un p95 de **3,3 s**, unos 87 segundos en
 * total. No tenía caché, así que volver a un video ya visto —o pasar dos veces
 * por el mismo post en el feed— lo pedía otra vez entero.
 *
 * Quien manda sobre la caducidad es el SERVIDOR, no un TTL nuestro: la respuesta
 * trae `expiresInSeconds` y se respeta tal cual, con un minuto de margen para no
 * entregar un permiso que caduca mientras el video arranca. Eso mantiene intacto
 * el control de acceso — un permiso cacheado no vive ni un segundo más de lo que
 * el backend decidió que valiera.
 *
 * En memoria y no en disco a propósito: son permisos de contenido de pago y
 * duran minutos; guardarlos entre sesiones no aporta y ensucia el almacenamiento
 * con credenciales caducadas.
 */
const MARGEN_CADUCIDAD_MS = 60_000;
const permisos = new Map<string, { valor: ProtectedPlayback; caducaEn: number }>();
const permisosEnVuelo = new Map<string, Promise<ProtectedPlayback | null>>();

/**
 * Pide al backend los permisos temporales de reproducción. Solo se llama cuando
 * el subdocumento protegido dice que el asset está firmado.
 */
async function fetchSignedPlayback(postId: string): Promise<ProtectedPlayback | null> {
  const guardado = permisos.get(postId);
  if (guardado && guardado.caducaEn > Date.now()) return guardado.valor;

  // Varios reproductores del mismo post pueden pedirlo a la vez; se cuelgan de
  // la misma petición en vez de abrir una cada uno.
  const enVuelo = permisosEnVuelo.get(postId);
  if (enVuelo) return enVuelo;

  const peticion = pedirPermisoDeReproduccion(postId).finally(() => {
    permisosEnVuelo.delete(postId);
  });

  permisosEnVuelo.set(postId, peticion);
  return peticion;
}

async function pedirPermisoDeReproduccion(
  postId: string
): Promise<ProtectedPlayback | null> {
  const call = httpsCallable<{ postId: string }, SignedPlaybackResponse>(
    functions,
    "getMuxPlaybackToken"
  );

  const { data } = await call({ postId });
  if (!data?.signed) return null;

  const result: ProtectedPlayback = { playbackPolicy: "signed" };
  const media: Record<string, PlayableFields> = {};

  for (const [key, entry] of Object.entries(data.signed)) {
    const fields: PlayableFields = {
      playbackId: entry.playbackId,
      url: entry.hlsUrl,
      hlsUrl: entry.hlsUrl,
    };

    if (key === "playback") result.playback = fields;
    else if (key === "videoData") result.videoData = fields;
    else if (key.startsWith("media:")) media[key.slice("media:".length)] = fields;
  }

  if (Object.keys(media).length > 0) result.media = media;

  // El servidor dice cuánto vale; si no lo dijera, no se guarda nada — mejor
  // repetir la llamada que inventarse una caducidad para una credencial.
  const vigenciaMs = (data.expiresInSeconds ?? 0) * 1000;
  if (vigenciaMs > MARGEN_CADUCIDAD_MS) {
    permisos.set(postId, {
      valor: result,
      caducaEn: Date.now() + vigenciaMs - MARGEN_CADUCIDAD_MS,
    });
  }

  return result;
}

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
/**
 * `undefined` = todavía cargando (quien lo consuma debe ESPERAR antes de decidir
 * que no hay video); `null` = resuelto y sin datos (no aplica o sin acceso).
 */
export function useProtectedPlayback(
  postId: string,
  enabled: boolean
): ProtectedPlayback | null | undefined {
  // El resultado se guarda junto a la clave que lo produjo: así "pendiente" se
  // DERIVA (clave activa ≠ clave del resultado) en vez de escribirse en estado
  // dentro del efecto, que dispararía renders en cascada.
  const key = enabled && postId ? postId : "";
  const [result, setResult] = useState<{
    key: string;
    value: ProtectedPlayback | null;
  } | null>(null);

  useEffect(() => {
    if (!key) return;

    let cancelled = false;

    getDoc(doc(db, "posts", key, "protectedPlayback", "current"))
      .then(async (snap) => {
        if (cancelled) return;
        const value = snap.exists() ? (snap.data() as ProtectedPlayback) : null;

        // Asset en playback firmado: el playbackId no basta, hay que pedir el
        // permiso temporal. Si esa llamada falla, se queda bloqueado (correcto).
        if (value?.playbackPolicy === "signed") {
          const signed = await fetchSignedPlayback(key).catch(() => null);
          if (!cancelled) setResult({ key, value: signed });
          return;
        }

        setResult({ key, value });
      })
      // Sin acceso (o post sin blindaje) → se queda bloqueado, que es lo correcto.
      .catch(() => {
        if (!cancelled) setResult({ key, value: null });
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return null;
  return result?.key === key ? result.value : undefined;
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
  protectedPlayback: ProtectedPlayback | null | undefined
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
