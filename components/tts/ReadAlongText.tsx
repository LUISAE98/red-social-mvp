"use client";

import type { CSSProperties, Ref } from "react";

/**
 * Texto que se va aclarando según lo lee la voz.
 *
 * POR QUÉ NO ENGROSA
 * ==================
 * Antes lo leído se ponía en **negrita**. Cambiar el grosor cambia el ANCHO de
 * las letras, así que cada palabra que la voz alcanzaba empujaba a las de
 * detrás y la línea entera se movía. En un párrafo largo eso hace saltar el
 * texto varias veces por segundo.
 *
 * Ahora solo cambia el COLOR: lo pendiente en gris, lo leído en blanco. El color
 * no ocupa espacio, así que ni una letra se mueve — es el mismo recurso que usa
 * WhatsApp para marcar lo que ya se escuchó de una nota de voz.
 *
 * SE PINTA EN DOS TROZOS, NO LETRA A LETRA
 * ========================================
 * Un `<span>` por carácter daría una transición suave, pero en un mensaje de
 * 400 caracteres son 400 nodos que React vuelve a comparar en cada fotograma —
 * y el resaltado ahora avanza a 60 fotogramas por segundo. Dos nodos con el
 * borde moviéndose se leen igual de bien y no cuestan nada.
 */

/** Gris de lo que la voz aún no ha leído. Sobre fondo oscuro y a 13-17px es el punto donde se lee sin competir con lo blanco. */
const GRIS_PENDIENTE = "rgba(255, 255, 255, 0.42)";
const BLANCO_LEIDO = "#fff";

export function ReadAlongText({
  text,
  readChars,
  active,
  cursorRef,
  style,
}: {
  text: string;
  /** Cuántos caracteres lleva leídos la voz. */
  readChars: number;
  /**
   * Si no está leyendo, el texto se pinta entero y con el color que herede.
   * Dejarlo gris en reposo haría parecer que está desactivado.
   */
  active: boolean;
  /**
   * Marca invisible en el punto de lectura, para que quien quiera pueda
   * mantenerla a la vista mientras avanza.
   */
  cursorRef?: Ref<HTMLSpanElement>;
  style?: CSSProperties;
}) {
  if (!active) return <span style={style}>{text}</span>;

  const corte = Math.max(0, Math.min(text.length, readChars));

  return (
    <span style={style}>
      <span style={{ color: BLANCO_LEIDO }}>{text.slice(0, corte)}</span>
      {cursorRef ? <span ref={cursorRef} /> : null}
      <span style={{ color: GRIS_PENDIENTE }}>{text.slice(corte)}</span>
    </span>
  );
}

export default ReadAlongText;
