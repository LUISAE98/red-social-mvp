// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

const isProd = process.env.NODE_ENV === "production";

/**
 * Escotilla para depurar el propio Sentry en local, poniendo
 * `NEXT_PUBLIC_SENTRY_DEV=1` en `.env.local`. Reactiva el bucle descrito abajo,
 * así que es para ratos concretos, no para dejarlo puesto.
 */
const forceInDev = process.env.NEXT_PUBLIC_SENTRY_DEV === "1";

/**
 * ⚠️ EN DESARROLLO NO SE INICIALIZA, y no es por ruido ni por gusto.
 *
 * El SDK de Next añade en desarrollo un procesador de eventos que resuelve las
 * trazas pidiéndole los source maps al servidor de desarrollo. Con esta versión
 * de Next esa petición revienta, y el fallo sale como promesa rechazada sin
 * capturar, que Sentry vuelve a capturar, que vuelve a intentar resolver, que
 * vuelve a reventar. Se realimenta: en una sesión normal pasaba de quince mil
 * errores en consola y tapaba cualquier mensaje real.
 *
 * No hay bandera para desactivar ese procesador: el SDK lo registra siempre que
 * NODE_ENV es development. Y `enabled: false` no sirve, porque el cliente
 * comprueba esa opción al ENVIAR, no antes de correr los procesadores, así que
 * el bucle ocurriría igual. Sin cliente no hay procesadores que correr.
 *
 * No se pierde nada: en desarrollo los errores ya se ven en la consola y en el
 * panel de Next, y este archivo ya apagaba aquí Replay, trazado y logs.
 */
if (isProd || forceInDev) {
  Sentry.init({
    dsn: "https://289313405740d90f3478c3bb08a949f5@o4510942250205184.ingest.us.sentry.io/4510942269145088",

    /**
     * Replay NO se declara aquí, y no es un olvido.
     *
     * 🚨 Declararlo en `integrations` lo mete en el paquete inicial, y con él
     * `rrweb`, el grabador. Medido: el trozo de Sentry pesaba 166 KB
     * comprimidos —más que Firebase entero— y era el mayor de todas las
     * pantallas. Se grababa el 10 % de las sesiones, pero el grabador lo
     * descargaba el 100 % de la gente: nueve de cada diez lo bajaban para nada.
     *
     * Ahora se añade después, en tiempo ocioso (ver más abajo). Los bytes se
     * siguen trayendo, pero fuera del camino crítico: ya no compiten con lo que
     * hace falta para pintar.
     *
     * En desarrollo sigue sin cargarse: descarga un segmento pesado cada ~5 min
     * por el tunnelRoute (/monitoring) y satura el servidor local.
     */
    integrations: [],

    // Trazado 100% solo en producción (en dev pesa mucho en memoria).
    tracesSampleRate: isProd ? 1 : 0,
    // Logs a Sentry solo en producción.
    enableLogs: isProd,

    // Replay solo en producción.
    replaysSessionSampleRate: isProd ? 0.1 : 0,
    replaysOnErrorSampleRate: isProd ? 1.0 : 0,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
    sendDefaultPii: true,
  });
}

/**
 * Replay, cargado cuando el navegador está desocupado.
 *
 * Se hace con `import()` a nuestro propio paquete y NO con
 * `Sentry.lazyLoadIntegration()`, aunque el SDK la ofrezca: esa lo trae del CDN
 * de Sentry, o sea inyectar un script de terceros en cada sesión sorteada. Con
 * la postura de seguridad de este proyecto —y un CSP pendiente de calibrar— no
 * compensa por unos KB.
 *
 * Se carga para TODAS las sesiones, no solo el 10 % sorteado, y también a
 * propósito: `replaysOnErrorSampleRate` está en 1, así que Sentry guarda un
 * búfer para poder adjuntar el video cuando algo falla en CUALQUIER sesión. Si
 * solo se cargara en las sorteadas, se perderían justo las grabaciones de los
 * errores, que son las que se miran. Lo que cambia es CUÁNDO llega, no a quién.
 *
 * El tope de 3 s es para que no se quede sin cargar en una pestaña que nunca
 * llega a estar ociosa; la ventana en la que un error se quedaría sin video es
 * esa, y es un intercambio aceptable a cambio de sacarlo del arranque.
 */
if (isProd) {
  const cargarReplay = () => {
    import("@sentry/nextjs")
      .then(({ replayIntegration }) => {
        Sentry.getClient()?.addIntegration(replayIntegration());
      })
      .catch(() => {
        // Sin grabación se sigue teniendo el error y su traza. No se reintenta:
        // si el trozo no se pudo traer, insistir tampoco lo va a traer.
      });
  };

  if (typeof window !== "undefined") {
    // Se toma la función y se comprueba, en vez de usar `"x" in window`: ese
    // operador estrecha el tipo de `window` y deja la otra rama en `never`.
    const enCuantoPuedas = window.requestIdleCallback;

    if (typeof enCuantoPuedas === "function") {
      enCuantoPuedas.call(window, cargarReplay, { timeout: 3000 });
    } else {
      // Safari viejo no tiene requestIdleCallback.
      window.setTimeout(cargarReplay, 2000);
    }
  }
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
