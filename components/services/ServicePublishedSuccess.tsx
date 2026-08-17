"use client";

import React, { useState } from "react";

import { IconButton } from "@/components/ui";
/**
 * Vista de éxito que se muestra DENTRO del panel de una experiencia una vez
 * publicada: círculo verde con paloma blanca que aparece con un "pop", el
 * mensaje de confirmación y un botón para copiar el link (perfil o comunidad).
 *
 * Se renderiza como contenido del OverlayModal (con `hideFooter`), de modo que
 * solo quedan el fondo y el título del panel.
 */
export default function ServicePublishedSuccess({
  message,
  shareUrl,
  copyLabel,
  copiedLabel,
}: {
  message: string;
  shareUrl: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Fallback para navegadores sin permiso de clipboard.
      const el = document.createElement("textarea");
      el.value = shareUrl;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand("copy");
      } catch {
        /* noop */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      style={{
        display: "grid",
        justifyItems: "center",
        gap: 18,
        padding: "26px 8px 14px",
        textAlign: "center",
        animation: "vibraSuccessFadeIn 260ms ease both",
      }}
    >
      <style jsx>{`
        @keyframes vibraSuccessFadeIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes vibraCheckPop {
          0% {
            transform: scale(0);
            opacity: 0;
          }
          60% {
            transform: scale(1.15);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        @keyframes vibraCheckDraw {
          to {
            stroke-dashoffset: 0;
          }
        }
        .vibraSuccessCheckPath {
          stroke-dasharray: 30;
          stroke-dashoffset: 30;
          animation: vibraCheckDraw 300ms ease 260ms forwards;
        }
      `}</style>

      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: "#22c55e",
          display: "grid",
          placeItems: "center",
          animation: "vibraCheckPop 440ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        }}
      >
        <svg
          width="21"
          height="21"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path className="vibraSuccessCheckPath" d="M4 12.5l5 5L20 6.5" />
        </svg>
      </div>

      <div
        style={{
          fontSize: 14,
          lineHeight: 1.5,
          color: "rgba(255,255,255,0.92)",
          maxWidth: 360,
        }}
      >
        {message}
      </div>

      <IconButton label={copied ? copiedLabel : copyLabel} size="sm" tone="bare" shape="square" onClick={copy}>
        {copied ? (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </IconButton>
    </div>
  );
}
