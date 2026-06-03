"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/app/providers";

export default function DesktopRefreshSplash() {
  const { loading, authTransitionMode } = useAuth();
  const [minimumTimeDone, setMinimumTimeDone] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMinimumTimeDone(true);
    }, 1200);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!minimumTimeDone) return;
    if (loading) return;
    if (authTransitionMode === "checking") return;

    const splash = document.getElementById("desktop-refresh-splash");

    if (!splash) return;

    requestAnimationFrame(() => {
      splash.classList.add("desktop-refresh-splash-hidden");
    });
  }, [minimumTimeDone, loading, authTransitionMode]);

  return null;
}