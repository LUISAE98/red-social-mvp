"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void> | void;
  threshold?: number;
  enabled?: boolean;
}

function getElasticPullDistance(rawDistance: number, threshold: number) {
  if (rawDistance <= 0) return 0;

  const activationDistance = threshold / 0.72;

  if (rawDistance <= activationDistance) {
    return rawDistance * 0.72;
  }

  const extra = rawDistance - activationDistance;
  const resistedExtra = Math.sqrt(extra) * 4.2;

  return threshold + resistedExtra;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 55,
  enabled = true,
}: UsePullToRefreshOptions) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const startYRef = useRef<number | null>(null);
  const startXRef = useRef<number | null>(null);
  // Eje bloqueado del gesto: "x" (scroll horizontal, p.ej. el filtro de canales) o
  // "y" (pull vertical). Se decide en el primer movimiento claro y no cambia hasta
  // soltar → si arrastras en X no se mueve la página en Y, y viceversa.
  const axisRef = useRef<"x" | "y" | null>(null);
  const pullingRef = useRef(false);
  const refreshingRef = useRef(false);
  const readyToRefreshRef = useRef(false);

  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const reset = useCallback(() => {
    startYRef.current = null;
    startXRef.current = null;
    axisRef.current = null;
    pullingRef.current = false;
    readyToRefreshRef.current = false;
    setPullDistance(0);
  }, []);

  const executeRefresh = useCallback(async () => {
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    setIsRefreshing(true);
    setPullDistance(threshold);

    try {
      await onRefresh();
    } catch (error) {
      console.error("[PullToRefresh]", error);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
        refreshingRef.current = false;
        reset();
      }, 450);
    }
  }, [onRefresh, reset, threshold]);

  useEffect(() => {
    const container = containerRef.current;

    if (!container || !enabled) return;

const TOP_TOLERANCE = 2;

const getScrollTop = () => {
  const containerScrollTop = container.scrollTop || 0;

  const pageScrollTop =
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;

  return Math.max(containerScrollTop, pageScrollTop);
};

const canStartPull = () => {
  return getScrollTop() <= TOP_TOLERANCE && !refreshingRef.current;
};

    const handleTouchStart = (event: TouchEvent) => {
      if (!canStartPull()) return;

      startYRef.current = event.touches[0]?.clientY ?? null;
      startXRef.current = event.touches[0]?.clientX ?? null;
      axisRef.current = null;
      pullingRef.current = startYRef.current !== null;
      readyToRefreshRef.current = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!pullingRef.current) return;
      if (startYRef.current === null) return;
      if (refreshingRef.current) return;

      const currentY = event.touches[0]?.clientY ?? 0;
      const currentX = event.touches[0]?.clientX ?? 0;
      const rawDistance = currentY - startYRef.current;
      const dx = Math.abs(currentX - (startXRef.current ?? currentX));
      const dy = Math.abs(rawDistance);

      // Axis-lock: en el primer movimiento claro (>6px) decide el eje. Si el gesto
      // es horizontal (scroll del filtro/carrusel), NO es pull → no tocar la página
      // en Y. Una vez bloqueado, no cambia hasta soltar.
      if (axisRef.current === null && Math.max(dx, dy) > 6) {
        axisRef.current = dx > dy ? "x" : "y";
      }
      if (axisRef.current === "x") return;

      if (rawDistance <= 0) return;

      if (getScrollTop() > TOP_TOLERANCE) {
        reset();
        return;
      }

      // Don't block scroll until the user has clearly committed to a pull gesture.
      // Android touch has more jitter than iOS — a 1-2px upward wobble at the
      // start of a downward scroll fires rawDistance > 0 and would otherwise
      // call preventDefault(), killing the entire scroll gesture.
      if (rawDistance < 8) return;

      event.preventDefault();

      const elasticDistance = getElasticPullDistance(
        rawDistance,
        threshold
      );

      setPullDistance(elasticDistance);
      readyToRefreshRef.current = elasticDistance >= threshold;
    };

    const handleTouchEnd = () => {
      if (refreshingRef.current) return;

      if (readyToRefreshRef.current) {
        void executeRefresh();
        return;
      }

      reset();
    };


    container.addEventListener("touchstart", handleTouchStart, {
      passive: true,
    });

    container.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });

    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);


    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [enabled, executeRefresh, reset, threshold]);

  return {
    containerRef,
    pullDistance,
    isRefreshing,
    isReadyToRefresh: pullDistance >= threshold || isRefreshing,
  };
}