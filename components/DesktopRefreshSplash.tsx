"use client";

import { useEffect } from "react";

export default function DesktopRefreshSplash() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const splash = document.getElementById("desktop-refresh-splash");

      if (splash) {
        splash.classList.add("desktop-refresh-splash-hidden");
      }
    }, 1200);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}