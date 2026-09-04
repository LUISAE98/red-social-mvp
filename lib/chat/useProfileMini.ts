"use client";

import { useEffect, useState } from "react";

import type { ProfileMini } from "@/components/chat/ConversationList";
import {
  leerMinisDeMemoria,
  rescatarMinisDeDisco,
  traerMinis,
} from "./profileMiniCache";

/**
 * Nombre, avatar y handle de un perfil, para la cabecera de un hilo abierto
 * fuera del sidebar (donde no existe el `userMiniMap` ya cargado).
 *
 * Comparte caché con `useProfileMinis` (ver `profileMiniCache`), así que entrar
 * a un hilo desde la bandeja ya no vuelve a leer el mismo perfil: viene resuelto
 * de la lista que acabas de ver.
 */
export function useProfileMini(uid: string | null) {
  const [state, setState] = useState<{
    profile: ProfileMini | undefined;
    loading: boolean;
  }>(() => {
    const enMemoria = uid ? leerMinisDeMemoria([uid])[uid] : undefined;
    // Con el perfil ya en memoria no hay nada que esperar: se pinta la cabecera
    // en el primer render, sin pasar por el estado de carga.
    return { profile: enMemoria, loading: !enMemoria };
  });

  useEffect(() => {
    if (!uid) return;

    let cancelado = false;

    (async () => {
      // La memoria se consulta DENTRO de la parte asíncrona, no en el cuerpo del
      // efecto: un `setState` síncrono ahí encadena un render de más, y aquí no
      // hace falta — el inicializador perezoso ya cubrió el caso normal. Esta
      // rama solo cubre el cambio de `uid` sin desmontar.
      const enMemoria = leerMinisDeMemoria([uid])[uid];
      if (enMemoria) {
        if (!cancelado) setState({ profile: enMemoria, loading: false });
        return;
      }

      const deDisco = (await rescatarMinisDeDisco([uid]))[uid];
      if (cancelado) return;

      if (deDisco) {
        setState({ profile: deDisco, loading: false });
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
