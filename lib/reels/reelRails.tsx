"use client";

/**
 * Una sola fuente de reels para TODOS los rails de una pantalla.
 *
 * El rail de "Descubre nuevas experiencias" ya no sale solo arriba del home:
 * también se intercala entre publicaciones, en el home, en los perfiles y en las
 * comunidades. Si cada aparición llamara a `useReelFeed` por su cuenta, cada una
 * armaría su propio feed —lectura del mapa de vistas, tanda de 60 candidatas y
 * ranking—, y una pantalla con cuatro rails haría ese trabajo cuatro veces.
 *
 * Así que el feed se pide UNA vez, aquí arriba, y cada rail se lleva un trozo
 * distinto. Montar rails de más no cuesta ni una consulta más.
 *
 * Sin proveedor no revienta nada: los rails se quedan vacíos y no se pintan. Es
 * a propósito — un rail decorativo nunca debe tumbar la pantalla que lo aloja.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import { useReelFeed } from "./useReelFeed";
import type { StoryDoc } from "@/lib/stories/types";


type ValorRails = {
  stories: StoryDoc[];
  ready: boolean;
  loadMore: () => void;
};

const VACIO: ValorRails = { stories: [], ready: false, loadMore: () => {} };

const CtxRails = createContext<ValorRails | null>(null);

export function ReelRailsProvider({
  uid,
  activo = true,
  children,
}: {
  uid: string | null;
  /**
   * Con `false` el proveedor no pide nada. Sirve para las pantallas donde el
   * rail PUEDE salir pero aún no hay publicaciones suficientes para hospedar
   * uno: perfiles y comunidades cortos no deben pagar un feed de reels que nadie
   * va a ver.
   *
   * El proveedor sigue montado igual, solo cambia su valor, así que al activarse
   * no se remonta nada de lo que ya hay debajo.
   */
  activo?: boolean;
  children: ReactNode;
}) {
  // En celular estos rails no se pintan nunca —ese contenido vive en la pestaña
  // de reels, a pantalla completa—, así que ahí tampoco se pide el feed.
  //
  // Este corte va en JS y el del propio rail en CSS, y las dos cosas son
  // correctas: aquí no se dibuja nada, solo se decide si pedir datos, así que
  // equivocarse un fotograma no mueve el layout de nadie. En el rail sí dibuja,
  // y por eso allí tiene que ser CSS.
  const punteroFino = useMediaQuery("(pointer: fine)");
  const { stories, ready, loadMore } = useReelFeed(uid, false, activo && punteroFino);

  const valor = useMemo<ValorRails>(
    () => ({ stories, ready, loadMore }),
    [stories, ready, loadMore]
  );

  return <CtxRails.Provider value={valor}>{children}</CtxRails.Provider>;
}

/** El feed compartido. Vacío si nadie montó el proveedor. */
export function useReelRails(): ValorRails {
  return useContext(CtxRails) ?? VACIO;
}

/**
 * Cuántas historias se lleva cada rail. Con las tarjetas de ahora caben unas
 * cinco a la vista, así que doce dan de sobra para arrastrar un buen rato sin
 * vaciar el feed compartido a la primera.
 */
export const HISTORIAS_POR_RAIL = 12;

/**
 * El trozo que le toca al rail número `railIndex`.
 *
 * Cada aparición arranca donde acabó la anterior, así que dos rails de la misma
 * pantalla nunca enseñan lo mismo. Cuando se acaban las historias se vuelve al
 * principio en vez de dejar el rail vacío: es preferible repetir abajo del todo
 * a que la sección desaparezca a media pantalla.
 *
 * El corte es una función pura de `railIndex` y del feed, sin azar propio. Eso
 * importa: con `Math.random` cada render daría un trozo distinto y el rail se
 * reordenaría solo mientras lo miras.
 */
export function useReelRailSlice(railIndex: number, tamano = HISTORIAS_POR_RAIL) {
  const { stories, ready } = useReelRails();

  return useMemo(() => {
    if (stories.length === 0) return { stories: [] as StoryDoc[], ready };

    // Con menos historias que un rail entero, todos enseñan las mismas: no hay
    // material para diferenciarlos y rotar solo las haría bailar de sitio.
    if (stories.length <= tamano) return { stories, ready };

    const inicio = (railIndex * tamano) % stories.length;
    const trozo = stories.slice(inicio, inicio + tamano);

    // Si el corte se pasa del final, se completa por el principio.
    if (trozo.length < tamano) {
      trozo.push(...stories.slice(0, tamano - trozo.length));
    }

    return { stories: trozo, ready };
  }, [stories, ready, railIndex, tamano]);
}
