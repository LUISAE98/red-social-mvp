"use client";

import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import type { Post } from "@/lib/posts/types";
import { useTranslations } from "next-intl";

type PostPaymentPanelProps = {
  open: boolean;
  post: Post;
  currentUserId?: string | null;
  isMobile?: boolean;
  onPay: () => void;
  onClose: () => void;
};

const fontStack =
  'inherit';

const dividerStyle: CSSProperties = {
  height: 1,
  background: "rgba(255,255,255,0.07)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const titleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#fff",
  letterSpacing: "-0.01em",
};

const closeButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.7)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
};

const priceRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const priceLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "rgba(255,255,255,0.54)",
  fontWeight: 500,
};

const priceAmountStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 800,
  color: "#a855f7",
  letterSpacing: "-0.02em",
};

const warnBoxStyle: CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(255,200,0,0.18)",
  background: "rgba(255,180,0,0.07)",
  padding: "10px 12px",
  fontSize: 11.5,
  color: "rgba(255,230,150,0.88)",
  lineHeight: 1.5,
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
};

const warnIconStyle: CSSProperties = {
  flexShrink: 0,
  marginTop: 1,
  fontSize: 14,
};

const payButtonStyle: CSSProperties = {
  width: "100%",
  height: 46,
  border: "none",
  borderRadius: 12,
  background: "linear-gradient(135deg, #4f46ff, #a855ff, #ff2fb3)",
  color: "#fff",
  fontSize: 15,
  fontWeight: 700,
  fontFamily: fontStack,
  cursor: "pointer",
  letterSpacing: "-0.01em",
};

const sheetBase: CSSProperties = {
  background: "#111",
  border: "1px solid rgba(255,255,255,0.09)",
  padding: "20px 20px 32px",
  fontFamily: fontStack,
  display: "grid",
  gap: 16,
};

function formatPrice(price: number | null | undefined, currency: string | null | undefined): string {
  if (!price) return "—";
  const cur = currency ?? "MXN";
  return `$${price.toLocaleString("es-MX")} ${cur}`;
}

export default function PostPaymentPanel({
  open,
  post,
  currentUserId,
  isMobile = false,
  onPay,
  onClose,
}: PostPaymentPanelProps) {
  const tCommon = useTranslations("common");

  if (!open || typeof document === "undefined") return null;

  const isGuest = !currentUserId;
  const price = formatPrice(post.oneTimePrice, post.currency);

  const overlayStyle: CSSProperties = isMobile
    ? {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }
    : {
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      };

  const sheetStyle: CSSProperties = isMobile
    ? {
        ...sheetBase,
        width: "100%",
        maxWidth: 480,
        borderRadius: "18px 18px 0 0",
        borderBottom: "none",
        animation: "vibraPaySlideUp 280ms cubic-bezier(0.32, 0.72, 0, 1)",
      }
    : {
        ...sheetBase,
        width: "100%",
        maxWidth: 400,
        borderRadius: 18,
        animation: "vibraPayFadeIn 220ms cubic-bezier(0.2, 0, 0, 1)",
      };

  return createPortal(
    <>
      <style>{`
        @keyframes vibraPaySlideUp {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes vibraPayFadeIn {
          from { opacity: 0; transform: scale(0.96) translateY(6px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-pay-sheet { animation: none !important; }
        }
      `}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Desbloquear contenido premium"
        style={overlayStyle}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="vibra-pay-sheet" style={sheetStyle}>
          <div style={headerStyle}>
            <span style={titleStyle}>Desbloquear contenido</span>
            <button
              type="button"
              onClick={onClose}
              aria-label={tCommon("closeAriaLabel")}
              style={closeButtonStyle}
            >
              ✕
            </button>
          </div>

          <div style={dividerStyle} />

          <div style={priceRowStyle}>
            <span style={priceLabelStyle}>Acceso único al contenido</span>
            <span style={priceAmountStyle}>{price}</span>
          </div>

          {isGuest && (
            <>
              <div style={warnBoxStyle}>
                <span style={warnIconStyle}>⚠️</span>
                <span>
                  No estás registrado. El acceso quedará guardado en este dispositivo y navegador. Si borras el caché o usas otro navegador, <strong>perderás el acceso</strong>.
                </span>
              </div>

              <div style={warnBoxStyle}>
                <span style={warnIconStyle}>💬</span>
                <span>
                  No podrás comentar ni dar like en este post aunque pagues el desbloqueo.
                </span>
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              onPay();
              onClose();
            }}
            style={payButtonStyle}
          >
            Pagar {price}
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
