"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";

export default function DesktopRefreshSplash() {
  const { loading, authTransitionMode } = useAuth();
  const [minimumTimeDone, setMinimumTimeDone] = useState(false);
  // La pantalla-destino (login/feed/perfil/comunidad) avisó que ya se pintó.
  const [screenReady, setScreenReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMinimumTimeDone(true);
    }, 800);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onReady = () => setScreenReady(true);
    window.addEventListener("vibra:screen-ready", onReady);
    // Safety: si por alguna razón la pantalla no avisa (ruta no instrumentada),
    // no dejamos el splash colgado indefinidamente.
    const fallback = window.setTimeout(() => setScreenReady(true), 12000);
    return () => {
      window.removeEventListener("vibra:screen-ready", onReady);
      window.clearTimeout(fallback);
    };
  }, []);

  useEffect(() => {
    if (!minimumTimeDone) return;
    if (loading) return;
    if (authTransitionMode === "checking") return;
    // No quitamos el splash hasta que la pantalla de fondo ya esté pintada.
    if (!screenReady) return;

    const splash = document.getElementById("desktop-refresh-splash");

    if (!splash) return;

    requestAnimationFrame(() => {
      splash.classList.add("desktop-refresh-splash-hidden");
    });
  }, [minimumTimeDone, loading, authTransitionMode, screenReady]);

  return null;
}
