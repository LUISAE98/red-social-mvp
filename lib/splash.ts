"use client";

/**
 * Control del splash de marca (`#desktop-refresh-splash`, en el layout raíz).
 *
 * El splash se pinta desde el HTML inicial, antes de que React hidrate, así que
 * no se puede montar ni desmontar como un componente: se enciende y se apaga con
 * clases sobre un nodo que ya existe. Estas dos funciones son la ÚNICA puerta a
 * ese nodo — antes cada sitio hacía su propio `getElementById` y era fácil que
 * uno se olvidara del safe-area o del reseteo de los temporizadores.
 *
 * Se usan en las transiciones de sesión (entrar y salir). Antes esas transiciones
 * pintaban un `<div>` negro encima, y como el destino tarda en resolver —Firebase,
 * la limpieza de IndexedDB, la recarga— lo que se veía eran segundos de pantalla
 * negra en vez del splash.
 */

const SPLASH_ID = "desktop-refresh-splash";
const HIDDEN_CLASS = "desktop-refresh-splash-hidden";

/**
 * Marca en el <body> que el splash está cubriendo la pantalla.
 *
 * Existe por el safe-area: `body.vb-authed` vale 20px de inset inferior y se
 * alterna siguiendo a `user`, que resuelve en momentos distintos según caché y
 * red. Estando el splash encima eso se traducía en un inset que aparecía y
 * desaparecía solo. Con esta clase, `body.vb-authed.vb-splash` lo fuerza a 0
 * mientras dure el splash (ver globals.css).
 */
const SPLASH_BODY_CLASS = "vb-splash";

/** Lo que tarda el fade de salida del splash (declarado en app/layout.tsx). */
const FADE_MS = 220;

/**
 * El safe-area se devuelve al TERMINAR el fade, no al empezarlo. Recuperar los
 * 20px con el splash todavía medio visible se ve como un brinco del contenido
 * a través de él. Guardamos el temporizador para poder cancelarlo si el splash
 * se vuelve a encender antes de que el fade acabe.
 */
let restoreSafeAreaTimer: ReturnType<typeof setTimeout> | null = null;

function cancelSafeAreaRestore(): void {
  if (restoreSafeAreaTimer === null) return;
  clearTimeout(restoreSafeAreaTimer);
  restoreSafeAreaTimer = null;
}

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

  cancelSafeAreaRestore();
  el.classList.remove(HIDDEN_CLASS);
  document.body.classList.add(SPLASH_BODY_CLASS);
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

  cancelSafeAreaRestore();
  restoreSafeAreaTimer = setTimeout(() => {
    document.body.classList.remove(SPLASH_BODY_CLASS);
    restoreSafeAreaTimer = null;
  }, FADE_MS);
}
