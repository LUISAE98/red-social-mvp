"use client";

// Precarga de los videos de las experiencias del login.
//
// Los primeros (los que se ven al abrir) se descargan ENTEROS antes de que el
// splash de arranque se quite, y el resto en cuanto la página ya está a la
// vista. Se guardan en memoria y el <video> reproduce desde ahí, así que al
// llegar a su tarjeta no hay descarga en curso compitiendo con la
// reproducción, que es de donde salían los tirones.

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Tope de espera de la descarga. Una descarga colgada no puede dejar la puerta
 * cerrada.
 */
const ESPERA_MAX_MS = 6000;

/**
 * Tope de TODO el proceso, incluida la espera del `load` de la página. Sin él,
 * un recurso atorado (una imagen que nunca termina) dejaría el splash puesto.
 * Va por debajo del tope de seguridad del propio splash, para que el que mande
 * sea este y no el otro.
 */
const TOPE_TOTAL_MS = 7000;

function usePaginaCargada(): boolean {
  const [cargada, setCargada] = useState(false);
  useEffect(() => {
    const onLoad = () => setCargada(true);
    if (document.readyState === "complete") {
      // Ya había terminado antes de montar: se avisa en el siguiente cuadro.
      const id = requestAnimationFrame(onLoad);
      return () => cancelAnimationFrame(id);
    }
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return cargada;
}

/**
 * @param sources Rutas de los videos, en orden de aparición. DEBE ser una
 *   constante estable (definida fuera del componente), no un literal por render.
 * @param bloqueantes Cuántos se esperan antes de abrir la página.
 */
export function useExperienceVideos(sources: readonly string[], bloqueantes: number) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [videosListos, setVideosListos] = useState(false);
  const [seAgotoElTiempo, setSeAgotoElTiempo] = useState(false);
  const creadas = useRef<string[]>([]);
  const paginaCargada = usePaginaCargada();

  useEffect(() => {
    const id = setTimeout(() => setSeAgotoElTiempo(true), TOPE_TOTAL_MS);
    return () => clearTimeout(id);
  }, []);

  // Hoy varias tarjetas comparten archivo mientras faltan los definitivos; sin
  // esto se descargaría el mismo cinco veces.
  const unicos = useMemo(() => Array.from(new Set(sources)), [sources]);

  useEffect(() => {
    let cancelado = false;

    const descargar = async (lista: string[]) => {
      const pares = await Promise.all(
        lista.map(async (src) => {
          try {
            const res = await fetch(src);
            if (!res.ok) return [src, ""] as const;
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            creadas.current.push(url);
            return [src, url] as const;
          } catch {
            // Si falla, la tarjeta usa la ruta normal y el navegador se encarga.
            return [src, ""] as const;
          }
        }),
      );
      if (cancelado) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const [src, url] of pares) if (url) next[src] = url;
        return next;
      });
    };

    void (async () => {
      const espera = new Promise<void>((r) => setTimeout(r, ESPERA_MAX_MS));
      await Promise.race([descargar(unicos.slice(0, bloqueantes)), espera]);
      if (cancelado) return;
      setVideosListos(true);
      void descargar(unicos.slice(bloqueantes));
    })();

    return () => {
      cancelado = true;
    };
  }, [unicos, bloqueantes]);

  // Se liberan al salir del login; si no, los blobs quedan ocupando memoria.
  useEffect(() => {
    const urlsCreadas = creadas;
    return () => {
      urlsCreadas.current.forEach((u) => URL.revokeObjectURL(u));
      urlsCreadas.current = [];
    };
  }, []);

  return {
    /** La página puede mostrarse: está cargada y los primeros videos también. */
    listo: (paginaCargada && videosListos) || seAgotoElTiempo,
    /** Devuelve la copia en memoria si ya existe, o la ruta normal si no. */
    fuente: (src: string) => urls[src] ?? src,
  };
}
