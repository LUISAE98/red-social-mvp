"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useAutoScrollHint } from "@/lib/hooks/useAutoScrollHint";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { readyLocaleMeta } from "@/i18n/locales";
import { TextButton } from "@/components/ui/TextButton";

// Solo los idiomas SERVIDOS, derivados de i18n/locales.ts. Ofrecer en el selector
// uno sin archivo de traducción rompería la app al elegirlo.
const LOCALES: { code: Locale; label: string; name: string }[] = readyLocaleMeta().map(
  (m) => ({ code: m.code as Locale, label: m.label, name: m.name })
);

type Variant = "desktop" | "mobile-bubble" | "settings";

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
          height: "var(--vb-alto-pantalla)",
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
          height: "var(--vb-alto-pantalla)",
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
            // Tope de altura + lista con scroll propio: con 23 idiomas la lista
            // se salía de la pantalla. Mismos valores que CurrencySwitcher.
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
          {LOCALES.map((locale, i) => {
            const active = locale.code === currentLocale;
            return (
              <button className="vibra-pop"
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
                <span>{locale.name}</span>
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
    // 🚨 Marca de ELECCIÓN MANUAL 🚨
    //
    // `NEXT_LOCALE` no distingue "lo detecté yo por IP" de "el usuario lo eligió": el
    // middleware la escribe igual en la primera visita, con un año de vigencia. Sin esta
    // marca, una detección automática queda congelada para siempre y alguien que se muda
    // de país sigue viendo el idioma de su primera visita.
    //
    // Con la marca puesta, el middleware deja de refrescar el idioma por geolocalización
    // y respeta la decisión, que es lo que siempre se quiso hacer.
    try {
      document.cookie = `vibra_locale_manual=1; max-age=${60 * 60 * 24 * 365}; path=/; samesite=lax`;
    } catch {
      // Sin cookies el idioma se sigue refrescando por geo: degradación aceptable.
    }
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

/**
 * Fila de Configuración (celular).
 *
 * Solo el "Ver" morado: la etiqueta y el valor actual los pinta la fila que lo
 * envuelve, en `OwnerSidebarSettings`, con el mismo formato que "Cuentas
 * bloqueadas" o "Sesiones activas". Aquí vive únicamente el disparador y el
 * panel que abre, que es el mismo de siempre.
 */
  if (variant === "settings") {
    return (
      <>
        <TextButton
          tone="brand"
          size="sm"
          style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }}
          onClick={handleOpen}
          aria-label={tCommon("changeLanguage")}
        >
          {tCommon("viewLabel")}
        </TextButton>
        {overlay}
      </>
    );
  }

  if (variant === "mobile-bubble") {
    return (
      <>
        <style>{`.vb-lang-bubble{display:none}@media(max-width:900px){.vb-lang-bubble{display:block}}`}</style>
        <div
          className="vb-lang-bubble"
          style={{
            position: "fixed",
            // Centro alineado con el CTA "Iniciar sesión" (42px de alto @ bottom:16):
            // la burbuja mide 53px, así que baja 5.5px para que sus centros coincidan.
            bottom: "calc(10.5px + var(--vb-safe-bottom, 0px))",
            insetInlineEnd: 16,
            zIndex: 200,
          }}
        >
          <button
            type="button"
            onClick={open ? handleClose : handleOpen}
            title={tCommon("changeLanguage")}
            aria-label={tCommon("changeLanguage")}
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
              fontSize: 13,
              fontWeight: 800,
              fontFamily: "inherit",
              letterSpacing: "0.04em",
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
          color: "#a855f7",
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
