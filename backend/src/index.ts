import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";

// Healthcheck público (sin auth) para validar que Functions está vivo.
export const healthcheck = onRequest(
  {
    cors: true, // MVP: permite verificación desde navegador. (Luego lo cerramos por dominio en Deploy/Prod)
    region: "us-central1",
  },
  (req, res) => {
    logger.info("healthcheck ping", {
      method: req.method,
      path: req.path,
    });

    res.status(200).json({
      status: "ok",
      service: "red-social-mvp-backend",
      timestamp: new Date().toISOString(),
    });
  }
);