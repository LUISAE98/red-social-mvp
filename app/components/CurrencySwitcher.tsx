"use client";

// Selector de moneda de visualización. Espeja el diseño/comportamiento del
// LanguageSwitcher (mismas 3 variantes) y se coloca a su lado.

import { useMemo, useState, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useCurrency } from "./CurrencyProvider";
import {
  DISPLAY_CURRENCIES,
  isDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/currency/catalog";
import { currencyLabel } from "@/lib/currency/format";

type Variant = "desktop" | "mobile-bubble" | "cover-corner";

const dropdownBase: React.CSSProperties = {
  background: "rgba(8, 5, 20, 0.97)",
  border: "1px solid rgba(168, 85, 255, 0.28)",
  borderRadius: 10,
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.55)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  width: 208,
};

const listStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxHeight: 300,
  overflowY: "auto",
  overscrollBehavior: "contain",
};

function DropdownItem({
  code,
  name,
  active,
  onSelect,
}: {
  code: DisplayCurrency;
  name: string;
  active: boolean;
  onSelect: (code: DisplayCurrency) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(code)}
      style={{
        width: "100%",
        padding: "9px 12px",
        background: active ? "rgba(168, 85, 255, 0.12)" : "transparent",
        border: "none",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        color: active ? "#a855ff" : "rgba(255,255,255,0.82)",
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        textAlign: "left",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontFamily: "inherit",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.03em",
          color: active ? "#a855ff" : "rgba(255,255,255,0.42)",
          minWidth: 30,
          flexShrink: 0,
        }}
      >
        {code}
      </span>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          textTransform: "capitalize",
        }}
      >
        {name}
      </span>
    </button>
  );
}

export default function CurrencySwitcher({ variant = "desktop" }: { variant?: Variant }) {
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { currency, setCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  // Lista ordenada por nombre localizado.
  const items = useMemo(
    () =>
      DISPLAY_CURRENCIES.map((code) => ({ code, name: currencyLabel(code, locale) })).sort((a, b) =>
        a.name.localeCompare(b.name, locale)
      ),
    [locale]
  );

  function select(next: DisplayCurrency) {
    setOpen(false);
    if (isDisplayCurrency(next)) setCurrency(next);
  }

  const label = currency;
  const list = (
    <div style={listStyle}>
      {items.map((it) => (
        <DropdownItem
          key={it.code}
          code={it.code}
          name={it.name}
          active={it.code === currency}
          onSelect={select}
        />
      ))}
    </div>
  );

  if (variant === "mobile-bubble") {
    return (
      <>
        <style>{`.vb-cur-bubble{display:none}@media(max-width:900px){.vb-cur-bubble{display:block}}`}</style>
        <div
          ref={containerRef}
          className="vb-cur-bubble"
          style={{
            position: "fixed",
            bottom: "calc(72px + env(safe-area-inset-bottom))",
            right: 68,
            zIndex: 200,
          }}
        >
          {open && (
            <div style={{ ...dropdownBase, position: "absolute", bottom: "calc(100% + 8px)", right: 0 }}>
              {list}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title={tCommon("changeCurrency")}
            aria-label={tCommon("changeCurrency")}
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: open ? "rgba(168, 85, 255, 0.18)" : "rgba(8, 5, 20, 0.88)",
              border: "1.5px solid rgba(168, 85, 255, 0.5)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(168, 85, 255, 0.1)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#a855ff",
              fontSize: 10,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.02em",
              transition: "background 140ms ease",
            }}
          >
            {label}
          </button>
        </div>
      </>
    );
  }

  if (variant === "cover-corner") {
    return (
      <>
        <style>{`.vb-cur-corner{display:none}@media(max-width:900px){.vb-cur-corner{display:block}}`}</style>
        <div
          ref={containerRef}
          className="vb-cur-corner"
          style={{ position: "absolute", top: 14, right: 54, zIndex: 40 }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
            title={tCommon("changeCurrency")}
            aria-label={tCommon("changeCurrency")}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
              border: "none",
              color: "#a855ff",
              fontSize: 9.5,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.02em",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(255,255,255,0.016), inset 0 0 11px rgba(168,85,255,0.13), inset 0 0 18px rgba(168,85,255,0.085), inset 0 0 26px rgba(126,34,206,0.065), 0 0 7px rgba(168,85,255,0.05), 0 12px 24px rgba(0,0,0,0.5)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
            }}
          >
            {label}
          </button>
          {open && (
            <div style={{ ...dropdownBase, position: "absolute", top: "calc(100% + 8px)", right: 0 }}>
              {list}
            </div>
          )}
        </div>
      </>
    );
  }

  // desktop
  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={tCommon("changeCurrency")}
        aria-label={tCommon("changeCurrency")}
        style={{
          height: 32,
          padding: "0 11px",
          borderRadius: 8,
          background: "transparent",
          border: "none",
          color: "#a855ff",
          fontSize: 11,
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
      {open && (
        <div style={{ ...dropdownBase, position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200 }}>
          {list}
        </div>
      )}
    </div>
  );
}
