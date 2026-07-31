"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { ToastState } from "@/lib/hooks/useVibraToast";

const EXIT_MS = 300;

type Props = {
  toast: ToastState;
};

export default function VibraToast({ toast }: Props) {
  const [visible, setVisible] = useState<ToastState>(toast);
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast) {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setLeaving(false);
      setVisible(toast);
    } else if (visible) {
      setLeaving(true);
      leaveTimer.current = setTimeout(() => {
        setVisible(null);
        setLeaving(false);
      }, EXIT_MS);
    }
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  if (!visible) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes vibraToastExpand {
          0%   { opacity: 0; clip-path: inset(0 100% 0 0 round 40px); }
          18%  { opacity: 1; clip-path: inset(0 calc(100% - 46px) 0 0 round 40px); }
          70%  { opacity: 1; clip-path: inset(0 0% 0 0 round 40px); }
          100% { opacity: 1; clip-path: inset(0 0% 0 0 round 40px); }
        }
        @keyframes vibraToastIconPop {
          0%   { transform: scale(0.4); opacity: 0; }
          40%  { transform: scale(1.15); opacity: 1; }
          65%  { transform: scale(0.92); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes vibraToastText {
          0%, 40% { opacity: 0; }
          80%     { opacity: 1; }
          100%    { opacity: 1; }
        }
        @keyframes vibraToastFadeOut {
          0%   { opacity: 1; transform: scale(1) translateY(0px); }
          100% { opacity: 0; transform: scale(0.86) translateY(8px); }
        }
      `}</style>
      {/* Outer wrapper: only positioning — never animated so transform doesn't conflict */}
      <div
        style={{
          position: "fixed",
          bottom: "calc(88px + var(--vb-safe-bottom, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 2147483647,
          pointerEvents: "none",
        }}
      >
        {/* Inner pill: entry + exit animations without translateX */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 18px 10px 10px",
            borderRadius: 40,
            background: "#0a0a0a",
            border: `1.5px solid ${
              visible.type === "success"
                ? "rgba(34,197,94,0.35)"
                : visible.type === "error"
                ? "rgba(239,68,68,0.35)"
                : "rgba(255,255,255,0.14)"
            }`,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 500,
            width: "max-content",
            maxWidth: "calc(100vw - 48px)",
            animation: leaving
              ? `vibraToastFadeOut ${EXIT_MS}ms cubic-bezier(0.4,0,1,1) forwards`
              : "vibraToastExpand 500ms cubic-bezier(0.4,0,0.2,1) forwards",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              background:
                visible.type === "success"
                  ? "#22c55e"
                  : visible.type === "error"
                  ? "#ef4444"
                  : "#6b7280",
              animation: leaving
                ? "none"
                : "vibraToastIconPop 420ms cubic-bezier(0.34,1.56,0.64,1) forwards",
            }}
          >
            {visible.type === "success" ? (
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M2.5 7L5 9.5L10.5 3.5"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : visible.type === "error" ? (
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M2 2L9 9M9 2L2 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1, color: "#fff" }}>!</span>
            )}
          </span>
          <span style={{
            animation: leaving ? "none" : "vibraToastText 500ms ease forwards",
            wordBreak: "break-word",
          }}>
            {visible.text}
          </span>
        </div>
      </div>
    </>,
    document.body
  );
}
