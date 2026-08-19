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

    // Replay solo en producción: descarga un segmento pesado cada ~5 min por el
    // tunnelRoute (/monitoring), lo que satura el servidor local.
    integrations: isProd ? [Sentry.replayIntegration()] : [],

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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
