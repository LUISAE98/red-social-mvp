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

const DIAS_DE_ESPERA = 14;
const VECES_MAXIMAS = 3;

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
export function puedePreguntar(clave: string): boolean {
  const { en, veces } = leer(clave);
  if (veces >= VECES_MAXIMAS) return false;
  if (!en) return true;
  return Date.now() - en > DIAS_DE_ESPERA * 24 * 60 * 60 * 1000;
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
