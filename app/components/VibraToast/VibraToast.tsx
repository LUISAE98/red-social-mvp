"use client";

import { createPortal } from "react-dom";
import type { ToastState } from "@/lib/hooks/useVibraToast";

type Props = {
  toast: ToastState;
};

export default function VibraToast({ toast }: Props) {
  if (!toast) return null;

  return createPortal(
    <>
      <style>{`
        @keyframes vibraToastExpand {
          0%   { opacity: 0; max-width: 46px; }
          18%  { opacity: 1; max-width: 46px; }
          70%  { opacity: 1; max-width: 480px; }
          100% { opacity: 1; max-width: 480px; }
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
      `}</style>
      <div
        style={{
          position: "fixed",
          bottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 11500,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 18px 10px 10px",
          borderRadius: 40,
          background: "#0a0a0a",
          border: `1.5px solid ${
            toast.type === "success"
              ? "rgba(34,197,94,0.35)"
              : toast.type === "error"
              ? "rgba(239,68,68,0.35)"
              : "rgba(255,255,255,0.14)"
          }`,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          color: "#fff",
          fontSize: 14,
          fontWeight: 500,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          maxWidth: "calc(100vw - 32px)",
          animation: "vibraToastExpand 500ms cubic-bezier(0.4,0,0.2,1) forwards",
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
              toast.type === "success"
                ? "#22c55e"
                : toast.type === "error"
                ? "#ef4444"
                : "#6b7280",
            animation: "vibraToastIconPop 420ms cubic-bezier(0.34,1.56,0.64,1) forwards",
          }}
        >
          {toast.type === "success" ? (
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M2.5 7L5 9.5L10.5 3.5"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : toast.type === "error" ? (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 2L9 9M9 2L2 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 800, lineHeight: 1, color: "#fff" }}>!</span>
          )}
        </span>
        <span style={{ animation: "vibraToastText 500ms ease forwards" }}>{toast.text}</span>
      </div>
    </>,
    document.body
  );
}
