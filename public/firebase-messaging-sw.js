/* Service Worker de Firebase Cloud Messaging (push del sistema).
 *
 * Convive con el SW de PWA (sw.js) porque se registra en un scope propio
 * (/firebase-cloud-messaging-push-scope). La config de Firebase llega como
 * query-params en la URL de registro (valores PÚBLICOS: apiKey, projectId, etc.),
 * porque un SW no puede leer process.env. Al ser parte de la URL registrada,
 * persiste aunque el navegador arranque el SW en frío para un push.
 *
 * Mensajes DATA-ONLY: el backend NO manda `notification` payload; este SW pinta
 * la notificación en `onBackgroundMessage`, así controlamos título/cuerpo/enlace
 * y el `tag` (que colapsa avisos repetidos del mismo tipo en uno solo).
 */
/* global importScripts, firebase, clients */

importScripts(
  "https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js"
);

const params = new URL(self.location).searchParams;
const firebaseConfig = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  storageBucket: params.get("storageBucket"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const d = (payload && payload.data) || {};
    const title = d.title || "Vibra";
    self.registration.showNotification(title, {
      body: d.body || "",
      icon: d.icon || "/favicons/android-chrome-192x192.png?v=3",
      badge: d.badge || "/favicons/android-chrome-192x192.png?v=3",
      // Imagen grande bajo el cuerpo (miniatura del post) — Android/desktop.
      image: d.image || undefined,
      tag: d.tag || undefined,
      // renotify default false: al reemplazar por tag no re-vibra en cada update.
      data: { link: d.link || "/" },
    });
  });
}

/* Al tocar la notificación: enfoca una pestaña de Vibra ya abierta y la lleva al
 * deep-link, o abre una nueva.
 *
 * OJO con `WindowClient.navigate()`: lanza si la ventana NO la controla ESTE
 * service worker, y nunca la controla — este SW vive en su propio scope
 * (/firebase-cloud-messaging-push-scope) mientras que la app se sirve desde /.
 * Antes se intentaba igual dentro de un try/catch vacío, así que el fallo pasaba
 * inadvertido: la pestaña se enfocaba pero se quedaba donde estuviera. De ahí
 * que las notificaciones "abrieran la app" pero no el chat.
 *
 * La vía que sí funciona es pedirle a la app que navegue ella misma con su
 * router (`postMessage`), que además no recarga la página. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link =
    (event.notification.data && event.notification.data.link) || "/";

  event.waitUntil(
    (async () => {
      const wins = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const w of wins) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(w.url).origin === self.location.origin;
        } catch (_e) {
          sameOrigin = false;
        }
        if (!sameOrigin || !("focus" in w)) continue;

        w.postMessage({ type: "vibra:navigate", link });
        return w.focus();
      }

      // Sin ninguna pestaña abierta: se abre directamente en el destino.
      return clients.openWindow(link);
    })()
  );
});
