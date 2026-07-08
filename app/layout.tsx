import { AuthProvider } from "./providers";
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { Suspense } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";
import RootChrome from "./RootChrome";
import VibraGlobalBackground from "./components/VibraGlobalBackground";
import DesktopRefreshSplash from "@/components/DesktopRefreshSplash";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Red Social MVP",
  description: "Red Social MVP",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Red Social MVP",
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

              .desktop-refresh-aura {
                position: absolute;
                width: min(52vw, 620px);
                height: min(52vw, 620px);
                border-radius: 999px;
                background:
                  radial-gradient(circle, rgba(168, 85, 255, 0.36), transparent 58%),
                  radial-gradient(circle, rgba(255, 47, 179, 0.18), transparent 64%);
                filter: blur(34px);
                animation: desktopRefreshAuraPulse 1.8s ease-in-out infinite alternate;
              }

.desktop-refresh-words {
  position: relative;
  width: 340px;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  font-size: clamp(34px, 3.2vw, 50px);
  font-weight: 630;
  letter-spacing: -0.045em;
  line-height: 1.03;
  color: #fff;
  text-shadow:
    0 0 18px rgba(168, 85, 255, 0.55),
    0 0 42px rgba(168, 85, 255, 0.28);
}

              .desktop-refresh-words span {
                position: absolute;
                opacity: 0;
                animation: desktopRefreshWordCycle 0.9s infinite;
              }

              .desktop-refresh-words span:nth-child(1) {
                animation-delay: 0s;
              }

              .desktop-refresh-words span:nth-child(2) {
                animation-delay: 0.3s;
              }

              .desktop-refresh-words span:nth-child(3) {
                animation-delay: 0.6s;
              }

              @keyframes desktopRefreshWordCycle {
                0%, 28% {
                  opacity: 1;
                  transform: scale(1);
                }

                33%, 100% {
                  opacity: 0;
                  transform: scale(0.96);
                }
              }

              @keyframes desktopRefreshAuraPulse {
                from {
                  transform: scale(0.92);
                  opacity: 0.72;
                }

                to {
                  transform: scale(1.08);
                  opacity: 1;
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
          <div className="desktop-refresh-aura" />

          <div className="desktop-refresh-words">
            <span>Conecta</span>
            <span>Comparte</span>
            <span>Vibra</span>
          </div>
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
    <DesktopRefreshSplash />

    <VibraGlobalBackground />

    <Suspense fallback={null}><RootChrome>{children}</RootChrome></Suspense>
  </AuthProvider>
</NextIntlClientProvider>
      </body>
    </html>
  );
}