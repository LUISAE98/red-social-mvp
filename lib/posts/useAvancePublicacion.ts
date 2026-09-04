"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PublishProgress } from "@/app/[locale]/groups/[groupId]/components/posts/GroupPostComposer.parts";

/**
 * El avance con el que se llena el botón de publicar.
 *
 * Une dos cosas que por separado no sirven:
 *
 *  · **Lo que reporta quien publica.** Es exacto, pero solo existe mientras se
 *    sube un video a Mux. Una publicación de texto o de imágenes no tiene nada
 *    que contar, y ahí la barra se quedaría clavada en cero hasta el final.
 *  · **Un arrastre propio.** Sube solo, cada vez más despacio, y se PARA en el
 *    90%. Nunca llega al 100 por su cuenta: ese último tramo se reserva para
 *    cuando la publicación termina de verdad, que es lo que la persona está
 *    esperando ver.
 *
 * Manda siempre el mayor de los dos, y la barra NUNCA retrocede. Sin esa regla,
 * el primer reporte real de un video —que llega en el 2%— haría saltar la barra
 * hacia atrás desde donde ya la había dejado el arrastre, y eso se lee como un
 * fallo.
 */

/** Hasta dónde llega el arrastre por su cuenta. El resto lo da el final. */
const TECHO_ARRASTRE = 0.9;

/** Cada cuánto avanza el arrastre. */
const PASO_MS = 120;

/**
 * Cuánto se acerca al techo en cada paso.
 *
 * Es una fracción de lo que FALTA, no una cantidad fija: así corre al principio
 * —cuando no se sabe nada y hay que dar señal de vida— y se va frenando cerca
 * del techo, que es justo el comportamiento que hace que una espera larga no
 * parezca colgada.
 */
const ACERCAMIENTO = 0.045;

export function useAvancePublicacion(activo: boolean) {
  const [avance, setAvance] = useState<PublishProgress | null>(null);

  /** Lo último visto, para que el arrastre parta de ahí y no de su propia cuenta. */
  const ultimoRef = useRef(0);

  useEffect(() => {
    if (!activo) {
      ultimoRef.current = 0;
      return;
    }

    const id = window.setInterval(() => {
      setAvance((prev) => {
        const actual = prev?.ratio ?? 0;
        if (actual >= TECHO_ARRASTRE) return prev;
        const siguiente = actual + (TECHO_ARRASTRE - actual) * ACERCAMIENTO;
        ultimoRef.current = siguiente;
        return { ratio: siguiente, phase: prev?.phase ?? "publicando", videoPct: prev?.videoPct };
      });
    }, PASO_MS);

    return () => window.clearInterval(id);
  }, [activo]);

  /**
   * Reporte exacto de quien publica. Se queda con el mayor: si el arrastre ya
   * iba por delante, no se retrocede.
   */
  const reportar = useCallback((entrante: PublishProgress) => {
    setAvance((prev) => {
      const base = prev?.ratio ?? 0;
      const ratio = Math.max(base, Math.min(1, entrante.ratio));
      ultimoRef.current = ratio;
      return { ...entrante, ratio };
    });
  }, []);

  /** La publicación terminó. Es el ÚNICO sitio donde la barra llega al 100. */
  const completar = useCallback(() => {
    setAvance({ ratio: 1, phase: "publicando" });
  }, []);

  /** Vuelve a cero, para que el próximo intento empiece desde el principio. */
  const reiniciar = useCallback(() => {
    ultimoRef.current = 0;
    setAvance(null);
  }, []);

  return { avance, reportar, completar, reiniciar };
}
