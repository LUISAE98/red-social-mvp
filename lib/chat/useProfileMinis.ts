"use client";

import { useEffect, useRef, useState } from "react";

import type { ProfileMini } from "@/components/chat/ConversationList";
import {
  leerMinisDeMemoria,
  rescatarMinisDeDisco,
  traerMinis,
} from "./profileMiniCache";

/**
 * Perfiles (nombre, avatar, handle) de varios interlocutores, por uid.
 *
 * La caché ya no vive aquí: está en `profileMiniCache`, compartida con
 * `useProfileMini` y con dos pisos (memoria y disco). Antes era local al
 * componente, así que salir de la bandeja y volver releía a todo el mundo.
 *
 * El orden es el de siempre: lo que ya está en memoria se pinta en el primer
 * render, lo del disco en cuanto llega, y solo se va a la red por lo que falte.
 */
export function useProfileMinis(uids: string[]): Record<string, ProfileMini> {
  // Clave estable: sin esto, un array nuevo en cada render relanzaría la carga.
  const key = uids.slice().sort().join(",");

  const [profiles, setProfiles] = useState<Record<string, ProfileMini>>(() =>
    leerMinisDeMemoria(key.split(",").filter(Boolean))
  );
  const pedidosRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const todos = key.split(",").filter(Boolean);
    if (todos.length === 0) return;

    let cancelado = false;

    (async () => {
      // Todo esto va DENTRO de la parte asíncrona: un `setState` síncrono en el
      // cuerpo del efecto encadena un render de más, y aquí no hace falta — el
      // inicializador perezoso ya sirvió lo que había en memoria al montar.
      // Esta relectura solo cubre que otro componente la haya llenado entretanto.
      const deMemoria = leerMinisDeMemoria(todos);
      if (cancelado) return;

      if (Object.keys(deMemoria).length > 0) {
        setProfiles((prev) => ({ ...deMemoria, ...prev }));
      }

      const faltan = todos.filter(
        (uid) => !deMemoria[uid] && !pedidosRef.current.has(uid)
      );
      if (faltan.length === 0) return;

      faltan.forEach((uid) => pedidosRef.current.add(uid));

      const deDisco = await rescatarMinisDeDisco(faltan);
      if (cancelado) return;

      if (Object.keys(deDisco).length > 0) {
        setProfiles((prev) => ({ ...prev, ...deDisco }));
      }

      const sinResolver = faltan.filter((uid) => !deDisco[uid]);
      if (sinResolver.length === 0) return;

      const deRed = await traerMinis(sinResolver);
      if (cancelado) return;

      setProfiles((prev) => ({ ...prev, ...deRed }));
    })();

    return () => {
      cancelado = true;
    };
  }, [key]);

  return profiles;
}
