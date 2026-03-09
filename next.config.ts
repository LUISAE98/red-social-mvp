import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mueve el indicador rojo de Next (N) arriba a la derecha
  devIndicators: {
    position: "top-right",
  },

  // Evita que Next observe la carpeta functions durante el build del frontend
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: ["**/functions/**"],
    };
    return config;
  },

  // Next 16: turbopack config
  turbopack: {},
};

export default withSentryConfig(nextConfig, {
  org: "programin-social",

  project: "javascript-nextjs",

  silent: !process.env.CI,

  widenClientFileUpload: true,

  tunnelRoute: "/monitoring",

  webpack: {
    automaticVercelMonitors: true,

    treeshake: {
      removeDebugLogging: true,
    },
  },
});