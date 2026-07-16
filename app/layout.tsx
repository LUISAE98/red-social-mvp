import { AuthProvider } from "./providers";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Suspense } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";
import RootChrome from "./RootChrome";
import VibraGlobalBackground from "./components/VibraGlobalBackground";
import ServiceWorkerRegister from "./components/ServiceWorkerRegister";
import DesktopRefreshSplash from "@/components/DesktopRefreshSplash";
import { CurrencyProvider } from "./components/CurrencyProvider";
import { buildCollageTiles } from "@/lib/collage";

// Fuente variable (eje wght): permite cualquier peso 200–800, incluidos
// intermedios como 650, no solo los estáticos.
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

// Collage de fondo del splash — mismo set que el login, desde lib/collage.
// Se genera estático aquí porque el splash se pinta antes de hidratar React.
const SPLASH_TILES = buildCollageTiles(50);

export const metadata: Metadata = {
  title: "Vibra",
  description: "Plataforma social de creadores: comunidades, contenido, video en vivo, servicios y monetización directa.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vibra",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#000000" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} style={{ backgroundColor: "#000000" }}>
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              #desktop-refresh-splash {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: #000;
                overflow: hidden;
                pointer-events: none;
              }

              #desktop-refresh-splash.desktop-refresh-splash-hidden {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 220ms ease, visibility 220ms ease;
}

              /* Fondo de iconos (mismo collage 3D que el login) */
              .splash-collage {
                position: absolute;
                inset: 0;
                overflow: hidden;
                z-index: 0;
              }

              .splash-collage-stage {
                position: absolute;
                inset: -22%;
                perspective: 1400px;
                display: grid;
                place-items: center;
              }

              .splash-collage-grid {
                display: grid;
                grid-template-columns: repeat(6, 1fr);
                grid-auto-flow: row dense;
                gap: 16px;
                width: 150vw;
                transform: rotateX(15deg) rotateZ(-11deg) scale(1.08);
                filter: saturate(1.02);
              }

              .splash-tile {
                grid-column: span 1;
                aspect-ratio: 1 / 1;
                overflow: hidden;
                background: linear-gradient(160deg, #1b1530, #0d0a18);
                box-shadow: 0 18px 42px rgba(0, 0, 0, 0.55);
              }

              .splash-tile.is-wide {
                grid-column: span 2;
                aspect-ratio: 2 / 1;
              }

              .splash-tile img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
                opacity: 0.9;
              }

              .splash-collage-overlay {
                position: absolute;
                inset: 0;
                background:
                  radial-gradient(
                    135% 120% at 60% 45%,
                    rgba(6, 3, 14, 0.4) 0%,
                    rgba(5, 2, 11, 0.66) 55%,
                    rgba(3, 1, 8, 0.86) 100%
                  ),
                  linear-gradient(
                    180deg,
                    rgba(5, 2, 11, 0.56) 0%,
                    rgba(5, 2, 11, 0.3) 45%,
                    rgba(3, 1, 8, 0.62) 100%
                  );
              }

              /* Una sola línea (dos renglones en celular), todo del mismo
                 tamaño. */
              .desktop-refresh-words {
                position: relative;
                z-index: 1;
                font-family: inherit;
                font-size: clamp(26px, 3.4vw, 44px);
                font-weight: 700;
                letter-spacing: -0.03em;
                line-height: 1.08;
                text-align: center;
                white-space: nowrap;
                color: #fff;
                text-shadow: 0 2px 30px rgba(0, 0, 0, 0.55);
                padding: 0 16px;
              }

              /* Vibra con el mismo efecto del título de intereses: degradado
                 rosa→morado→azul que fluye (anima background-position). */
              .desktop-refresh-words .splash-vibra {
                background: linear-gradient(100deg, #ff2fb3 0%, #a855ff 45%, #4f46ff 100%);
                background-size: 220% 220%;
                -webkit-background-clip: text;
                background-clip: text;
                color: transparent;
                animation: vibSplashFlow 4.5s ease-in-out infinite;
              }

              @keyframes vibSplashFlow {
                0%, 100% { background-position: 0% 50%; }
                50% { background-position: 100% 50%; }
              }

              /* Ruedita cargando — mismo anillo que el pull-to-refresh. */
              .desktop-refresh-spinner {
                position: relative;
                z-index: 1;
                margin-top: 22px;
                width: 34px;
                height: 34px;
                border-radius: 999px;
                background: conic-gradient(
                  #a855ff 0deg 180deg,
                  transparent 180deg 360deg
                );
                box-shadow: 0 0 10px rgba(168, 85, 255, 0.24);
                -webkit-mask: radial-gradient(
                  farthest-side,
                  transparent calc(100% - 4px),
                  #000 calc(100% - 4px)
                );
                mask: radial-gradient(
                  farthest-side,
                  transparent calc(100% - 4px),
                  #000 calc(100% - 4px)
                );
                animation: vibSplashSpin 0.75s linear infinite;
              }

              @keyframes vibSplashSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }

              @media (max-width: 900px) {
                .desktop-refresh-words {
                  white-space: normal;
                  font-size: clamp(30px, 8vw, 46px);
                }

                /* En celular "Vibra." baja al segundo renglón. */
                .desktop-refresh-words .splash-vibra {
                  display: block;
                }
              }

              @media (max-width: 900px) {
                .splash-collage-grid {
                  grid-template-columns: repeat(6, 1fr);
                  width: 240vw;
                  gap: 10px;
                  transform: rotateX(12deg) rotateZ(-9deg) scale(1.12);
                }
              }
            `,
          }}
        />
      </head>

      <body className={`${plusJakarta.variable} antialiased`}>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('error', function(e) {
                var img = e.target;
                if (img && img.tagName === 'IMG' && img.src && img.src !== '') {
                  img.style.visibility = 'hidden';
                }
              }, true);
            `,
          }}
        />
        <div id="desktop-refresh-splash">
          <div className="splash-collage" aria-hidden="true">
            <div className="splash-collage-stage">
              <div className="splash-collage-grid">
                {SPLASH_TILES.map((tile, i) => (
                  <div
                    key={i}
                    className={`splash-tile${tile.wide ? " is-wide" : ""}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/${tile.src}.webp`} alt="" />
                  </div>
                ))}
              </div>
            </div>
            <div className="splash-collage-overlay" />
          </div>

          <div className="desktop-refresh-words">
            Conecta. Comparte.{" "}
            <span className="splash-vibra">Vibra.</span>
          </div>

          <div className="desktop-refresh-spinner" aria-hidden="true" />
        </div>

{/* SVG sprite: gradient defined once at document root so url(#vibraIconGradient) resolves from any position:fixed context */}
<svg aria-hidden="true" focusable="false" style={{ display: "none", position: "absolute", width: 0, height: 0 }}>
  <defs>
    <linearGradient id="vibraIconGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#ec4899" />
      <stop offset="52%" stopColor="#9333ea" />
      <stop offset="100%" stopColor="#3b82f6" />
    </linearGradient>
  </defs>
</svg>

<NextIntlClientProvider locale={locale} messages={messages}>
  <AuthProvider>
    <CurrencyProvider>
      <ServiceWorkerRegister />

      <DesktopRefreshSplash />

      <VibraGlobalBackground />

      <Suspense fallback={null}><RootChrome>{children}</RootChrome></Suspense>
    </CurrencyProvider>
  </AuthProvider>
</NextIntlClientProvider>
      </body>
    </html>
  );
}