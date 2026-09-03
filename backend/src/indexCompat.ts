import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { stripeSecretKey } from "./payments/stripe/stripeClient";

// Esta codebase conserva toda función con URL externa y todo Cloud Scheduler job.
// No mover exports de este archivo sin un plan explícito de migración de identidad.

export const healthcheck = onRequest(
  { cors: true, region: "us-central1" },
  (req, res) => {
    logger.info("healthcheck ping", { method: req.method, path: req.path });
    res.status(200).json({ status: "ok" });
  }
);

export const expireScheduledServiceNoShows = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    const [meetGreet, exclusiveSession] = await Promise.all([
      import("./meetGreetRequests.js"),
      import("./exclusiveSessionRequests.js"),
    ]);
    await Promise.all([
      meetGreet.expireMeetGreetNoShowsHandler(),
      exclusiveSession.expireExclusiveSessionNoShowsHandler(),
    ]);
  }
);

export const autoExpirePendingServiceRequests = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    secrets: [stripeSecretKey],
  },
  async () => {
    const [greeting, meetGreet, exclusiveSession] = await Promise.all([
      import("./greetingRequests.js"),
      import("./meetGreetRequests.js"),
      import("./exclusiveSessionRequests.js"),
    ]);
    await Promise.all([
      greeting.autoExpirePendingGreetingRequestsHandler(),
      meetGreet.autoExpirePendingMeetGreetRequestsHandler(),
      exclusiveSession.autoExpirePendingExclusiveSessionRequestsHandler(),
      greeting.autoRejectUndeliveredGreetingRequestsHandler(),
      meetGreet.autoRejectUndeliveredMeetGreetRequestsHandler(),
      exclusiveSession.autoRejectUndeliveredExclusiveSessionRequestsHandler(),
    ]);
  }
);

export const cleanupAbandonedCreditReservations = onSchedule(
  {
    schedule: "every 6 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    secrets: [stripeSecretKey],
  },
  async () => {
    const { cleanupAbandonedCreditReservationsHandler } = await import(
      "./payments/stripe/creditReservationCleanup.js"
    );
    await cleanupAbandonedCreditReservationsHandler();
  }
);

export const sessionPreSessionReminders = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    const { sessionRemindersHandler } = await import("./sessionLifecycle.js");
    await sessionRemindersHandler();
  }
);

export const updateExchangeRates = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    secrets: [stripeSecretKey],
  },
  async () => {
    const [{ updateExchangeRatesHandler }, { refreshFrozenRatesHandler }] =
      await Promise.all([
        import("./exchangeRates.js"),
        import("./tax/frozenRates.js"),
      ]);
    await updateExchangeRatesHandler();
    await refreshFrozenRatesHandler(true);
  }
);

export const watchFxDrift = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Mexico_City",
    region: "us-central1",
    secrets: [stripeSecretKey],
  },
  async () => {
    const { refreshFrozenRatesHandler } = await import("./tax/frozenRates.js");
    const result = await refreshFrozenRatesHandler(false);
    if (result.refrescadas.length > 0) logger.info("watchFxDrift refrescó monedas", result);
  }
);

export const updateVatRates = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    const { updateVatRatesHandler } = await import("./vatRates.js");
    await updateVatRatesHandler();
  }
);

export const expireGroupSubscriptions = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    const { expireGroupSubscriptionsHandler } = await import(
      "./payments/groupSubscriptionCore.js"
    );
    await expireGroupSubscriptionsHandler();
  }
);

export const sweepGroupVisibilityDrift = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/Mexico_City",
    region: "us-central1",
  },
  async () => {
    const { sweepGroupVisibilityDriftHandler } = await import(
      "./groupVisibilityDriftSweep.js"
    );
    await sweepGroupVisibilityDriftHandler();
  }
);

// Schedules definidos en módulos históricos. Se mantienen aquí para conservar sus jobs.
export { cleanupExpiredGroupMutes } from "./groupModeration";
export { liveHeartbeatCleanup } from "./liveHeartbeatCleanup";
export { liveViewerSampler } from "./liveViewerSampler";
export { conciliarRetiros, avisarSelloPorCaducar } from "./wallet/withdrawals";
export { creatorMonthlyDocsCron } from "./facturacion/runCreatorMonthlyDocs";
export { expireInviteLinks } from "./notifications";

// URLs HTTP que proveedores o clientes externos pueden tener registradas.
export { muxWebhook } from "./muxWebhooks";
export { videoOverlayDownload } from "./videoOverlay";
export { greetingAnimatedDownload } from "./greetingRender";
export { cfWebhook } from "./cfWebhooks";
export { stripePayoutsWebhook } from "./payments/stripe/payoutsWebhook";
export { livekitWebhook } from "./livekitWebhook";
export { diditWebhook } from "./kyc";
export { stripeWebhook } from "./payments/stripe/stripeWebhook";
