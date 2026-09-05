"use client";

// ¿Estamos dentro de la app INSTALADA, o en el navegador?
//
// Lo necesitan las dos pantallas de instalación —el botón de Android y el aviso
// de iPhone—, y las dos por el mismo motivo: ofrecerle instalar a quien ya
// instaló es el error que más rápido hace que alguien deje de leer tus avisos.

import { useSyncExternalStore } from "react";

/**
 * 🚨 EL MISMO criterio que `app/globals.css`. Los dos tienen que decir lo mismo,
 * o la interfaz y los estilos discreparán sobre si hay barra de navegador.
 *
 * Van los DOS modos, no solo `standalone`. En `globals.css` está la historia
 * larga: la primera versión de aquella regla solo cubría `standalone` y no se
 * aplicó NUNCA, porque iOS reporta `fullscreen` aunque enseñe la barra de
 * estado. El fallo no daba error, simplemente no ocurría nada.
 *
 * `minimal-ui` NO entra: ahí sí hay barra de navegador, así que no cuenta como
 * instalada.
 */
export const MEDIA_APP_INSTALADA =
  "(display-mode: standalone), (display-mode: fullscreen)";

export type PlataformaPwa = "ios" | "android" | "escritorio" | "desconocida";

export type EstadoPwa = {
  /**
   * ⚠️ `null` mientras no se sabe, y esto importa.
   *
   * En el servidor no hay navegador que preguntar, así que la primera pintada
   * no puede saberlo. Devolver `false` ahí sería mentir hacia el lado peor: al
   * usuario que YA tiene la app instalada se le asomaría el aviso de instalar
   * durante un fotograma. Con `null` la decisión se puede aplazar, que es lo
   * que tiene que hacer quien lo consuma.
   */
  instalada: boolean | null;
  plataforma: PlataformaPwa;
  /** Atajo de `instalada !== null`, para gatear el render de un aviso. */
  resuelto: boolean;
};

/**
 * Móvil de Apple, incluido el iPad moderno.
 *
 * ⚠️ Desde iPadOS 13 el iPad se presenta como un Mac de escritorio en el
 * `userAgent`. Lo delata que tenga pantalla táctil: un Mac de verdad reporta
 * `maxTouchPoints` en 0. Sin esta segunda comprobación, todos los iPad caerían
 * en "escritorio" y no verían nunca el aviso de instalar — que es justo donde
 * hace falta, porque en Apple no hay instalación automática.
 */
function detectarPlataforma(): PlataformaPwa {
  if (typeof navigator === "undefined") return "desconocida";

  const ua = navigator.userAgent;
  const esIpadModerno =
    navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  if (/iPad|iPhone|iPod/.test(ua) || esIpadModerno) return "ios";
  if (/Android/.test(ua)) return "android";
  return "escritorio";
}

/**
 * Las tres formas de estar instalada, porque ninguna cubre a las demás.
 *
 *  1. La media query, que es lo que entienden Chrome, Edge y el iOS moderno.
 *  2. `navigator.standalone`, que es lo ÚNICO que responde en los iOS viejos:
 *     el soporte de `display-mode` en Safari llegó en la 16.4, y por debajo de
 *     esa versión la media query dice `false` estando instalada.
 *  3. El referrer `android-app://`, que es como llega quien la abrió desde una
 *     app envoltorio publicada en Play.
 */
function leerInstalada(): boolean {
  if (window.matchMedia(MEDIA_APP_INSTALADA).matches) return true;

  const iosAntiguo =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (iosAntiguo) return true;

  return document.referrer.startsWith("android-app://");
}

/**
 * Escucha el cambio de modo, para que instalar la app con la pestaña abierta se
 * note sin recargar. Va al margen de React —fuera del componente— porque
 * `useSyncExternalStore` exige que la función no cambie entre renders: si
 * cambiara, se resuscribiría en cada uno.
 */
function suscribir(alCambiar: () => void): () => void {
  const mql = window.matchMedia(MEDIA_APP_INSTALADA);
  mql.addEventListener("change", alCambiar);
  return () => mql.removeEventListener("change", alCambiar);
}

/** En el servidor no hay nada que preguntar; ver el porqué del `null` arriba. */
const sinResolver = () => null;

/**
 * ⚠️ Con `useSyncExternalStore` y NO con estado más efecto.
 *
 * Es la herramienta hecha justo para esto: leer algo que vive FUERA de React —el
 * navegador— sin escribir estado dentro de un efecto. Y de paso resuelve la
 * hidratación sola: React pinta la primera vez con la respuesta del servidor
 * (`null`), y en cuanto hidrata vuelve a pintar con la de verdad, sin desajuste
 * entre servidor y cliente.
 *
 * La instantánea devuelve un BOOLEANO y no un objeto a propósito: React compara
 * por identidad, y un objeto nuevo en cada lectura sería un bucle de renders.
 */
export function usePwaInstalled(): EstadoPwa {
  const instalada = useSyncExternalStore(suscribir, leerInstalada, sinResolver);

  return {
    instalada,
    // Se calcula aquí y no se guarda: que `instalada` haya dejado de ser `null`
    // es la prueba de que ya estamos en el cliente y hay `navigator` que leer.
    plataforma: instalada === null ? "desconocida" : detectarPlataforma(),
    resuelto: instalada !== null,
  };
}
