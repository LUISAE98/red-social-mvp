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
      icon: d.icon || "/icon-192.png",
      badge: d.badge || "/icon-192.png",
      // Imagen grande bajo el cuerpo (miniatura del post) — Android/desktop.
      image: d.image || undefined,
      tag: d.tag || undefined,
      // renotify default false: al reemplazar por tag no re-vibra en cada update.
      data: { link: d.link || "/" },
    });
  });
}

// Al tocar la notificación: enfoca una pestaña de Vibra ya abierta (y navega al
// deep-link) o abre una nueva.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link =
    (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if ("focus" in w) {
            if ("navigate" in w) {
              try {
                w.navigate(link);
              } catch (_e) {
                /* algunos navegadores no permiten navigate cross-scope */
              }
            }
            return w.focus();
          }
        }
        return clients.openWindow(link);
      })
  );
});
