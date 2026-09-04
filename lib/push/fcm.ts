"use client";

// Cliente de push (FCM Web). Pide permiso, obtiene el token del dispositivo y lo
// guarda en `users/{uid}/fcmTokens/{token}`. El envío lo hace el backend
// (Cloud Function `onNotificationWritten`) con el Admin SDK.

import {
  getMessaging,
  getToken,
  deleteToken,
  isSupported,
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
