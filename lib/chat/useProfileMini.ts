"use client";

import { useEffect, useState } from "react";

import type { ProfileMini } from "@/components/chat/ConversationList";
import { leerMinisCacheados, traerMinis } from "./profileMiniCache";

/**
 * Nombre, avatar y handle de un perfil, para la cabecera de un hilo abierto
 * fuera del sidebar (donde no existe el `userMiniMap` ya cargado).
 *
 * Comparte caché con `useProfileMinis` (ver `profileMiniCache`), así que entrar
 * a un hilo desde la bandeja ya no vuelve a leer el mismo perfil: viene resuelto
 * de la lista que acabas de ver, y la cabecera sale con foto desde el primer
 * render en vez de enseñar las iniciales un instante.
 */
export function useProfileMini(uid: string | null) {
  const [state, setState] = useState<{
    profile: ProfileMini | undefined;
    loading: boolean;
  }>(() => {
    const cacheado = uid ? leerMinisCacheados([uid])[uid] : undefined;
    // Con el perfil ya cacheado no hay nada que esperar: se pinta la cabecera en
    // el primer render, sin pasar por el estado de carga.
    return { profile: cacheado, loading: !cacheado };
  });

  useEffect(() => {
    if (!uid) return;

    let cancelado = false;

    (async () => {
      // La caché se consulta DENTRO de la parte asíncrona: un `setState`
      // síncrono en el cuerpo del efecto encadena un render de más, y aquí no
      // hace falta — el inicializador ya cubrió el caso normal. Esta rama solo
      // cubre el cambio de `uid` sin desmontar.
      const cacheado = leerMinisCacheados([uid])[uid];
      if (cacheado) {
        if (!cancelado) setState({ profile: cacheado, loading: false });
        return;
      }

      const deRed = (await traerMinis([uid]))[uid];
      if (cancelado) return;

      setState({ profile: deRed, loading: false });
    })();

    return () => {
      cancelado = true;
    };
  }, [uid]);

  // Derivado en vez de reseteado dentro del efecto: sin uid no hay perfil, y así
  // no queda visible el sobrante de un uid anterior.
  return {
    profile: uid ? state.profile : undefined,
    loading: uid ? state.loading : false,
  };
}
