"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";

import { functions } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";
import { guardarEnCache, leerDeCache } from "@/lib/cache/persistentCache";

/**
 * URLs firmadas de las imágenes de un hilo.
 *
 * Las imágenes de DM no tienen URL pública: `storage.rules` cierra la lectura y
 * solo la Cloud Function `getDirectMessageImageUrls` las firma, tras comprobar
 * en Firestore que quien pide es participante. Eso hace que bloquear o borrar
 * corte el acceso de verdad, en cuanto caduca la URL.
 *
 * Se piden TODAS las rutas visibles en una sola llamada; un hilo con 20
 * imágenes hace una llamada, no veinte. Y los bytes los sirve Google directo:
 * por la función solo pasa el texto de las URLs.
 *
 * ⚠️ DEPENDE DE UN PERMISO DE IAM. Firmar desde una Cloud Function no usa una
 * llave local: le pide a Google que firme por ella, y eso exige que la cuenta de
 * servicio del runtime tenga `roles/iam.serviceAccountTokenCreator` SOBRE SÍ
 * MISMA, más la API `iamcredentials.googleapis.com` encendida. Sin eso, la
 * función responde sin ninguna URL y las imágenes no se ven nunca (el error en
 * los logs es `SigningError`). Concedido el 2026-08-12; si algún día se
 * restaura el proyecto o se cambia la cuenta de servicio, hay que rehacerlo.
 */

type SignedUrlsResponse = {
  urls: Record<string, string>;
  expiresAt: number;
};

/**
 * Caché por proceso: evita volver a firmar lo ya firmado al re-renderizar o al
 * pasar de la pestaña de laptop a la página de celular.
 */
type FirmaGuardada = { url: string; expiresAt: number };

const cache = new Map<string, FirmaGuardada>();

function claveFirmas(conversationId: string): string {
  return `chat:firmas:${conversationId}`;
}

/**
 * Techo de edad del REGISTRO en disco. Es holgado a propósito: quien decide de
 * verdad si una URL sirve es su propio `expiresAt`, comprobado al volcarla.
 */
const TTL_FIRMAS_MS = 24 * 60 * 60 * 1000;

/** Margen para no servir una URL que caduca mientras se está pintando. */
const REFRESH_MARGIN_MS = 60 * 1000;

/** Solo lee: no borra nada, para poder llamarse durante el render. */
function cached(path: string): string | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (hit.expiresAt - REFRESH_MARGIN_MS <= Date.now()) return null;
  return hit.url;
}

export type DmImageUrls = {
  urls: Record<string, string>;
  /**
   * Rutas que se pidieron y NO volvieron con URL.
   *
   * ⚠️ Existe para que "todavía no ha llegado" y "no va a llegar" dejen de ser
   * la misma cosa. Sin esto, quien pinta la imagen no tiene forma de saber cuál
   * de las dos es y se queda enseñando un esqueleto para siempre.
   *
   * Una ruta cae aquí por dos motivos que se ven igual desde fuera: la llamada
   * falló entera —red, cuota, función caída— o la función respondió sin ella,
   * que es lo que pasa cuando el mensaje se borró o ya no se tiene acceso.
   */
  failed: ReadonlySet<string>;
  /** Reintenta las que fallaron. Lo dispara la persona, nunca solo. */
  retry: () => void;
};

export function useDmImageUrls(
  conversationId: string | null,
  paths: string[]
): DmImageUrls {
  const [fetched, setFetched] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  /** Sube al reintentar; es lo que vuelve a lanzar el efecto. */
  const [intento, setIntento] = useState(0);
  /**
   * Sube cuando el disco terminó de volcarse en la caché de memoria. Sirve
   * para dos cosas: forzar un render que ya vea esas URLs, y no lanzar la firma
   * antes de haber mirado lo que ya estaba guardado.
   */
  const [hidratado, setHidratado] = useState(0);

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

  // Vuelca en la caché de memoria lo firmado en visitas anteriores. Un solo
  // registro por conversación: leer ruta por ruta serían N lecturas de disco
  // para pintar una sola pantalla de mensajes.
  useEffect(() => {
    if (!conversationId) return;

    let cancelado = false;

    (async () => {
      const guardado = await leerDeCache<Record<string, FirmaGuardada>>(
        claveFirmas(conversationId),
        TTL_FIRMAS_MS
      );

      if (cancelado || !guardado) {
        if (!cancelado) setHidratado((n) => n + 1);
        return;
      }

      for (const [path, firma] of Object.entries(guardado)) {
        // El `expiresAt` de cada URL manda sobre la edad del registro: una firma
        // caducada no sirve aunque el registro sea de hace un minuto.
        if (firma.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
          cache.set(path, firma);
        }
      }

      setHidratado((n) => n + 1);
    })();

    return () => {
      cancelado = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !key) return;
    // Esperar al disco: sin esto se firmaría de nuevo lo que ya estaba guardado.
    if (hidratado === 0) return;

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

        // Se guarda la conversación entera, no solo lo recién firmado: así el
        // registro de disco queda completo para la próxima visita.
        const paraDisco: Record<string, FirmaGuardada> = {};
        for (const [path, firma] of cache.entries()) {
          if (firma.expiresAt > Date.now()) paraDisco[path] = firma;
        }
        void guardarEnCache(claveFirmas(conversationId), paraDisco);
        if (cancelled) return;
        setFetched((prev) => ({ ...prev, ...data.urls }));

        // Lo que se pidió y no volvió no va a volver solo: la función ya
        // respondió. Marcarlo es lo que permite enseñar un error en vez de un
        // esqueleto eterno.
        const sinUrl = missing.filter((path) => !(path in data.urls));
        if (sinUrl.length > 0) {
          setFailed((prev) => new Set([...prev, ...sinUrl]));
        }
      })
      .catch((error) => {
        captureError(error, { scope: "chat", code: "dm_image_sign_failed" });
        // Si la llamada se cae, fallan TODAS las que iban en ella.
        if (!cancelled) setFailed((prev) => new Set([...prev, ...missing]));
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, key, intento, hidratado]);

  const retry = useCallback(() => {
    // Se limpian las fallidas ANTES de subir el intento: si se dejaran puestas,
    // la imagen seguiría en estado de error mientras se reintenta y no habría
    // forma de ver que está pasando algo.
    setFailed(new Set());
    setIntento((n) => n + 1);
  }, []);

  const urls = useMemo(() => ({ ...fromCache, ...fetched }), [fromCache, fetched]);

  return useMemo(() => ({ urls, failed, retry }), [urls, failed, retry]);
}
