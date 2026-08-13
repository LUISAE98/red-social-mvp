"use client";

// Selector de moneda de visualización. Espeja el diseño/comportamiento del
// LanguageSwitcher (mismas 3 variantes) y se coloca a su lado.

import { useMemo, useState, useEffect, useRef } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useAutoScrollHint } from "@/lib/hooks/useAutoScrollHint";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { useCurrency } from "./CurrencyProvider";
import {
  DISPLAY_CURRENCIES,
  isDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/currency/catalog";
import { currencyLabel } from "@/lib/currency/format";

type Variant = "desktop" | "mobile-bubble" | "cover-corner";

const ANIM_CSS = `
  @keyframes vbSwFadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes vbSwFadeOut { from { opacity: 1 } to { opacity: 0 } }
  @keyframes vbSwScaleIn { from { opacity: 0; transform: scale(0.92) } to { opacity: 1; transform: scale(1) } }
  @keyframes vbSwScaleOut { from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(0.92) } }
  @keyframes vbFilterCirclePop { 0% { transform: scale(0.5); } 65% { transform: scale(1.3); } 100% { transform: scale(1); } }
  @keyframes vbFilterCircleUnpop { 0% { transform: scale(1); } 40% { transform: scale(0.7); } 100% { transform: scale(1); } }
`;

function CurrencyOverlay({
  open,
  closing,
  currency,
  items,
  onClose,
  onSelect,
}: {
  open: boolean;
  closing: boolean;
  currency: DisplayCurrency;
  items: { code: DisplayCurrency; name: string }[];
  onClose: () => void;
  onSelect: (code: DisplayCurrency) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  useBodyScrollLock(mounted && open);
  useAutoScrollHint(scrollRef, mounted && open);
  if (!mounted || !open) return null;

  return createPortal(
    <>
      <style>{ANIM_CSS}</style>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99990,
          background: "rgba(0,0,0,0.50)",
          animation: closing ? "vbSwFadeOut 0.15s ease forwards" : "vbSwFadeIn 0.18s ease",
        }}
      />
      {/* Centering container */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99991,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          role="menu"
          style={{
            pointerEvents: "auto",
            width: "min(340px, 88vw)",
            maxHeight: "min(480px, 80vh)",
            display: "flex",
            flexDirection: "column",
            background: "rgba(8,9,11,0.985)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            overflow: "hidden",
            boxShadow: "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            animation: closing
              ? "vbSwScaleOut 0.15s ease forwards"
              : "vbSwScaleIn 0.18s ease",
          }}
        >
          <div
            ref={scrollRef}
            style={{
              overflowY: "auto",
              overscrollBehavior: "contain",
              flex: 1,
            }}
          >
            {items.map((it, i) => {
              const active = it.code === currency;
              return (
                <button
                  key={it.code}
                  type="button"
                  role="menuitem"
                  onClick={() => onSelect(it.code)}
                  style={{
                    width: "100%",
                    border: "none",
                    borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                    background: "transparent",
                    color: active ? "#fff" : "rgba(255,255,255,0.72)",
                    fontSize: 14,
                    fontWeight: active ? 600 : 400,
                    textAlign: "start",
                    cursor: "pointer",
                    minHeight: 48,
                    padding: "11px 16px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                        color: active ? "#c084fc" : "rgba(255,255,255,0.38)",
                        flexShrink: 0,
                        minWidth: 30,
                      }}
                    >
                      {it.code}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        textTransform: "capitalize",
                      }}
                    >
                      {it.name}
                    </span>
                  </span>
                  <div
                    key={String(active)}
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      border: active ? "none" : "1.5px solid rgba(255,255,255,0.25)",
                      background: active ? "#a855f7" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      animation: active
                        ? "vbFilterCirclePop 0.28s cubic-bezier(0.34,1.56,0.64,1) forwards"
                        : "vbFilterCircleUnpop 0.18s ease forwards",
                    }}
                  >
                    {active && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6L5 9L10 3" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

export default function CurrencySwitcher({
  variant = "desktop",
  color,
  scale = 1,
}: {
  variant?: Variant;
  /** Override del color del texto en el variant desktop (por defecto morado). */
  color?: string;
  /** Escala del botón en el variant desktop (1 = tamaño base). */
  scale?: number;
}) {
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { currency, setCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const items = useMemo(
    () =>
      DISPLAY_CURRENCIES.map((code) => ({ code, name: currencyLabel(code, locale) })).sort((a, b) =>
        a.name.localeCompare(b.name, locale)
      ),
    [locale]
  );

  function handleOpen() {
    setOpen(true);
    setClosing(false);
  }

  function handleClose() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 150);
  }

  function select(next: DisplayCurrency) {
    handleClose();
    if (isDisplayCurrency(next)) setCurrency(next);
  }

  const label = currency;

  const overlay = (
    <CurrencyOverlay
      open={open}
      closing={closing}
      currency={currency}
      items={items}
      onClose={handleClose}
      onSelect={select}
    />
  );

  if (variant === "mobile-bubble") {
    return (
      <>
        <style>{`.vb-cur-bubble{display:none}@media(max-width:900px){.vb-cur-bubble{display:block}}`}</style>
        <div
          className="vb-cur-bubble"
          style={{
            position: "fixed",
            // Centro alineado con el CTA "Iniciar sesión" (42px de alto @ bottom:16):
            // la burbuja mide 53px, así que baja 5.5px para que sus centros coincidan.
            bottom: "calc(10.5px + var(--vb-safe-bottom, 0px))",
            insetInlineEnd: 77,
            zIndex: 200,
          }}
        >
          <button
            type="button"
            onClick={open ? handleClose : handleOpen}
            title={tCommon("changeCurrency")}
            aria-label={tCommon("changeCurrency")}
            style={{
              width: 53,
              height: 53,
              borderRadius: "50%",
              // Sin contenedor: fondo y contorno transparentes (sin sombra ni
              // blur). Solo queda el texto morado; un text-shadow sutil lo
              // mantiene legible sobre el collage sin volver a crear una "caja".
              background: "transparent",
              border: "none",
              boxShadow: "none",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#a855f7",
              fontSize: 12,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.02em",
              textShadow: "0 1px 3px rgba(0,0,0,0.6)",
              opacity: open ? 0.75 : 1,
              transition: "opacity 140ms ease",
            }}
          >
            {label}
          </button>
        </div>
        {overlay}
      </>
    );
  }

  if (variant === "cover-corner") {
    return (
      <>
        <style>{`.vb-cur-corner{display:none}@media(max-width:900px){.vb-cur-corner{display:block}}`}</style>
        <div
          className="vb-cur-corner"
          style={{ position: "absolute", top: 14, insetInlineEnd: 54, zIndex: 40 }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (open) { handleClose(); } else { handleOpen(); }
            }}
            title={tCommon("changeCurrency")}
            aria-label={tCommon("changeCurrency")}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
              border: "none",
              color: "#a855f7",
              fontSize: 9.5,
              fontWeight: 600,
              fontFamily: "inherit",
              letterSpacing: "0.02em",
              cursor: "pointer",
              opacity: 0.85,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.05), inset 0 -1px 0 rgba(255,255,255,0.02), 0 12px 24px rgba(0,0,0,0.5)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            {label}
          </button>
        </div>
        {overlay}
      </>
    );
  }

  // desktop
  return (
    <>
      <button
        type="button"
        onClick={open ? handleClose : handleOpen}
        title={tCommon("changeCurrency")}
        aria-label={tCommon("changeCurrency")}
        style={{
          height: 38 * scale,
          padding: `0 ${16 * scale}px`,
          borderRadius: 8,
          background: "transparent",
          border: "none",
          color: color ?? "#a855f7",
          fontSize: 13 * scale,
          fontWeight: 700,
          letterSpacing: "0.03em",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
          transition: "opacity 140ms ease",
          opacity: open ? 0.75 : 1,
        }}
      >
        {label}
      </button>
      {overlay}
    </>
  );
}
