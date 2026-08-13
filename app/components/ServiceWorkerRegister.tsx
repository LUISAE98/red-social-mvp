"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * Registra el service worker de Vibra (solo en producción). Habilita el banner
 * de instalación automático en Android y el arranque offline. No renderiza nada.
 *
 * También escucha al service worker de notificaciones: cuando tocas un aviso con
 * la app ya abierta, ese SW no puede navegar la pestaña por su cuenta
 * (`WindowClient.navigate()` solo vale para ventanas que él controla, y la app
 * se sirve fuera de su scope). Así que manda el destino por `postMessage` y la
 * navegación la hace aquí el router — sin recargar la página.
 */
export default function ServiceWorkerRegister() {
  const router = useRouter();

  // Deep-link de las notificaciones. Fuera del efecto de registro porque debe
  // escuchar también en desarrollo y aunque el SW de PWA no se registre.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.type !== "vibra:navigate") return;
      if (typeof data.link !== "string" || !data.link.startsWith("/")) return;

      router.push(data.link);
    }

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [router]);

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
