// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

// En desarrollo bajamos trazado y logs (ver sentry.server.config.ts).
const isProd = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: "https://289313405740d90f3478c3bb08a949f5@o4510942250205184.ingest.us.sentry.io/4510942269145088",

  // Trazado 100% solo en producción.
  tracesSampleRate: isProd ? 1 : 0,

  // Logs a Sentry solo en producción.
  enableLogs: isProd,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,
});
