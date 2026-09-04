"use client";

import { useEffect, useRef, useState } from "react";

import type { ProfileMini } from "@/components/chat/ConversationList";
import { leerMinisCacheados, traerMinis } from "./profileMiniCache";

/**
 * Perfiles (nombre, avatar, handle) de varios interlocutores, por uid.
 *
 * La caché vive en `profileMiniCache`, compartida con `useProfileMini`. Es
 * SÍNCRONA a propósito: se lee aquí mismo, en el inicializador del estado, para
 * que los avatares salgan puestos en el primer render y no se vea el cambio de
 * iniciales a foto. Ver la explicación completa en ese archivo.
 */
export function useProfileMinis(uids: string[]): Record<string, ProfileMini> {
  // Clave estable: sin esto, un array nuevo en cada render relanzaría la carga.
  const key = uids.slice().sort().join(",");

  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>(() =>
    leerMinisCacheados(key.split(",").filter(Boolean))
  );
  const pedidosRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const todos = key.split(",").filter(Boolean);
    if (todos.length === 0) return;

    // La caché pudo llenarse desde otro componente después del primer render.
    const cacheados = leerMinisCacheados(todos);

    const faltan = todos.filter(
      (uid) => !cacheados[uid] && !pedidosRef.current.has(uid)
    );

    let cancelado = false;

    (async () => {
      // Va dentro de la parte asíncrona: un `setState` síncrono en el cuerpo del
      // efecto encadena un render de más, y el inicializador ya cubrió el caso
      // normal.
      if (Object.keys(cacheados).length > 0) {
        if (cancelado) return;
        setProfiles((prev) => ({ ...cacheados, ...prev }));
      }

      if (faltan.length === 0) return;
      faltan.forEach((uid) => pedidosRef.current.add(uid));

      const deRed = await traerMinis(faltan);
      if (cancelado) return;

      setProfiles((prev) => ({ ...prev, ...deRed }));
    })();

    return () => {
      cancelado = true;
    };
  }, [key]);

  return profiles;
}
