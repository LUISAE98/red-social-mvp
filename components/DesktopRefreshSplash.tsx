"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";
import { hideSplash } from "@/lib/splash";

// Duración mínima que el splash permanece visible (carga inicial y transición a
// login), para que sea un momento de marca y no un parpadeo.
const SPLASH_MIN_MS = 700;

export default function DesktopRefreshSplash() {
  const { loading, authTransitionMode } = useAuth();
  const [minimumTimeDone, setMinimumTimeDone] = useState(false);
  // La pantalla-destino (login/feed/perfil/comunidad) avisó que ya se pintó.
  const [screenReady, setScreenReady] = useState(false);

  // Min-time. Se REINICIA cuando el splash se vuelve a mostrar por una transición
  // a login (al poner minimumTimeDone en false).
  useEffect(() => {
    if (minimumTimeDone) return;
    const timer = window.setTimeout(() => setMinimumTimeDone(true), SPLASH_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [minimumTimeDone]);

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

  // Cualquier transición de sesión (entrar, salir, llegar a login) pasa por
  // `showSplash()`, que ya dejó el splash visible y despachó este evento. Aquí
  // solo reiniciamos la espera: sin esto el splash se apagaría en el siguiente
  // efecto, porque `screenReady` sigue en true de la pantalla anterior.
  useEffect(() => {
    function onAuthSplash() {
      setScreenReady(false);
      setMinimumTimeDone(false);
      // Safety por si la pantalla destino no avisara: no dejar el splash
      // colgado. Login se toma hasta 7 s (espera a que sus primeros videos
      // estén completos, ver useExperienceVideos), así que este tope va por
      // encima: si cortara antes, la espera de login no serviría de nada.
      window.setTimeout(() => setScreenReady(true), 8000);
    }
    window.addEventListener("vibra:auth-splash", onAuthSplash);
    return () => window.removeEventListener("vibra:auth-splash", onAuthSplash);
  }, []);

  useEffect(() => {
    if (!minimumTimeDone) return;
    if (loading) return;
    if (authTransitionMode === "checking") return;
    // No quitamos el splash hasta que la pantalla de fondo ya esté pintada.
    if (!screenReady) return;
    // Ni mientras siga corriendo una transición de sesión: `screenReady` puede
    // llegar de la pantalla que estamos abandonando, y descubrirla a media
    // salida es exactamente el parpadeo que veníamos a quitar.
    if (authTransitionMode === "entering" || authTransitionMode === "exiting") return;

    requestAnimationFrame(hideSplash);
  }, [minimumTimeDone, loading, authTransitionMode, screenReady]);

  return null;
}
