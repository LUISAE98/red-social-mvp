"use client";

// Cliente de push (FCM Web). Pide permiso, obtiene el token del dispositivo y lo
// guarda en `users/{uid}/fcmTokens/{token}`. El envío lo hace el backend
// (Cloud Function `onNotificationWritten`) con el Admin SDK.

import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported,
  onMessage,
} from "firebase/messaging";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { app, db } from "@/lib/firebase";

// Clave VAPID pública (Web Push certificate del proyecto). NO es secreta: vive
// en el cliente. Firebase Console → Cloud Messaging → Web Push certificates.
const VAPID_KEY =
  "BK4s_9iudTt6afpaHxaiF2pahoWo75Ukp0tM_uB7ra1kfpm4gVesMNjC_4Kr7fuQraO9IZAGmfu-foBuf2F3dZo";

const SW_URL = "/firebase-messaging-sw.js";
// Scope propio para no chocar con el SW de PWA (sw.js, scope "/").
const SW_SCOPE = "/firebase-cloud-messaging-push-scope";
const TOKEN_LS_KEY = "vibra:fcmToken";

export type EnablePushResult = {
  ok: boolean;
  reason?: "no-uid" | "unsupported" | "denied" | "dismissed" | "no-token" | "error";
};

/** La config pública de Firebase, para pasarla al SW por query-params. */
function swUrlWithConfig(): string {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
  return `${SW_URL}?${new URLSearchParams(cfg).toString()}`;
}

export async function isPushSupported(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (
    !("serviceWorker" in navigator) ||
    !("Notification" in window) ||
    !("PushManager" in window)
  ) {
    return false;
  }
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export function currentPushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export function hasLocalPushToken(): boolean {
  try {
    return !!window.localStorage.getItem(TOKEN_LS_KEY);
  } catch {
    return false;
  }
}

/** Pide permiso, registra el SW, obtiene el token y lo guarda en Firestore. */
export async function enablePush(uid: string): Promise<EnablePushResult> {
  if (!uid) return { ok: false, reason: "no-uid" };
  if (!(await isPushSupported())) return { ok: false, reason: "unsupported" };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: "error" };
  }
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }

  try {
    const swReg = await navigator.serviceWorker.register(swUrlWithConfig(), {
      scope: SW_SCOPE,
    });
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return { ok: false, reason: "no-token" };

    await setDoc(
      doc(db, "users", uid, "fcmTokens", token),
      {
        token,
        platform: navigator.platform ?? null,
        userAgent: navigator.userAgent ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    try {
      window.localStorage.setItem(TOKEN_LS_KEY, token);
    } catch {
      /* localStorage no disponible */
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Vuelve a sellar el token de ESTE dispositivo, sin pedir permiso a nadie.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 Por qué las notificaciones "a veces" dejaban de llegar.
 *
 * El token de FCM se registraba UNA vez —al crear la cuenta o en el onboarding—
 * y no se volvía a mirar. Pero un token no es eterno: rota cuando el navegador
 * limpia datos del sitio, cuando caduca la suscripción push, al reinstalar la
 * app o al cambiar el service worker. Cuando eso pasaba, el de Firestore
 * quedaba muerto, nadie escribía el nuevo, y esa persona dejaba de recibir
 * avisos para siempre — sin ningún error, sin nada que mirar. La única forma de
 * revivirlo era apagar y encender los avisos a mano.
 *
 * El backend ya limpia los tokens que rebotan, así que el muerto desaparece
 * solo; lo que faltaba era volver a escribir el vivo.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Se llama en cada arranque con sesión. NO pide permiso: si no está concedido,
 * sale sin hacer nada, así que no puede provocar un diálogo inesperado.
 * `getToken` devuelve el token que ya tiene el service worker, o uno nuevo si el
 * anterior caducó, y en los dos casos se guarda.
 */
export async function resyncPushToken(uid: string): Promise<void> {
  if (!uid) return;
  if (currentPushPermission() !== "granted") return;
  if (!(await isPushSupported())) return;

  try {
    const swReg = await navigator.serviceWorker.register(swUrlWithConfig(), {
      scope: SW_SCOPE,
    });
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return;

    // `createdAt` solo si el documento es nuevo; `updatedAt` en cada arranque,
    // que es lo que permite distinguir un dispositivo vivo de uno abandonado.
    await setDoc(
      doc(db, "users", uid, "fcmTokens", token),
      {
        token,
        platform: navigator.platform ?? null,
        userAgent: navigator.userAgent ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    try {
      window.localStorage.setItem(TOKEN_LS_KEY, token);
    } catch {
      /* localStorage no disponible */
    }
  } catch {
    // Que no se pueda refrescar el token no puede tumbar el arranque de la app.
  }
}

/**
 * Muestra los avisos que llegan CON LA APP DELANTE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🚨 Esto es lo que hacía que "a veces sí y a veces no".
 *
 * El SDK de Firebase mira, en cada push, si hay alguna ventana VISIBLE de este
 * dominio. Si la hay, NO llama a `onBackgroundMessage` —o sea, el service worker
 * no pinta nada— y en su lugar reenvía el mensaje a la página por `onMessage`.
 * Como no había ningún `onMessage` en toda la app, ese aviso se perdía entero:
 * ni notificación del sistema, ni nada dentro de la app.
 *
 * O sea que la regla real era: si tenías Vibra a la vista, no te enterabas; si
 * la tenías cerrada o en segundo plano, sí. Desde fuera eso se ve exactamente
 * como "el sistema de notificaciones es inestable".
 *
 * ⚠️ Y había un segundo daño, peor porque es acumulativo: los navegadores
 * vigilan que cada push acabe enseñando algo. Chrome da un margen de pushes
 * silenciosos y, al pasarse, puede CANCELAR la suscripción del sitio; iOS es
 * más estricto todavía. Un push que no pinta nada no solo se pierde: gasta ese
 * margen, y al agotarse dejan de llegar todos.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Se pinta con el MISMO service worker, así que el aviso se ve igual, colapsa
 * por `tag` igual y al tocarlo funciona el mismo `notificationclick` de siempre.
 *
 * Lo único que se calla es el aviso de lo que ya estás mirando: si el destino
 * del aviso es la pantalla en la que estás, sobra.
 *
 * Devuelve la función para dejar de escuchar.
 */
export function escucharPushEnPrimerPlano(): () => void {
  if (typeof window === "undefined") return () => {};
  if (currentPushPermission() !== "granted") return () => {};

  let cancelado = false;
  let parar: (() => void) | null = null;

  void (async () => {
    if (!(await isPushSupported())) return;
    if (cancelado) return;

    try {
      const messaging = getMessaging(app);
      const unsubscribe = onMessage(messaging, (payload) => {
        const d = (payload.data ?? {}) as Record<string, string | undefined>;
        const link = d.link || "/";

        // Ya estás en esa pantalla: avisarte de lo que tienes delante sobra.
        // El enlace no lleva prefijo de idioma y la ruta sí, de ahí el `endsWith`.
        if (link !== "/" && window.location.pathname.endsWith(link)) return;

        void navigator.serviceWorker
          .getRegistration(SW_SCOPE)
          .then((registration) => {
            if (!registration) return;
            const tag = d.tag || undefined;
            return registration.showNotification(d.title || "Vibra", {
              body: d.body || "",
              icon: d.icon || "/favicons/android-chrome-192x192.png?v=3",
              badge: d.badge || "/favicons/android-chrome-192x192.png?v=3",
              tag,
              data: { link },
              // Mismo criterio que en el SW: colapsa por hilo, pero vuelve a
              // sonar. Sin esto, el segundo aviso del mismo hilo entra mudo.
              ...(tag ? { renotify: true } : {}),
            } as NotificationOptions);
          })
          .catch(() => {
            // Sin registro o sin permiso del sistema: no hay nada que hacer, y
            // desde luego no vale la pena romper la app por un aviso.
          });
      });

      if (cancelado) unsubscribe();
      else parar = unsubscribe;
    } catch {
      // Navegador sin soporte real: se sigue sin avisos en primer plano.
    }
  })();

  return () => {
    cancelado = true;
    parar?.();
  };
}

/** Revoca el token de este dispositivo y borra su doc en Firestore. */
export async function disablePush(uid: string): Promise<void> {
  let token: string | null = null;
  try {
    token = window.localStorage.getItem(TOKEN_LS_KEY);
  } catch {
    /* ignore */
  }
  try {
    const messaging = getMessaging(app);
    await deleteToken(messaging);
  } catch {
    /* el token ya podía estar revocado */
  }
  if (uid && token) {
    try {
      await deleteDoc(doc(db, "users", uid, "fcmTokens", token));
    } catch {
      /* ignore */
    }
  }
  try {
    window.localStorage.removeItem(TOKEN_LS_KEY);
  } catch {
    /* ignore */
  }
}
