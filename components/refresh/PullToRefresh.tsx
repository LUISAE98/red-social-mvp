"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

interface PullToRefreshProps {
  pullDistance: number;
  isRefreshing: boolean;
  isReadyToRefresh: boolean;
  indicatorTop?: string;
}

export default function PullToRefresh({
  pullDistance,
  isRefreshing,
  isReadyToRefresh,
  indicatorTop,
}: PullToRefreshProps) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  const visible = pullDistance > 0 || isRefreshing;

  if (!visible || !mounted) return null;

  const progress = Math.min(pullDistance / 55, 1);
  const size = 24 + progress * 8;
  const rotation = pullDistance * 4.5;

  return createPortal(
    <div
      className="vibraPullRefreshIndicator"
      style={{
        position: "fixed",
        top: indicatorTop ?? "calc(env(safe-area-inset-top) + 20px)",
        insetInlineStart: 0,
        insetInlineEnd: 0,
        zIndex: 99999,
        opacity: Math.max(progress, isRefreshing ? 1 : 0),
        transform: `translateY(${Math.min(pullDistance * 0.35, 18)}px)`,
        pointerEvents: "none",
      }}
    >
      <div
        className={[
          "vibraPullRefreshSpinner",
          isRefreshing ? "refreshing" : "",
          isReadyToRefresh ? "ready" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          {
            width: size,
            height: size,
            transform: `rotate(${rotation}deg)`,
            "--vibra-pull-rotation": `${rotation}deg`,
          } as CSSProperties
        }
        aria-label="Actualizando"
      />
    </div>,
    document.body
  );
}
