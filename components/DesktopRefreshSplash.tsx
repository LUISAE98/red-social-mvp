"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";
import { hideSplash } from "@/lib/splash";

/**
 * Duración mínima que el splash permanece visible.
 *
 * Estuvo en 700 ms para que la marca fuera un momento y no un parpadeo. Se bajó
 * a cero el 2026-09-03, dentro del trabajo de rendimiento: en cuanto la app deje
 * de tardar más que eso, ese suelo pasa a ser LA espera visible — la pantalla ya
 * estaría lista y el splash seguiría tapándola.
 *
 * Bajarlo a cero NO deja la pantalla al aire. El splash no se quita solo por
 * agotar este tiempo: el efecto de más abajo exige además que la sesión esté
 * resuelta y que la pantalla de destino haya avisado de que ya se pintó
 * (`vibra:screen-ready`). Lo único que se quita aquí es la espera artificial.
 */
const SPLASH_MIN_MS = 0;

/**
 * Cuánto se espera a una pantalla que NO avisa de que ya pintó.
 *
 * 🚨 Estuvo en 12 SEGUNDOS, y eso no era una red de seguridad: era un cuelgue.
 *
 * `useScreenReady` es opt-in por pantalla, y solo lo llaman siete: inicio,
 * reels (×2), perfil, comunidad, express y login. Cualquier otra se queda
 * esperando aquí hasta que salte este respaldo. El caso que lo destapó: tocar
 * la notificación de un mensaje abre `/mensajes/<id>`, que no avisa — así que
 * entrar desde un aviso significaba mirar el splash doce segundos.
 *
 * Que sea opt-in tiene sentido —hay pantallas que prefieren retener el splash
 * hasta tener contenido, como login con sus videos— pero el precio de olvidarse
 * no puede ser ese. Con este tope, una pantalla sin instrumentar enseña el
 * splash un instante y sigue; las instrumentadas lo quitan antes, en cuanto
 * pintan.
 *
 * ⚠️ Al añadir una pantalla nueva a la que se pueda llegar desde una
 * notificación o un enlace directo, llamar a `useScreenReady()`. Esto es el
 * suelo, no el camino previsto.
 */
const SPLASH_FALLBACK_MS = 1500;

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
    // Respaldo para las rutas que no avisan. Ver SPLASH_FALLBACK_MS.
    const fallback = window.setTimeout(() => setScreenReady(true), SPLASH_FALLBACK_MS);
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
