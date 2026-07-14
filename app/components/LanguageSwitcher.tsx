"use client";

import { useState, useTransition, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

const LOCALES: { code: Locale; label: string; name: string }[] = [
  { code: "es", label: "ES", name: "Español" },
  { code: "pt-BR", label: "PT", name: "Português" },
  { code: "en", label: "EN", name: "English" },
];

type Variant = "desktop" | "mobile-bubble" | "cover-corner";

const ANIM_CSS = `
  @keyframes vbSwFadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes vbSwFadeOut { from { opacity: 1 } to { opacity: 0 } }
  @keyframes vbSwScaleIn { from { opacity: 0; transform: scale(0.92) } to { opacity: 1; transform: scale(1) } }
  @keyframes vbSwScaleOut { from { opacity: 1; transform: scale(1) } to { opacity: 0; transform: scale(0.92) } }
  @keyframes vbFilterCirclePop { 0% { transform: scale(0.5); } 65% { transform: scale(1.3); } 100% { transform: scale(1); } }
  @keyframes vbFilterCircleUnpop { 0% { transform: scale(1); } 40% { transform: scale(0.7); } 100% { transform: scale(1); } }
`;

function LangOverlay({
  open,
  closing,
  currentLocale,
  onClose,
  onSelect,
}: {
  open: boolean;
  closing: boolean;
  currentLocale: Locale;
  onClose: () => void;
  onSelect: (code: Locale) => void;
}) {
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted || !open) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [mounted, open]);
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
            width: "min(320px, 88vw)",
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
          {LOCALES.map((locale, i) => {
            const active = locale.code === currentLocale;
            return (
              <button
                key={locale.code}
                type="button"
                role="menuitem"
                onClick={() => onSelect(locale.code)}
                style={{
                  width: "100%",
                  border: "none",
                  borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                  background: "transparent",
                  color: active ? "#fff" : "rgba(255,255,255,0.72)",
                  fontSize: 14,
                  fontWeight: active ? 600 : 400,
                  textAlign: "left",
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
                <span>{locale.name}</span>
                <div
                  key={String(active)}
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    border: active ? "none" : "1.5px solid rgba(255,255,255,0.25)",
                    background: active ? "#a855ff" : "transparent",
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
    </>,
    document.body
  );
}

export default function LanguageSwitcher({ variant = "desktop" }: { variant?: Variant }) {
  const tCommon = useTranslations("common");
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);

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

  function switchLocale(next: Locale) {
    handleClose();
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  const label = LOCALES.find((l) => l.code === currentLocale)?.label ?? currentLocale.slice(0, 2).toUpperCase();

  const overlay = (
    <LangOverlay
      open={open}
      closing={closing}
      currentLocale={currentLocale}
      onClose={handleClose}
      onSelect={switchLocale}
    />
  );

  if (variant === "mobile-bubble") {
    return (
      <>
        <style>{`.vb-lang-bubble{display:none}@media(max-width:900px){.vb-lang-bubble{display:block}}`}</style>
        <div
          className="vb-lang-bubble"
          style={{
            position: "fixed",
            bottom: "calc(72px + env(safe-area-inset-bottom))",
            right: 16,
            zIndex: 200,
          }}
        >
          <button
            type="button"
            onClick={open ? handleClose : handleOpen}
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
        {overlay}
      </>
    );
  }

  if (variant === "cover-corner") {
    return (
      <>
        <style>{`.vb-lang-corner{display:none}@media(max-width:900px){.vb-lang-corner{display:block}}`}</style>
        <div
          className="vb-lang-corner"
          style={{ position: "absolute", top: 14, right: 14, zIndex: 40 }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (open) { handleClose(); } else { handleOpen(); } }}
            title={tCommon("changeLanguage")}
            aria-label={tCommon("changeLanguage")}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
              border: "none",
              color: "#a855ff",
              fontSize: 11,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.04em",
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
        </div>
        {overlay}
      </>
    );
  }

  // desktop variant — hidden on mobile via its parent (.desktopHeader display:none at ≤900px)
  return (
    <>
      <button
        type="button"
        onClick={open ? handleClose : handleOpen}
        title={tCommon("changeLanguage")}
        aria-label={tCommon("changeLanguage")}
        style={{
          height: 38,
          padding: "0 16px",
          borderRadius: 8,
          background: "transparent",
          border: "none",
          color: "#a855ff",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.04em",
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
