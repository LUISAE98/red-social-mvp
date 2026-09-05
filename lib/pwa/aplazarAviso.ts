"use client";

/**
 * "Ahora no" con fecha de caducidad, compartido por los avisos de instalación.
 *
 * Ni una sola vez ni para siempre. Preguntar una vez y callarse desaprovecha a
 * quien dijo que no porque tenía prisa; volver eternamente es lo que hace que la
 * gente aprenda a ignorar TODOS tus avisos, incluido el que sí importa.
 *
 * Vive aparte porque lo usan el aviso de Android y el de iPhone, y son dos
 * pantallas distintas con la misma regla. Cada una pasa su propia clave, así que
 * posponer uno no calla al otro.
 */

const HORA = 60 * 60 * 1000;

/**
 * Cada aviso decide su propio ritmo, porque no piden lo mismo.
 *
 * ⚠️ El de instalar en Android y laptop va SIN TOPE a propósito: lo único que
 * lo calla es instalar. Es una decisión de producto de Luis (2026-09-05), y
 * tiene sentido porque ahí instalar es un botón —un toque y ya—, así que
 * insistir cuesta poco a quien no quiere.
 *
 * El de iPhone conserva el tope, y ahí sí importa: no hay botón que instalar,
 * solo un instructivo de dos pasos. Repetir eternamente unas instrucciones que
 * la persona ya decidió no seguir es exactamente lo que enseña a ignorar todos
 * tus avisos, incluido el que sí importa.
 */
export const CADENCIA_INSTALAR = { esperaMs: 6 * HORA };
export const CADENCIA_INSTRUCTIVO = { esperaMs: 14 * 24 * HORA, topeVeces: 3 };

export type Cadencia = {
  /** Cuánto se espera desde el último "ahora no". */
  esperaMs: number;
  /** Cuántas veces como mucho. Sin él, se pregunta indefinidamente. */
  topeVeces?: number;
};

type Aplazado = { en: number; veces: number };

function leer(clave: string): Aplazado {
  try {
    const crudo = window.localStorage.getItem(clave);
    if (!crudo) return { en: 0, veces: 0 };
    const dato = JSON.parse(crudo) as Partial<Aplazado>;
    return {
      en: typeof dato.en === "number" ? dato.en : 0,
      veces: typeof dato.veces === "number" ? dato.veces : 0,
    };
  } catch {
    // Navegación privada o dato corrupto: se trata como si no hubiera nada.
    return { en: 0, veces: 0 };
  }
}

/** ¿Toca volver a preguntar? */
export function puedePreguntar(clave: string, cadencia: Cadencia): boolean {
  const { en, veces } = leer(clave);
  if (cadencia.topeVeces !== undefined && veces >= cadencia.topeVeces) return false;
  if (!en) return true;
  return Date.now() - en > cadencia.esperaMs;
}

/** Guarda el "ahora no" y suma una a la cuenta. */
export function aplazar(clave: string): void {
  try {
    const { veces } = leer(clave);
    window.localStorage.setItem(
      clave,
      JSON.stringify({ en: Date.now(), veces: veces + 1 })
    );
  } catch {
    // Sin almacenamiento se volverá a preguntar en la siguiente visita. Es el
    // fallo aceptable: molestar de más es mejor que no poder instalar nunca.
  }
}
