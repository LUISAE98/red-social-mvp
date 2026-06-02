"use client";

import type { CSSProperties } from "react";

interface PullToRefreshProps {
  pullDistance: number;
  isRefreshing: boolean;
  isReadyToRefresh: boolean;
}

export default function PullToRefresh({
  pullDistance,
  isRefreshing,
  isReadyToRefresh,
}: PullToRefreshProps) {
  const visible = pullDistance > 0 || isRefreshing;

  if (!visible) return null;

  const progress = Math.min(pullDistance / 55, 1);
 const size = 24 + progress * 8;
  const rotation = pullDistance * 4.5;

  return (
    <div
      className="vibraPullRefreshIndicator"
      style={{
        opacity: Math.max(progress, isRefreshing ? 1 : 0),
        transform: `translateY(${Math.min(pullDistance * 0.35, 18)}px)`,
      }}
    >
      <div
        className={[
          "vibraPullRefreshSpinner",
          isRefreshing ? "refreshing" : "",
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
    </div>
  );
}