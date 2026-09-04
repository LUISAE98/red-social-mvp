"use client";

/**
 * Señales que deciden el ORDEN de los rails del OwnerSidebar: quién está en vivo
 * y quién tiene historias sin ver.
 *
 * Las otras dos señales del orden ya existían y no pasan por aquí: los posts
 * nuevos vienen de `useNewPostsCounts` y las visitas de `useSidebarVisitCounts`.
 *
 * Coste: las historias se resuelven con los suscriptores POR LOTE del servicio
 * (`in` de 30 en 30, uno o dos listeners para toda la lista).
 *
 * El live vive en un campo del documento de cada entidad, y ahí el coste ya no
 * es el mismo en los dos lados:
 *
 *   · PERFILES — una sola consulta por lote. La regla de `/users/{uid}` es
 *     `get, list: if true`, así que agrupar no cuesta nada y las treinta
 *     escuchas del rail se quedan en una.
 *   · COMUNIDADES — sigue habiendo una escucha por entidad, a propósito. La
 *     regla `list` de `/groups` termina en comprobaciones con `get()`, y por
 *     lote una comunidad oculta basta para pasarse del límite y tumbar la
 *     consulta entera. Está explicado en detalle dentro del efecto.
 *
 * En ambos casos son los MISMOS documentos que cada tarjeta ya escucha al pintar
 * su aro, así que en estado estacionario esto no añade lecturas nuevas; solo las
 * adelanta para poder ordenar antes de pintar.
 */

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  documentId,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import {
  subscribeToStoriesFromCreators,
  subscribeToStoriesFromGroups,
} from "@/lib/stories/storyService";

export type RailSignals = {
  /** Entidades con transmisión en vivo ahora mismo. */
  liveIds: Set<string>;
  /** Entidades con al menos una historia vigente. */
  storyIds: Set<string>;
};

const EMPTY: RailSignals = { liveIds: new Set(), storyIds: new Set() };

export function useRailSignals(
  ids: string[],
  entityType: "profile" | "group"
): RailSignals {
  const [liveIds, setLiveIds] = useState<Set<string>>(() => new Set());
  const [storyIds, setStoryIds] = useState<Set<string>>(() => new Set());

  // Clave estable: sin esto, un array nuevo en cada render re-suscribiría todo
  // en bucle.
  const idsKey = useMemo(() => [...ids].sort().join(","), [ids]);

  useEffect(() => {
    const list = idsKey ? idsKey.split(",") : [];
    if (list.length === 0) return;

    const esVivo = (raw: unknown) => typeof raw === "string" && raw.length > 0;

    /**
     * PERFILES: una sola consulta por lote en vez de treinta escuchas.
     *
     * El rail está topado a 30 seguidos (OWNER_SIDEBAR_FOLLOWING_LIMIT), y el
     * `in` de Firestore admite justo 30, así que esto es UNA escucha para toda
     * la tira. Es seguro porque la regla de `/users/{uid}` es `get, list: if
     * true`: no mira ningún campo y no hace ni una llamada a `get()`.
     */
    if (entityType === "profile") {
      const unsubs: Array<() => void> = [];
      const porLote = new Map<number, Set<string>>();

      const publicar = () => {
        const union = new Set<string>();
        for (const lote of porLote.values()) for (const id of lote) union.add(id);
        setLiveIds(union);
      };

      for (let i = 0; i < list.length; i += 30) {
        const lote = list.slice(i, i + 30);
        const indice = i;

        unsubs.push(
          onSnapshot(
            query(collection(db, "users"), where(documentId(), "in", lote)),
            (snap) => {
              const vivos = new Set<string>();
              snap.forEach((d) => {
                if (esVivo(d.data()?.activeLivePostId)) vivos.add(d.id);
              });
              porLote.set(indice, vivos);
              publicar();
            },
            () => {
              // Sin permiso: simplemente no se ordena por live.
              porLote.set(indice, new Set());
              publicar();
            }
          )
        );
      }

      return () => unsubs.forEach((unsub) => unsub());
    }

    /**
     * COMUNIDADES: aquí NO se agrupa, y es deliberado.
     *
     * La regla `list` de `/groups/{groupId}` termina en `isMember()`,
     * `isOwner()`, `isModerator()` e `isPlatformMod()`, que hacen llamadas a
     * `get()`. Con una consulta por lote, una sola comunidad oculta en la tira
     * hace caer la evaluación hasta esas funciones y el gasto de `get()` se
     * multiplica por el tamaño del lote hasta pasarse del límite — y entonces
     * Firestore niega la consulta ENTERA, no solo esa comunidad. Es un fallo que
     * este repositorio ya se comió una vez.
     *
     * Una escucha por documento pasa por la regla `get`, que es otra y no tiene
     * ese problema. Sale más cara y se queda así a propósito.
     */
    const live = new Set<string>();

    const unsubs = list.map((id) =>
      onSnapshot(
        doc(db, "groups", id),
        (snap) => {
          const isLive = esVivo(snap.data()?.activeLivePostId);

          // Mutar y clonar: `setState` con un Set nuevo por evento mantiene la
          // identidad estable cuando nada cambió, y evita repintar la tira.
          const had = live.has(id);
          if (isLive === had) return;

          if (isLive) live.add(id);
          else live.delete(id);

          setLiveIds(new Set(live));
        },
        () => {
          // Sin permiso para leer la entidad: simplemente no ordena por live.
        }
      )
    );

    return () => unsubs.forEach((unsub) => unsub());
  }, [idsKey, entityType]);

  useEffect(() => {
    const list = idsKey ? idsKey.split(",") : [];
    if (list.length === 0) return;

    const handle = (
      stories: Array<{ creatorId?: string; groupId?: string | null }>
    ) => {
      const next = new Set<string>();

      for (const story of stories) {
        const owner = entityType === "profile" ? story.creatorId : story.groupId;
        if (owner) next.add(owner);
      }

      setStoryIds(next);
    };

    return entityType === "profile"
      ? subscribeToStoriesFromCreators(list, handle)
      : subscribeToStoriesFromGroups(list, handle);
  }, [idsKey, entityType]);

  /**
   * Se filtra al LEER, no al escribir. Los efectos no limpian el estado cuando
   * la lista se vacía o cambia (hacerlo sería un setState síncrono dentro de un
   * efecto, que dispara renders en cascada); en su lugar, aquí se descarta lo
   * que ya no está en `ids`. Efecto secundario útil: nunca se muestra la señal
   * de una entidad que acaba de salir de la lista.
   */
  return useMemo(() => {
    if (!idsKey) return EMPTY;

    const current = new Set(idsKey.split(","));
    const live = new Set([...liveIds].filter((id) => current.has(id)));
    const stories = new Set([...storyIds].filter((id) => current.has(id)));

    if (live.size === 0 && stories.size === 0) return EMPTY;

    return { liveIds: live, storyIds: stories };
  }, [idsKey, liveIds, storyIds]);
}

/**
 * Ordena una lista de entidades para un rail.
 *
 * Prioridad, de mayor a menor:
 *   1. en vivo ahora
 *   2. tiene posts nuevos
 *   3. tiene historias
 *   4. la que más frecuentas
 *
 * Los tres primeros son binarios: dentro de cada escalón sigue mandando la
 * frecuencia de visita, así que a igualdad de novedad ves primero lo tuyo de
 * siempre. El desempate final por id mantiene el orden estable entre renders
 * cuando dos entidades empatan en todo (si no, la tira brincaría sola).
 */
export function sortRailItems<T extends { id: string }>(
  items: T[],
  opts: {
    signals: RailSignals;
    newPostsCounts: Record<string, number>;
    visitCounts: Record<string, number>;
  }
): T[] {
  const { signals, newPostsCounts, visitCounts } = opts;

  const rank = (id: string) => {
    if (signals.liveIds.has(id)) return 3;
    if ((newPostsCounts[id] ?? 0) > 0) return 2;
    if (signals.storyIds.has(id)) return 1;
    return 0;
  };

  return [...items].sort((a, b) => {
    const byRank = rank(b.id) - rank(a.id);
    if (byRank !== 0) return byRank;

    const byVisits = (visitCounts[b.id] ?? 0) - (visitCounts[a.id] ?? 0);
    if (byVisits !== 0) return byVisits;

    return a.id.localeCompare(b.id);
  });
}
