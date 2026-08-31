"use client";

// Lectura en voz alta de un texto, con resaltado que avanza y salto por clic.
//
// Extraído de StoryViewer para que el slide del feed de reels y el visor de
// círculos compartan exactamente el mismo comportamiento. Es la parte con más
// aristas del visor (generaciones para descartar audios viejos, resaltado por
// palabra, autoscroll del cursor), así que duplicarla habría sido garantía de
// que las dos copias se separaran.

import { useCallback, useEffect, useRef, useState } from "react";
import { playEdgeTTS, type EdgeTTSHandle } from "./edge-tts-client";

export type TextReaderState = "idle" | "playing" | "paused";
export type TextReaderRate = 1 | 1.4 | 1.8;

/** Tramo resaltado, en índices de carácter sobre el texto completo. */
export type TextReaderHighlight = { start: number; length: number };

type Options = {
  /** Se llama cuando la lectura termina sola, no cuando se detiene a mano. */
  onFinished?: () => void;
  /**
   * Voz con la que leer. Quien llama decide de quién es el idioma: en unas
   * pantallas manda el de quien escucha y en otras el del creador.
   */
  voice?: string;
};

export function useTextReader(text: string | null, options?: Options) {
  const [state, setState] = useState<TextReaderState>("idle");
  const [highlight, setHighlight] = useState<TextReaderHighlight | null>(null);
  const [rate, setRate] = useState<TextReaderRate>(1);

  const audioRef = useRef<EdgeTTSHandle | null>(null);
  // El rate vive también en un ref porque `startFrom` lo lee dentro de un
  // callback que se crea una sola vez por texto; con el estado leería el valor
  // de cuando se creó.
  const rateRef = useRef<number>(1);
  /**
   * La voz, por referencia y no leída de `options` dentro del callback.
   *
   * `options` es un objeto literal nuevo en cada render, así que leerlo ahí
   * dentro deja al compilador de React sin poder memoizar `startFrom`. Es el
   * mismo motivo por el que la velocidad ya viajaba así.
   */
  const voiceRef = useRef<string | undefined>(options?.voice);
  // Se actualiza en un efecto: escribir una ref durante el render no está permitido.
  useEffect(() => {
    voiceRef.current = options?.voice;
  }, [options?.voice]);
  // Cada reproducción lleva número. Al empezar otra, o al parar, se incrementa y
  // los callbacks de la anterior se descartan solos. Sin esto, un audio viejo
  // que aún estaba sonando seguía moviendo el resaltado del nuevo.
  const genRef = useRef(0);
  // Se guarda el callback más reciente en un ref para que `startFrom` no cambie
  // de identidad cada vez que quien llama pasa una función inline.
  const onFinished = options?.onFinished;
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  // Este hook NO toca el DOM ni guarda refs a elementos, a propósito. Si los
  // devolviera, todo lo que devuelve quedaría marcado como ref y leer `highlight`
  // al pintar sería un error del compilador de React. El elemento del texto entra
  // como argumento en el único sitio que lo necesita (`seekFromPoint`), y el
  // autoscroll del cursor lo hace quien pinta, que es quien tiene los nodos.

  const stop = useCallback(() => {
    genRef.current += 1;
    if (audioRef.current) {
      audioRef.current.stop();
      audioRef.current = null;
    }
    setState("idle");
    setHighlight(null);
  }, []);

  const startFrom = useCallback(
    (charIndex: number) => {
      const full = text ?? "";
      if (audioRef.current) {
        audioRef.current.stop();
        audioRef.current = null;
      }
      const gen = ++genRef.current;
      const slice = full.slice(charIndex);
      if (!slice.trim()) return;

      setHighlight(charIndex > 0 ? { start: charIndex, length: 0 } : null);

      audioRef.current = playEdgeTTS(slice, {
        voice: voiceRef.current,
        playbackRate: rateRef.current,
        onProgress: (ratio) => {
          if (genRef.current !== gen) return;
          const posInSlice = Math.floor(ratio * slice.length);
          const absPos = charIndex + posInSlice;
          // Resalta hasta el final de la palabra en curso, no hasta el carácter
          // exacto, que parpadearía letra a letra.
          const ahead = slice.slice(posInSlice);
          const spaceAt = ahead.search(/[\s\n]/);
          const length = spaceAt === -1 ? Math.min(ahead.length, 8) : spaceAt;
          setHighlight({ start: absPos, length: Math.max(1, length) });
        },
        onEnded: () => {
          if (genRef.current !== gen) return;
          audioRef.current = null;
          setState("idle");
          setHighlight(null);
          onFinishedRef.current?.();
        },
        onError: () => {
          if (genRef.current !== gen) return;
          audioRef.current = null;
          setState("idle");
          setHighlight(null);
        },
      });
      setState("playing");
    },
    [text],
  );

  const toggle = useCallback(() => {
    if (state === "playing") {
      audioRef.current?.audio.pause();
      setState("paused");
      return;
    }
    if (state === "paused") {
      audioRef.current?.audio.play().catch(() => {});
      setState("playing");
      return;
    }
    startFrom(0);
  }, [state, startFrom]);

  const cycleRate = useCallback(() => {
    const next: TextReaderRate = rate === 1 ? 1.4 : rate === 1.4 ? 1.8 : 1;
    rateRef.current = next;
    setRate(next);
    // En caliente, sin reiniciar el audio ni perder la posición.
    if (audioRef.current) audioRef.current.audio.playbackRate = next;
  }, [rate]);

  /**
   * Empieza a leer desde donde se tocó el texto. Traduce el punto del clic a un
   * índice de carácter usando la API de rangos, que cambia de nombre entre
   * navegadores.
   */
  const seekFromPoint = useCallback(
    (clientX: number, clientY: number, el: HTMLElement | null) => {
      let charIndex = 0;
      if (el) {
        try {
          let range: Range | null = null;
          if ("caretRangeFromPoint" in document) {
            range = (
              document as Document & {
                caretRangeFromPoint(x: number, y: number): Range | null;
              }
            ).caretRangeFromPoint(clientX, clientY);
          } else if ("caretPositionFromPoint" in document) {
            const d = document as Document & {
              caretPositionFromPoint(
                x: number,
                y: number,
              ): { offsetNode: Node; offset: number } | null;
            };
            const pos = d.caretPositionFromPoint(clientX, clientY);
            if (pos) {
              range = d.createRange();
              range.setStart(pos.offsetNode, pos.offset);
            }
          }
          if (range) {
            const pre = document.createRange();
            pre.selectNodeContents(el);
            pre.setEnd(range.startContainer, range.startOffset);
            charIndex = pre.toString().length;
          }
        } catch {
          // Navegador sin ninguna de las dos APIs: se lee desde el principio.
        }
      }
      startFrom(charIndex);
    },
    [startFrom],
  );

  // Al desmontar, callar. Un audio suelto sobrevive al componente.
  useEffect(
    () => () => {
      genRef.current += 1;
      if (audioRef.current) {
        audioRef.current.stop();
        audioRef.current = null;
      }
    },
    [],
  );

  return { state, rate, highlight, toggle, cycleRate, seekFromPoint, stop };
}

/**
 * Mantiene el cursor de lectura a la vista dentro de su contenedor scrolleable.
 *
 * Vive fuera del hook porque necesita los nodos del DOM, y quien pinta es quien
 * los tiene. El `<p>` no scrollea, lo hace su padre.
 */
export function scrollCursorIntoView(
  cursor: HTMLElement | null,
  container: HTMLElement | null,
): void {
  if (!cursor || !container) return;
  const containerRect = container.getBoundingClientRect();
  const cursorRect = cursor.getBoundingClientRect();
  const cursorBottom = cursorRect.bottom - containerRect.top + container.scrollTop;
  const cursorTop = cursorRect.top - containerRect.top + container.scrollTop;
  if (cursorBottom > container.scrollTop + container.clientHeight) {
    container.scrollTop = cursorBottom - container.clientHeight + 8;
  } else if (cursorTop < container.scrollTop) {
    container.scrollTop = cursorTop - 8;
  }
}
