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
      // Cabeceras de seguridad para TODA la app. Deliberadamente NO se define
      // aquí un CSP con `script-src`/`default-src`: Vibra carga Firebase, Mux,
      // Cloudflare Stream, LiveKit y Stripe, y un CSP de recursos mal calibrado
      // rompe la app en silencio. Eso merece su propio ticket, con
      // `Content-Security-Policy-Report-Only` y medición antes de aplicarlo.
      {
        source: "/:path*",
        headers: [
          // Impide que el navegador adivine el tipo de una respuesta y ejecute
          // como script algo que se sirvió como otra cosa.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Antisecuestro de clics. Es `self` y no `none` porque el panel de
          // admin previsualiza páginas de Vibra dentro de un iframe propio
          // (app/[locale]/admin/layout.tsx).
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Cámara, micrófono y captura de pantalla SE USAN (transmisión en
          // directo, videollamadas de LiveKit y compartir pantalla), así que se
          // permiten en el propio origen. Solo se apagan las que la app no usa.
          {
            key: "Permissions-Policy",
            value: [
              "camera=(self)",
              "microphone=(self)",
              "display-capture=(self)",
              "fullscreen=(self)",
              "geolocation=()",
              "payment=()",
              "usb=()",
              "bluetooth=()",
              "serial=()",
              "midi=()",
              "interest-cohort=()",
            ].join(", "),
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