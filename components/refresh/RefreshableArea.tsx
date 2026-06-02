"use client";

import { ReactNode } from "react";
import PullToRefresh from "./PullToRefresh";
import { usePullToRefresh } from "./usePullToRefresh";

interface RefreshableAreaProps {
  children: ReactNode;
  onRefresh: () => Promise<void> | void;
  className?: string;
  threshold?: number;
  enabled?: boolean;
}

export default function RefreshableArea({
  children,
  onRefresh,
  className = "",
  threshold = 55,
  enabled = true,
}: RefreshableAreaProps) {
  const {
    containerRef,
    pullDistance,
    isRefreshing,
    isReadyToRefresh,
  } = usePullToRefresh({
    onRefresh,
    threshold,
    enabled,
  });

  const contentOffset = enabled
    ? isRefreshing
      ? 68
      : pullDistance
    : 0;

  return (
    <div
      ref={containerRef}
      className={`vibraPullRefreshArea ${className}`}
    >
      {enabled && (
        <PullToRefresh
          pullDistance={contentOffset}
          isRefreshing={isRefreshing}
          isReadyToRefresh={isReadyToRefresh}
        />
      )}

      <div
        className="vibraPullRefreshContent"
        style={{
          transform:
            contentOffset > 0
              ? `translateY(${contentOffset}px)`
              : "translateY(0px)",
          transition:
            isRefreshing || contentOffset === 0
              ? "transform 0.22s ease"
              : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}