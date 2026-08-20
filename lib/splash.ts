"use client";

/**
 * Control del splash de marca (`#desktop-refresh-splash`, en el layout raíz).
 *
 * El splash se pinta desde el HTML inicial, antes de que React hidrate, así que
 * no se puede montar ni desmontar como un componente: se enciende y se apaga con
 * clases sobre un nodo que ya existe. Estas dos funciones son la ÚNICA puerta a
 * ese nodo — antes cada sitio hacía su propio `getElementById` y era fácil que
 * uno se olvidara del reseteo de los temporizadores.
 *
 * Se usan en las transiciones de sesión (entrar y salir). Antes esas transiciones
 * pintaban un `<div>` negro encima, y como el destino tarda en resolver —Firebase,
 * la limpieza de IndexedDB, la recarga— lo que se veía eran segundos de pantalla
 * negra en vez del splash.
 */

const SPLASH_ID = "desktop-refresh-splash";
const HIDDEN_CLASS = "desktop-refresh-splash-hidden";

/* Aquí vivía `vb-safe-bottom`: una clase en el <body> mientras durase el
   splash, más un temporizador que devolvía el inset inferior de 20px al acabar
   el fade. Ya no hay safe-area inferior en ninguna parte, así que las dos cosas
   sobraban. */

/**
 * Cubre la pantalla con el splash AHORA, de forma síncrona.
 *
 * Es imperativa a propósito: se llama desde manejadores de evento (entrar,
 * cerrar sesión) donde esperar a un ciclo de React dejaría un frame con el
 * fondo al aire.
 *
 * El evento `vibra:auth-splash` es para DesktopRefreshSplash, que reinicia con
 * él su tiempo mínimo y su espera de "pantalla pintada". Sin ese reinicio el
 * splash se apagaría en cuanto pudiera, que es justo lo que no queremos.
 */
export function showSplash(): void {
  if (typeof document === "undefined") return;

  const el = document.getElementById(SPLASH_ID);
  if (!el) return;

  el.classList.remove(HIDDEN_CLASS);
  window.dispatchEvent(new Event("vibra:auth-splash"));
}

/**
 * Desvanece el splash. Solo debería llamarlo DesktopRefreshSplash, que es quien
 * sabe si la pantalla de destino ya avisó que está pintada.
 */
export function hideSplash(): void {
  if (typeof document === "undefined") return;

  const el = document.getElementById(SPLASH_ID);
  if (!el) return;

  el.classList.add(HIDDEN_CLASS);
}
