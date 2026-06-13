import { useEffect, useRef } from "react";

/**
 * Fades the mobile header in/out based on scroll direction.
 * Uses a passive scroll listener + rAF — zero React re-renders during scroll.
 * Only activates on viewports ≤ 768px.
 */
export function useMobileHeaderFade() {
  const headerRef = useRef<HTMLElement>(null);
  const safeAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 768px)").matches) return;

    const header = headerRef.current;
    const safeArea = safeAreaRef.current;

    let lastY = window.scrollY;
    let hidden = false;
    let rafId: number | null = null;

    function show() {
      if (hidden) {
        hidden = false;
        if (header) { header.style.opacity = "1"; header.style.pointerEvents = ""; }
        if (safeArea) safeArea.style.opacity = "1";
      }
    }

    function hide() {
      if (!hidden) {
        hidden = true;
        if (header) { header.style.opacity = "0"; header.style.pointerEvents = "none"; }
        if (safeArea) safeArea.style.opacity = "0";
      }
    }

    function update() {
      rafId = null;
      const y = window.scrollY;
      const delta = y - lastY;
      lastY = y;

      // Always visible near the top
      if (y < 8) { show(); return; }

      if (delta > 3) hide();
      else if (delta < -3) show();
    }

    function onScroll() {
      if (rafId === null) rafId = requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (header) { header.style.opacity = ""; header.style.pointerEvents = ""; }
      if (safeArea) safeArea.style.opacity = "";
    };
  }, []);

  return { headerRef, safeAreaRef };
}
