"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";

/**
 * URLs firmadas de las imágenes de un hilo.
 *
 * Las imágenes de DM no tienen URL pública: `storage.rules` cierra la lectura y
 * solo la Cloud Function `getDirectMessageImageUrls` las firma, tras comprobar
 * en Firestore que quien pide es participante. Eso hace que bloquear o borrar
 * corte el acceso de verdad, en cuanto caduca la URL.
 *
 * Se piden TODAS las rutas visibles en una sola llamada; un hilo con 20
 * imágenes hace una llamada, no veinte.
 */

type SignedUrlsResponse = {
  urls: Record<string, string>;
  expiresAt: number;
};

/**
 * Caché por proceso: evita volver a firmar lo ya firmado al re-renderizar o al
 * pasar de la pestaña de laptop a la página de celular.
 */
const cache = new Map<string, { url: string; expiresAt: number }>();

/** Margen para no servir una URL que caduca mientras se está pintando. */
const REFRESH_MARGIN_MS = 60 * 1000;

/** Solo lee: no borra nada, para poder llamarse durante el render. */
function cached(path: string): string | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (hit.expiresAt - REFRESH_MARGIN_MS <= Date.now()) return null;
  return hit.url;
}

export function useDmImageUrls(
  conversationId: string | null,
  paths: string[]
): Record<string, string> {
  const [fetched, setFetched] = useState<Record<string, string>>({});

  // Clave estable: sin esto, un array nuevo en cada render relanzaría la llamada.
  const key = paths.slice().sort().join("|");

  // Lo que ya está en caché se DERIVA en el render, no se mete en el estado:
  // meterlo obligaría a un setState dentro del efecto y a un render de más.
  const fromCache = useMemo(() => {
    const out: Record<string, string> = {};
    for (const path of key.split("|").filter(Boolean)) {
      const hit = cached(path);
      if (hit) out[path] = hit;
    }
    return out;
  }, [key]);

  useEffect(() => {
    if (!conversationId || !key) return;

    const missing = key.split("|").filter((path) => path && !cached(path));
    if (missing.length === 0) return;

    let cancelled = false;

    const call = httpsCallable<
      { conversationId: string; paths: string[] },
      SignedUrlsResponse
    >(functions, "getDirectMessageImageUrls");

    call({ conversationId, paths: missing })
      .then(({ data }) => {
        for (const [path, url] of Object.entries(data.urls)) {
          cache.set(path, { url, expiresAt: data.expiresAt });
        }
        if (!cancelled) setFetched((prev) => ({ ...prev, ...data.urls }));
      })
      .catch((error) => {
        captureError(error, { scope: "chat", code: "dm_image_sign_failed" });
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, key]);

  return useMemo(() => ({ ...fromCache, ...fetched }), [fromCache, fetched]);
}
