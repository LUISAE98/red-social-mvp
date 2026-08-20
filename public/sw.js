// Service Worker de Vibra
//
// Estrategia (pensada para NO servir contenido viejo):
//  - Assets con hash de Next (/_next/static/*) e imágenes/fuentes → cache-first.
//    Son inmutables: si cambian, cambia su nombre de archivo, así que nunca
//    quedan "viejos".
//  - Navegaciones (HTML) → network-first: siempre trae lo fresco si hay internet;
//    solo si falla la red cae a la última versión cacheada, y si no hay nada,
//    muestra una pantalla mínima de "sin conexión".
//  - Todo lo demás (APIs, Firestore, Cloud Functions, _next/data, RSC, terceros)
//    → NO se toca: pasa directo a la red. Así los datos dinámicos nunca se cachean.
//
// Al cambiar VERSION se limpian los caches viejos automáticamente.

// v6: el manifest deja de servirse desde cache. Sin esto, un cambio en
//     manifest.json (display, iconos, colores) no llegaba NUNCA a quien ya
//     tuviera la app instalada: Chrome revisa el manifest para actualizar el
//     WebAPK y el service worker le devolvia la copia vieja.
// v5: logotipo nuevo en los iconos de app.
// v4: los iconos cambian de contenido (mismo nombre de archivo). Sin subir la
// version, el cache viejo seguiria sirviendo el icono con el marco negro.
// v3: cambian las rutas de los iconos. Sin subir la version, el cache viejo
// seguiria sirviendo el logotipo anterior a quien ya tenga el service worker.
const VERSION = "v6";
const STATIC_CACHE = `vibra-static-${VERSION}`;
const RUNTIME_CACHE = `vibra-runtime-${VERSION}`;

// Lo mínimo que siempre existe y conviene tener listo.
const PRECACHE = [
  "/manifest.json",
  "/favicons/android-chrome-192x192.png?v=3",
  "/favicons/android-chrome-512x512.png?v=3",
];

const ASSET_EXT = /\.(png|jpe?g|webp|svg|gif|ico|woff2?|ttf|otf)$/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * El manifest NO es inmutable, aunque este en PRECACHE.
 *
 * Se precachea para que la app arranque sin red, pero servirlo desde cache
 * primero deja congelado su contenido: Chrome lo relee cada cierto tiempo para
 * actualizar el WebAPK instalado en Android, y con la copia vieja delante un
 * cambio de `display`, de iconos o de colores no llega jamas al aparato.
 * Va por la rama de red-primero, que igualmente cae a la cache si no hay senal.
 */
const SIEMPRE_FRESCO = ["/manifest.json"];

function isImmutableAsset(url) {
  if (SIEMPRE_FRESCO.includes(url.pathname)) return false;
  return (
    url.pathname.startsWith("/_next/static/") ||
    PRECACHE.includes(url.pathname) ||
    ASSET_EXT.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo GET del mismo origen. El resto (POST, terceros, Firebase, Mux…) pasa
  // directo a la red sin que el SW intervenga.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1) Assets inmutables → cache-first (rápido y seguro; el hash garantiza frescura).
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
      )
    );
    return;
  }

  // 2) Navegaciones (HTML) y el manifest → network-first, con caché de respaldo.
  if (request.mode === "navigate" || SIEMPRE_FRESCO.includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match("/"))
            .then(
              (cached) =>
                cached ||
                new Response(
                  '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
                    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
                    "<title>Sin conexión</title></head>" +
                    '<body style="background:#000;color:#fff;font-family:system-ui,sans-serif;' +
                    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">' +
                    "<div><h1 style=\"margin:0 0 8px\">Sin conexión</h1>" +
                    '<p style="opacity:.7">Revisa tu internet e inténtalo de nuevo.</p></div></body></html>',
                  { headers: { "Content-Type": "text/html; charset=utf-8" } }
                )
            )
        )
    );
    return;
  }

  // 3) Resto (APIs, _next/data, RSC…) → sin respondWith: red directa, sin caché.
});
