// App Check — atestación de que quien llama es la app real de Vibra y no un
// script con la configuración pública de Firebase (que es pública por diseño).
//
// NO sustituye autenticación ni autorización. Sirve para encarecer el abuso
// automatizado de endpoints legítimos, que es justo lo que faltaba en el resto
// de esta auditoría.
//
// ── Está DESACTIVADO hasta que existan dos cosas ─────────────────────────────
// 1. Un proveedor reCAPTCHA registrado en la consola de Firebase (App Check).
// 2. La variable `NEXT_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY` en Vercel.
//
// Sin la variable esto es un no-op: la app se comporta exactamente como antes.
// Se hizo así a propósito — activar la exigencia en el backend antes de que los
// clientes manden token deja la aplicación entera sin poder llamar a nada.
//
// Orden de despliegue seguro:
//   a) registrar el proveedor en la consola,
//   b) poner la variable y desplegar el frontend (los clientes empiezan a mandar
//      token, pero el backend todavía no lo exige),
//   c) observar en la consola de App Check qué porcentaje de peticiones llegan
//      verificadas,
//   d) solo entonces poner `enforceAppCheck: true` en las callables del backend.

import type { FirebaseApp } from "firebase/app";
// Importación ESTÁTICA a propósito. Con `await import(...)` esta función
// retornaba antes de registrar App Check, y Auth y Firestore —que se crean
// justo después, de forma síncrona— quedaban con un proveedor de token vacío.
// Sin exigencia activa no se nota; con exigencia activa, las primeras
// peticiones de cada carga saldrían sin token. App Check debe registrarse
// ANTES que cualquier otro servicio de Firebase.
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

let started = false;

export function initAppCheck(app: FirebaseApp): void {
  if (started) return;
  if (typeof window === "undefined") return;

  const siteKey = process.env.NEXT_PUBLIC_APPCHECK_RECAPTCHA_SITE_KEY;
  if (!siteKey) return;

  started = true;

  try {
    // En desarrollo, la consola imprime un token de depuración que hay que
    // registrar una vez en Firebase para poder trabajar en local.
    if (process.env.NODE_ENV !== "production") {
      (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    // Nunca romper el arranque de la app por la atestación.
    console.warn("[appCheck] no se pudo inicializar:", err);
  }
}
