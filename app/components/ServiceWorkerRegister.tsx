"use client";

import { useEffect } from "react";

/**
 * Registra el service worker de Vibra (solo en producción). Habilita el banner
 * de instalación automático en Android y el arranque offline. No renderiza nada.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silencioso: si falla el registro, la app sigue funcionando normal.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
