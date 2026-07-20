// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// En desarrollo apagamos Session Replay, tracing y logs de Sentry: Replay
// descarga un segmento pesado cada ~5 min por el tunnelRoute (/monitoring), lo
// que satura/tumba el server local. En producción se mantiene todo igual.
const isProd = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: "https://289313405740d90f3478c3bb08a949f5@o4510942250205184.ingest.us.sentry.io/4510942269145088",

  // Replay solo en producción.
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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
