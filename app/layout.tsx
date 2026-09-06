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
import FirestoreMeterHud from "@/components/dev/FirestoreMeterHud";
import { cookies } from "next/headers";
import { CurrencyProvider } from "./components/CurrencyProvider";
import { isDisplayCurrency } from "@/lib/currency/catalog";
import { buildCollageTiles } from "@/lib/collage";
import { localeDir } from "@/i18n/locales";

// Fuente variable (eje wght): permite cualquier peso 200–800, incluidos
// intermedios como 650, no solo los estáticos.
const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

// Collage de fondo del splash — mismo set que el login, desde lib/collage.
// Se genera estático aquí porque el splash se pinta antes de hidratar React.
const SPLASH_TILES = buildCollageTiles();

export const metadata: Metadata = {
  title: "Vibra",
  description: "Plataforma social de creadores: comunidades, contenido, video en vivo, servicios y monetización directa.",
  manifest: "/manifest.json",
  /**
   * Los iconos salen del kit que vive en `public/favicons/`. Se declaran aqui en
   * vez de duplicarlos como `app/icon.png` y `app/apple-icon.png`: asi hay UNA
   * copia de cada tamano y el kit se puede reemplazar entero sin tocar codigo.
   *
   * `app/favicon.ico` si se queda como archivo, y es el unico derivado: lo pide
   * el navegador por su cuenta en `/favicon.ico` y el kit no trae ese formato,
   * asi que se genero empaquetando sus PNG de 16 y 32.
   */
  icons: {
    icon: [
      { url: "/favicons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/favicons/apple-touch-icon.png?v=3", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    /**
     * `black-translucent` es DELIBERADO: el lienzo pasa por debajo de la barra
     * de estado y `.safeAreaGlass` pinta el cristal detrás del reloj y la
     * batería. Sin esto, `env(safe-area-inset-top)` vale 0, ese cristal se
     * queda en 22px sueltos y el contenido se corta en seco contra una barra
     * negra opaca.
     *
     * 🚨 PERO ES TAMBIÉN LO QUE CAUSA EL ESCALÓN NEGRO DE ABAJO. Es un solo
     * interruptor con dos consecuencias, no dos ajustes peleándose: mete el
     * lienzo por debajo de la barra de estado, y iOS NO le suma esos píxeles al
     * área de dibujo. Medido en un iPhone 16 Pro el 2026-09-03:
     *
     *     pantalla 874    lvh 874     ← el lienzo ocupa la pantalla entera
     *     alto win 812    dvh 812     ← el área de dibujo mide 62px menos
     *     seguro ↑62 ↓34              ← y los márgenes son los de una de 874
     *
     * 62 es exactamente la barra de estado. Como el área queda anclada arriba,
     * esos 62px sobran POR ABAJO y dejan ver el lienzo desnudo, que es negro. De
     * ahí que el escalón se viera abajo aunque el número venga de arriba, y de
     * ahí que los cuatro intentos de arreglarlo tocando el safe-area INFERIOR no
     * encontraran nada: no había nada. `--vb-safe-bottom` vale 0.
     *
     * Era pasajero porque iOS rehace esa cuenta en cada transición —el splash
     * al refrescar, abrir un panel, cerrar el teclado— y tarda unos fotogramas
     * en cuadrarla. Lo que se pintara dentro de esa ventana salía 62px corto.
     *
     * ⛔ NO SE ARREGLA QUITANDO ESTO. Ya se probó: quita el escalón, sí, pero
     * apagando media pantalla, y el traslúcido de arriba se corta en seco. La
     * diferencia se COMPENSA, con `--vb-lienzo-extra` en `globals.css`.
     *
     * ⚠️ iOS se guarda esto al INSTALAR. Para ver un cambio aquí hay que borrar
     * la app de la pantalla de inicio y volver a añadirla; recargar no basta.
     * La compensación de CSS, en cambio, se ve recargando.
     *
     * Historia completa y medidas en `docs/ios-pwa-viewport.md`.
     */
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
  /**
   * No declarar `interactive-widget=resizes-content` aquí.
   *
   * La política forma parte del `<meta viewport>` que el navegador procesa al
   * construir el layout viewport. Intentar quitarla después con JavaScript en
   * iPhone es demasiado tarde: WebKit puede conservar el alto reducido del
   * teclado y todos los `position: fixed` quedan flotando hasta otra navegación.
   * Las superficies que siguen al teclado ya usan `visualViewport`, que funciona
   * sin mutar el viewport de layout y sirve también en Android.
   */
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

  /**
   * 🚨 La moneda se siembra AQUÍ, en el servidor. No es un extra: sin esto hay
   * error de hidratación en TODAS las pantallas.
   *
   * `CurrencyProvider` siempre estuvo escrito para recibirla —su propio
   * comentario lo dice— pero nadie se la pasaba, así que caía a su valor por
   * defecto: el servidor pintaba `USD` y, ya montado, el cliente leía la cookie
   * y lo cambiaba a la moneda real. Sentry lo capturó con el diff en la mano:
   *
   *     <CurrencySwitcher variant="desktop">
   *       + MXN   ← cliente
   *       - USD   ← servidor
   *
   * Y `CurrencySwitcher` vive en `RootChrome`, o sea en la cabecera de todas las
   * páginas: el fallo no era de `/experiencias`, salía en cualquiera. Cuando la
   * hidratación falla React TIRA el HTML del servidor y reconstruye el árbol en
   * el cliente, así que además de un error era una pérdida de velocidad.
   *
   * La cookie la pone el middleware (por elección de la persona o por su IP).
   * Se cae a USD cuando no hay ninguna, que es lo que hacía antes para quien
   * llega por primera vez.
   */
  const cookieMoneda = (await cookies()).get("vibra_currency")?.value;
  const monedaInicial = isDisplayCurrency(cookieMoneda) ? cookieMoneda : "USD";

  return (
    // `dir` sale de RTL_LOCALES, no de una heurística sobre el código de idioma.
    // Sin él, el árabe se renderiza mal a nivel de CARÁCTER —orden invertido,
    // puntuación en el extremo equivocado, inputs escribiendo al revés—, que es
    // un fallo mucho peor que una maquetación sin espejar. El espejado visual de
    // la interfaz va aparte: docs/rtl-pendiente.md.
    <html
      lang={locale}
      dir={localeDir(locale)}
      style={{ backgroundColor: "#000000" }}
      suppressHydrationWarning
    >
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* Sentido de lectura como número, para el collage de aquí abajo.
                 Está repetido (vive en globals.css) a propósito: este bloque se
                 pinta ANTES de que cargue la hoja, y sin la variable el mosaico
                 arrancaría sin espejar y brincaría al llegar el CSS. */
              :root { --vb-dir: 1; }
              [dir="rtl"] { --vb-dir: -1; }

              #desktop-refresh-splash {
                position: fixed;
                inset: 0;
                /* El lienzo de la PWA de iPhone es más alto que el área de
                   dibujo contra la que resuelve inset: 0. Sin este alto el
                   splash se queda corto y por debajo asoma el lienzo en negro:
                   es el escalón que se veía "poner y quitar" durante el fundido.

                   ⚠️ Aquí NO se puede usar --vb-alto-pantalla. Este bloque se
                   pinta antes de que cargue globals.css, que es donde vive la
                   variable, así que llegaría vacía y caería al respaldo. Se
                   escribe entero, que es la única forma de que valga desde el
                   primer fotograma — y este es justo el sitio donde eso importa. */
                height: 100dvh;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                background: #000;
                overflow: hidden;
                pointer-events: none;
              }

              /* Dentro de la app instalada lvh SÍ mide el lienzo entero, y no
                 hay barra de navegador que dejar a la vista. Es la misma regla
                 que --vb-lienzo-extra en globals.css, escrita a mano porque
                 aquí la variable todavía no existe. */
              @media (display-mode: standalone), (display-mode: fullscreen) {
                #desktop-refresh-splash {
                  height: 100lvh;
                }
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

              /* Laptop: 6 columnas. El set reciclado embaldosa sin huecos a 6 (y
                 a 3 en celular); verificado — a 4, 5, 7 y 8 sí deja huecos.
                 Sin "dense": rompería el embaldosado. */
              .splash-collage-grid {
                display: grid;
                grid-template-columns: repeat(6, 1fr);
                gap: 16px;
                width: 150vw;
                /* translateX: la rotación -11deg hunde la esquina superior
                   derecha y dejaba ese lado descubierto, con la izquierda de
                   sobra. Se corre el mosaico a la derecha para repartirlo. */
                transform: translateX(calc(9vw * var(--vb-dir, 1))) rotateX(15deg) rotateZ(calc(-11deg * var(--vb-dir, 1))) scale(1.08);
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
                background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
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
                  #a855f7 0deg 180deg,
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

              /* Celular (vertical): 3 columnas. El set reciclado también
                 embaldosa sin huecos a 3. */
              @media (max-width: 900px) {
                .splash-collage-grid {
                  grid-template-columns: repeat(3, 1fr);
                  /* El ancho manda el zoom: con 3 columnas cada tile mide
                     ancho/3. Por debajo de ~130vw la cuadrícula se vuelve más
                     angosta que lo que la rotación necesita y reaparece el
                     espacio muerto a la derecha. */
                  width: 148.5vw;
                  gap: 10px;
                  transform: translateX(calc(8vw * var(--vb-dir, 1))) rotateX(12deg) rotateZ(calc(-9deg * var(--vb-dir, 1))) scale(1.12);
                }

                /* Espejo horizontal sólo en celular (ver flipMobile en lib/collage). */
                .splash-tile.is-flip-mobile img {
                  transform: scaleX(-1);
                }
              }
            `,
          }}
        />
      </head>

      <body
        className={`${plusJakarta.variable} antialiased`}
        suppressHydrationWarning
      >
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('error', function(e) {
                var img = e.target;
                if (img && img.tagName === 'IMG' && img.src && img.src !== '') {
                  img.style.visibility = 'hidden';
                }
              }, true);

              /* Pop al pulsar de los botones de icono. Los fotogramas viven en
                 .vibra-pop (globals.css); aquí solo se enciende y se apaga el
                 atributo que los dispara.

                 Va DELEGADO en el documento, no en cada componente, por dos
                 razones. Son 126 controles repartidos en 57 archivos, y con
                 estado de React cada toque re-renderizaría el componente que lo
                 contiene: en una tarjeta de publicación eso es carísimo para un
                 efecto de 400ms. Y así alcanza también a lo que se pinta en
                 portales, que es donde viven casi todos los paneles.

                 El valor alterna entre 'a' y 'b' porque el navegador solo
                 reinicia una animación si cambia el animation-name. Sin eso, el
                 segundo toque de un doble toque no haría nada, justo en guardar
                 y en la flamita, que son los que más se martillean. */
              document.addEventListener('pointerdown', function(e) {
                var el = e.target && e.target.closest ? e.target.closest('.vibra-pop') : null;
                if (!el || el.disabled) return;
                el.setAttribute('data-pop', el.getAttribute('data-pop') === 'a' ? 'b' : 'a');
              }, true);

              /* Teclado: al activar con Enter o espacio no hay pointerdown, y
                 el click sintético que llega trae detail 0. */
              document.addEventListener('click', function(e) {
                if (e.detail !== 0) return;
                var el = e.target && e.target.closest ? e.target.closest('.vibra-pop') : null;
                if (!el || el.disabled) return;
                el.setAttribute('data-pop', el.getAttribute('data-pop') === 'a' ? 'b' : 'a');
              }, true);

              /* Se limpia con las DOS: si el elemento cambia de estado a mitad
                 del pop y deja de casar el selector, llega 'animationcancel' y
                 no 'animationend'. Sin esto el atributo se quedaba pegado y el
                 pop salia despues, al volver a casar el selector. */
              function vibraQuitarPop(e) {
                if (e.animationName !== 'vibraPopA' && e.animationName !== 'vibraPopB') return;
                if (e.target && e.target.removeAttribute) e.target.removeAttribute('data-pop');
              }
              document.addEventListener('animationend', vibraQuitarPop, true);
              document.addEventListener('animationcancel', vibraQuitarPop, true);
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
                    className={`splash-tile${tile.wide ? " is-wide" : ""}${
                      tile.flipMobile ? " is-flip-mobile" : ""
                    }`}
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
    <CurrencyProvider initial={monedaInicial}>
      <ServiceWorkerRegister />

      <DesktopRefreshSplash />

      <VibraGlobalBackground />

      <Suspense fallback={null}><RootChrome>{children}</RootChrome></Suspense>

      {/* Medidor de lecturas de Firestore. Devuelve null salvo que
          NEXT_PUBLIC_FS_METER=1; ver lib/dev/firestoreMeter.ts. */}
      <Suspense fallback={null}><FirestoreMeterHud /></Suspense>
    </CurrencyProvider>
  </AuthProvider>
</NextIntlClientProvider>
      </body>
    </html>
  );
}
