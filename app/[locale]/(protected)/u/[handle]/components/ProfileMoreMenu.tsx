"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";
import { useReport, type ReportTarget } from "@/lib/moderation/useReport";
import ReportModal from "@/app/components/ReportModal/ReportModal";

type Props = {
  viewerUid: string | null | undefined;
  profileUid: string;
  /**
   * Se dispara tras bloquear. Lo usa el chat para marcar además la conversación
   * como bloqueada: el bloqueo de perfil es el canónico, pero las reglas del DM
   * miran el estado del hilo, que es una comprobación mucho más barata que ir a
   * buscar el bloqueo en cada mensaje.
   */
  onBlockSuccess?: () => void;
  onUnblockSuccess?: () => void;
  onUnblockError?: () => void;
  /**
   * Qué se reporta. Por defecto el propio perfil; el chat pasa la CONVERSACIÓN
   * para que moderación vea el hilo, que es lo único que hace juzgable un DM.
   */
  reportTarget?: ReportTarget;
  /** Estilo/clase extra para el botón disparador (⋮), p. ej. círculo de portada. */
  buttonStyle?: CSSProperties;
  buttonClassName?: string;
  /**
   * Acciones propias de quien monta el menú, DEBAJO de bloquear y reportar.
   *
   * Existe para que el chat pueda añadir silenciar y quitar la conversación sin
   * meter en el menú del perfil opciones que allí no significan nada. Recibe el
   * cierre del menú y el estilo de sus renglones, para que lo añadido no se vea
   * de otra familia.
   */
  extraItems?: (helpers: {
    close: () => void;
    itemStyle: CSSProperties;
  }) => React.ReactNode;
};

export default function ProfileMoreMenu({ viewerUid, profileUid, onBlockSuccess, onUnblockSuccess, onUnblockError, buttonStyle, buttonClassName, extraItems }: Props) {
  const tCommon = useTranslations("common");
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);

  const isOwnProfile = !!viewerUid && viewerUid === profileUid;
  const { reportTarget, openReport, closeReport } = useReport();

  const { relationship, loading, block, unblock } = useSocialRelationship(
    viewerUid,
    profileUid
  );

  const closeMenu = useCallback(() => {
    if (menuCloseTimerRef.current !== null) return;
    setMenuClosing(true);
    menuCloseTimerRef.current = setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
      menuCloseTimerRef.current = null;
    }, 360);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      const insidePanel = !!menuPanelRef.current && menuPanelRef.current.contains(target);
      const insideButton = !!menuButtonRef.current && menuButtonRef.current.contains(target);
      if (!insidePanel && !insideButton) closeMenu();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen, closeMenu]);

  useBodyScrollLock(menuOpen);

  if (!viewerUid || isOwnProfile || relationship.isBlockedBy) return null;

  async function handleBlockClick() {
    if (loading) return;
    const confirmed = window.confirm(tCommon("confirmBlockUser"));
    if (!confirmed) return;
    closeMenu();
    await block();
    onBlockSuccess?.();
  }

  async function handleUnblockClick() {
    if (loading) return;
    closeMenu();
    const success = await unblock();
    if (success) {
      onUnblockSuccess?.();
    } else {
      onUnblockError?.();
    }
  }

  const itemStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 46,
    border: "none",
    padding: "11px 16px",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    textAlign: "center",
    cursor: "pointer",
    background: "transparent",
    WebkitTapHighlightColor: "transparent",
    display: "block",
    boxSizing: "border-box",
  };

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        aria-label={tCommon("profileOptions")}
        title={tCommon("options")}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        disabled={loading}
        className={buttonClassName}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: "rgba(255,255,255,0.75)",
          fontSize: 20,
          fontWeight: 900,
          lineHeight: 1,
          cursor: loading ? "not-allowed" : "pointer",
          ...(loading ? { opacity: 0.65 } : {}),
          ...buttonStyle,
        }}
      >
        ⋮
      </button>

      {menuOpen && typeof document !== "undefined" && createPortal(
        <>
          <style>{`
            @keyframes pmFadeIn {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes pmFadeOut {
              from { opacity: 1; }
              to   { opacity: 0; }
            }
            @keyframes pmScaleIn {
              from { opacity: 0; transform: scale(0.92); }
              to   { opacity: 1; transform: scale(1); }
            }
            @keyframes pmScaleOut {
              from { opacity: 1; transform: scale(1); }
              to   { opacity: 0; transform: scale(0.92); }
            }
          `}</style>

          {/* Backdrop */}
          <div
            onClick={() => closeMenu()}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99990,
              background: "rgba(0,0,0,0.50)",
              animation: menuClosing
                ? "pmFadeOut 0.15s ease forwards"
                : "pmFadeIn 0.18s ease",
            }}
          />

          {/* Panel centrado */}
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
              ref={menuPanelRef}
              role="menu"
              style={{
                pointerEvents: "auto",
                width: "min(280px, 88vw)",
                background: "rgba(8,9,11,0.985)",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                overflow: "hidden",
                boxShadow: "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                animation: menuClosing
                  ? "pmScaleOut 0.15s ease forwards"
                  : "pmScaleIn 0.18s ease",
              }}
            >
              {relationship.hasBlocked ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleUnblockClick}
                  disabled={loading}
                  style={{ ...itemStyle, color: "#ff8a8a" }}
                >
                  {tCommon("unblock")}
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleBlockClick}
                  disabled={loading}
                  style={{ ...itemStyle, color: "#ff8a8a" }}
                >
                  {tCommon("block")}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  openReport(
                    reportTarget ?? {
                      targetType: "user",
                      targetId: profileUid,
                      targetOwnerId: profileUid,
                    }
                  );
                }}
                style={{
                  ...itemStyle,
                  color: "#fff",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {tCommon("report")}
              </button>

              {extraItems?.({
                close: closeMenu,
                itemStyle: {
                  ...itemStyle,
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                },
              })}
            </div>
          </div>
        </>,
        document.body
      )}

      {reportTarget && <ReportModal target={reportTarget} onClose={closeReport} />}
    </>
  );
}
