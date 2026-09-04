"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import type { ToastState } from "@/lib/hooks/useVibraToast";

/**
 * Aviso flotante de Vibra.
 *
 * No es una caja: es el fondo de la pantalla el que se oscurece de abajo hacia
 * arriba, y sobre él aparecen el icono y el texto en el color del aviso. Un
 * contenedor con borde competía con el contenido y siempre se veía pegado
 * encima; así el aviso sale de la propia pantalla.
 *
 * El icono y el texto entran y salen con un pop, pero el degradado NO: entra y
 * se va más lento y sin rebote. Si el fondo se quitara de golpe, el aviso se
 * sentiría como un corte en vez de como algo que se apaga.
 */

/** Lo que tarda el degradado en apagarse. Manda sobre la salida completa. */
const EXIT_MS = 440;

const COLORES = {
  success: "#4ade80",
  error: "#f87171",
  warning: "rgba(255,255,255,0.78)",
  // Informativo: no ha ido mal ni hay nada que revisar, solo se está contando algo.
  info: "rgba(255,255,255,0.62)",
} as const;

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

  const color = COLORES[visible.type] ?? COLORES.warning;

  return createPortal(
    <>
      <style>{`
        /* El fondo. Entra y se va suave, sin rebote: es atmósfera, no un
           elemento que aparezca. */
        @keyframes vibraToastVeilIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes vibraToastVeilOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }

        /* El icono y el texto sí: pop de entrada con rebote corto. */
        @keyframes vibraToastPopIn {
          0%   { opacity: 0; transform: scale(0.55); }
          55%  { opacity: 1; transform: scale(1.12); }
          78%  { transform: scale(0.97); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes vibraToastPopOut {
          0%   { opacity: 1; transform: scale(1); }
          30%  { transform: scale(1.08); }
          100% { opacity: 0; transform: scale(0.6); }
        }

        @media (prefers-reduced-motion: reduce) {
          .vibra-toast-veil,
          .vibra-toast-icon,
          .vibra-toast-text {
            animation-duration: 1ms !important;
          }
        }
      `}</style>

      <div
        className="vibra-toast-veil"
        role="status"
        aria-live="polite"
        style={{
          position: "fixed",
          insetInlineStart: 0,
          insetInlineEnd: 0,
          bottom: "calc(0px - var(--vb-lienzo-extra))",
          // Alto generoso: el degradado necesita recorrido para apagarse sin
          // que se vea el canto donde termina.
          height: 260,
          zIndex: 2147483647,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
          paddingBottom: "calc(72px + var(--vb-safe-bottom, 0px))",
          background:
            "linear-gradient(to top, rgba(0,0,0,0.94) 0%, rgba(0,0,0,0.86) 28%, rgba(0,0,0,0.52) 62%, rgba(0,0,0,0) 100%)",
          animation: leaving
            ? `vibraToastVeilOut ${EXIT_MS}ms cubic-bezier(0.4, 0, 0.6, 1) forwards`
            : "vibraToastVeilIn 320ms cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        <span
          className="vibra-toast-icon"
          aria-hidden="true"
          style={{
            display: "block",
            color,
            animation: leaving
              ? "vibraToastPopOut 260ms cubic-bezier(0.4, 0, 1, 1) forwards"
              : "vibraToastPopIn 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
          }}
        >
          {visible.type === "success" ? (
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
              <path
                d="M4.5 12.5L9.5 17.5L19.5 7"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : visible.type === "info" ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="6.4" r="1.5" fill="currentColor" />
              <path
                d="M12 10.5V18.5"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          ) : visible.type === "error" ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 5.5V13.5"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <circle cx="12" cy="18.2" r="1.5" fill="currentColor" />
            </svg>
          )}
        </span>

        <span
          className="vibra-toast-text"
          style={{
            color,
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.35,
            letterSpacing: "-0.01em",
            textAlign: "center",
            maxWidth: "min(420px, calc(100vw - 48px))",
            wordBreak: "break-word",
            textShadow: "0 1px 10px rgba(0,0,0,0.6)",
            // Un pelín después que el icono: se lee "pasó algo" y luego "esto".
            animation: leaving
              ? "vibraToastPopOut 260ms cubic-bezier(0.4, 0, 1, 1) forwards"
              : "vibraToastPopIn 420ms cubic-bezier(0.34, 1.56, 0.64, 1) 70ms both",
          }}
        >
          {visible.text}
        </span>
      </div>
    </>,
    document.body
  );
}
