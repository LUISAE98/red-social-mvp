import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Desactiva el indicador visual de Next en desarrollo
  devIndicators: false,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "storage.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
    unoptimized: true,
  },

  // Canónico: el apex. `www` redirige al apex con 308 para evitar contenido
  // duplicado (hoy www sirve el sitio completo en paralelo).
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.vibraon.com" }],
        destination: "https://vibraon.com/:path*",
        permanent: true,
      },
    ];
  },

  // Caché de imágenes estáticas de /public. Por defecto Vercel las sirve con
  // `max-age=0, must-revalidate`, lo que obliga a revalidar en cada navegación.
  // Los nombres no llevan hash de contenido, así que NO usamos `immutable`:
  // con stale-while-revalidate el navegador sirve al instante desde caché y
  // refresca en segundo plano, y un cambio de imagen propaga en días, no en un año.
  async headers() {
    return [
      {
        source: "/:all*(webp|png|jpg|jpeg|gif|svg|avif|ico)",
        locale: false,
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
    ];
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

export default withSentryConfig(withNextIntl(nextConfig), {
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