"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

const LOCALES: { code: Locale; label: string; name: string }[] = [
  { code: "es", label: "ES", name: "Español" },
  { code: "en", label: "EN", name: "English" },
  { code: "pt-BR", label: "PT", name: "Português" },
];

type Variant = "desktop" | "mobile-bubble";

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
  width: 132,
};

function DropdownItem({
  locale,
  current,
  onSelect,
}: {
  locale: (typeof LOCALES)[number];
  current: string;
  onSelect: (code: Locale) => void;
}) {
  const active = locale.code === current;
  return (
    <button
      key={locale.code}
      type="button"
      onClick={() => onSelect(locale.code)}
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
        gap: 7,
        fontFamily: "inherit",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: active ? "#a855ff" : "rgba(255,255,255,0.42)",
          minWidth: 22,
          flexShrink: 0,
        }}
      >
        {locale.label}
      </span>
      {locale.name}
    </button>
  );
}

export default function LanguageSwitcher({ variant = "desktop" }: { variant?: Variant }) {
  const tCommon = useTranslations("common");
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
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

  function switchLocale(next: Locale) {
    setOpen(false);
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  const label = LOCALES.find((l) => l.code === currentLocale)?.label ?? currentLocale.slice(0, 2).toUpperCase();

  if (variant === "mobile-bubble") {
    return (
      <>
        <style>{`.vb-lang-bubble{display:none}@media(max-width:900px){.vb-lang-bubble{display:block}}`}</style>
        <div
          ref={containerRef}
          className="vb-lang-bubble"
          style={{
            position: "fixed",
            bottom: "calc(72px + env(safe-area-inset-bottom))",
            right: 16,
            zIndex: 200,
          }}
        >
          {open && (
            <div
              style={{
                ...dropdownBase,
                position: "absolute",
                bottom: "calc(100% + 8px)",
                right: 0,
              }}
            >
              {LOCALES.map((l) => (
                <DropdownItem key={l.code} locale={l} current={currentLocale} onSelect={switchLocale} />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title={tCommon("changeLanguage")}
            aria-label={tCommon("changeLanguage")}
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
              fontSize: 11,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.04em",
              transition: "background 140ms ease",
            }}
          >
            {label}
          </button>
        </div>
      </>
    );
  }

  // desktop variant — hidden on mobile via its parent (.desktopHeader display:none at ≤900px)
  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Cambiar idioma"
        aria-label="Cambiar idioma"
        style={{
          height: 32,
          padding: "0 11px",
          borderRadius: 8,
          background: open ? "rgba(168, 85, 255, 0.12)" : "rgba(255, 255, 255, 0.06)",
          border: "1px solid rgba(168, 85, 255, 0.28)",
          color: "rgba(255, 255, 255, 0.85)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.04em",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
          transition: "background 140ms ease",
        }}
      >
        {label}
      </button>
      {open && (
        <div
          style={{
            ...dropdownBase,
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 200,
          }}
        >
          {LOCALES.map((l) => (
            <DropdownItem key={l.code} locale={l} current={currentLocale} onSelect={switchLocale} />
          ))}
        </div>
      )}
    </div>
  );
}
