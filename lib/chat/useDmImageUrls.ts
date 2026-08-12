"use client";

import { useEffect, useMemo, useState } from "react";
import { getBlob, ref } from "firebase/storage";

import { storage } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";

/**
 * Imágenes de un hilo de DM, listas para pintar.
 *
 * Las imágenes de DM NO son públicas: `storage.rules` solo deja leerlas a los
 * dos participantes del hilo, y eso se comprueba contra la propia ruta — el ID
 * de la conversación son sus dos UIDs unidos por "_".
 *
 * Aquí se descargan los bytes CON LA SESIÓN de quien mira y se envuelven en una
 * URL de objeto local. Ventaja sobre servir una URL: no existe ningún enlace que
 * se pueda copiar y pasar a un tercero, y en cuanto alguien deja de tener
 * permiso deja de poder leerlas — no hay ventana de caducidad que esperar.
 *
 * (Antes esto pedía URLs firmadas a la Cloud Function `getDirectMessageImageUrls`.
 * Firmar en Google Cloud exige un permiso de IAM que el proyecto no tiene
 * concedido, así que fallaba siempre y las imágenes nunca se veían.)
 */

/**
 * Caché por proceso: ruta → URL de objeto.
 *
 * No se revocan. Una URL de objeto revocada rompe cualquier `<img>` que aún la
 * esté usando, y en un chat la misma imagen se vuelve a pintar constantemente al
 * scrollear. Se sueltan solas al recargar, y lo que ocupan es el número de
 * imágenes que hayas mirado en esta sesión.
 */
const cache = new Map<string, string>();

export function useDmImageUrls(
  conversationId: string | null,
  paths: string[]
): Record<string, string> {
  const [fetched, setFetched] = useState<Record<string, string>>({});

  // Clave estable: sin esto, un array nuevo en cada render relanzaría la descarga.
  const key = paths.slice().sort().join("|");

  // Lo ya descargado se DERIVA en el render, no se mete en el estado: meterlo
  // obligaría a un setState dentro del efecto y a un render de más.
  const fromCache = useMemo(() => {
    const out: Record<string, string> = {};
    for (const path of key.split("|").filter(Boolean)) {
      const hit = cache.get(path);
      if (hit) out[path] = hit;
    }
    return out;
  }, [key]);

  useEffect(() => {
    if (!conversationId || !key) return;

    const missing = key.split("|").filter((path) => path && !cache.has(path));
    if (missing.length === 0) return;

    let cancelled = false;

    void Promise.all(
      missing.map(async (path): Promise<[string, string] | null> => {
        try {
          const blob = await getBlob(ref(storage, path));
          return [path, URL.createObjectURL(blob)];
        } catch (error) {
          // Una imagen borrada o sin permiso no debe tumbar al resto del hilo.
          captureError(error, { scope: "chat", code: "dm_image_read_failed" });
          return null;
        }
      })
    ).then((results) => {
      const next: Record<string, string> = {};
      for (const result of results) {
        if (!result) continue;
        cache.set(result[0], result[1]);
        next[result[0]] = result[1];
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setFetched((prev) => ({ ...prev, ...next }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [conversationId, key]);

  return useMemo(() => ({ ...fromCache, ...fetched }), [fromCache, fetched]);
}
