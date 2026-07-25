"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/app/providers";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useSelfHandle } from "@/lib/hooks/useSelfHandle";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { AppNotification, isExperienceNotification } from "@/lib/notifications/types";
import NotificationList from "./NotificationList";

interface NotificationBellProps {
  active?: boolean;
}

type NotifTab = "experiences" | "social";

interface PanelPos {
  top: number;
  right: number;
}

/**
 * Campanita del header de escritorio. Al hacer clic despliega un panel flotante
 * con las notificaciones agregadas; muestra un badge con el conteo de no leídas.
 *
 * El panel se monta con un portal en `document.body` y posición `fixed`: así
 * escapa por completo del stacking context / pointer-events del header sticky
 * (que de otro modo atraparía un dropdown posicionado en absoluto).
 */
export default function NotificationBell({ active }: NotificationBellProps) {
  const t = useTranslations("notifications");
  const { user } = useAuth();
  const { items, unreadCount, badgeCount, loading, markSeen, markAllRead, markRead } =
    useNotifications(user?.uid ?? null);
  const selfHandle = useSelfHandle(user?.uid ?? null);
  // "Vende experiencias" → habilita el subnav de dos pestañas (prioridad a Experiencias).
  const { hasWallet: sellsExperiences } = useWalletVisibility(user?.uid ?? null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotifTab | null>(null);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<PanelPos>({ top: 64, right: 16 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Abrir el contenedor marca todo como "visto" → baja el badge a 0 (sin marcar
  // como leído: cada ítem sigue no-leído hasta abrirlo).
  useEffect(() => {
    if (open) markSeen();
  }, [open, markSeen]);

  const reposition = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };

  // Posiciona el panel antes del paint al abrir y lo mantiene pegado al botón.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const onScroll = () => reposition();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleItemClick = (n: AppNotification) => {
    if (!n.read) markRead(n.id);
    setOpen(false);
  };

  const badge = badgeCount > 99 ? "99+" : String(badgeCount);

  // Subnav: solo si vende experiencias; Experiencias es la pestaña por defecto.
  const showSubnav = sellsExperiences;
  const activeTab: NotifTab = tab ?? (showSubnav ? "experiences" : "social");
  const visibleItems = useMemo(() => {
    if (showSubnav && activeTab === "experiences") {
      return items.filter(isExperienceNotification);
    }
    return items;
  }, [items, showSubnav, activeTab]);

  return (
    <div className="notifBellWrap">
      <button
        ref={btnRef}
        type="button"
        aria-label={t("title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={["desktopActionIcon", "notifBellBtn", active ? "desktopActionIconActive" : ""]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setOpen((v) => !v)}
      >
        <VibraNavigationIcon type="notifications" size={22} strokeWidth={2.2} />
        {badgeCount > 0 ? <span className="notifBadge">{badge}</span> : null}
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={panelRef}
              className="notifPanel"
              role="dialog"
              aria-label={t("title")}
              style={{ top: pos.top, right: pos.right }}
            >
              <div className="notifPanelHead">
                <span className="notifPanelTitle">{t("title")}</span>
                {unreadCount > 0 ? (
                  <button type="button" className="notifMarkAll" onClick={() => markAllRead()}>
                    {t("markAllRead")}
                  </button>
                ) : null}
              </div>
              {showSubnav ? (
                <div className="notifPanelTabs" role="tablist" aria-label={t("title")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "experiences"}
                    className={
                      activeTab === "experiences"
                        ? "notifPanelTab notifPanelTabActive"
                        : "notifPanelTab"
                    }
                    onClick={() => setTab("experiences")}
                  >
                    {t("tabs.experiences")}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "social"}
                    className={
                      activeTab === "social"
                        ? "notifPanelTab notifPanelTabActive"
                        : "notifPanelTab"
                    }
                    onClick={() => setTab("social")}
                  >
                    {t("tabs.social")}
                  </button>
                </div>
              ) : null}
              <div className="notifPanelScroll">
                <NotificationList
                  items={visibleItems}
                  loading={loading}
                  onItemClick={handleItemClick}
                  selfHandle={selfHandle}
                  emptyLabel={
                    showSubnav && activeTab === "experiences"
                      ? t("emptyExperiences")
                      : undefined
                  }
                />
              </div>
              <Link href="/notifications" className="notifViewAll" onClick={() => setOpen(false)}>
                {t("viewAll")}
              </Link>
            </div>,
            document.body
          )
        : null}

      <style jsx>{`
        .notifBellWrap {
          position: relative;
          display: inline-flex;
        }
        .notifBellBtn {
          position: relative;
          background: transparent;
          border: none;
          cursor: pointer;
          pointer-events: auto;
        }
        .notifBadge {
          position: absolute;
          top: 2px;
          right: 0;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          border-radius: 999px;
          background: #ff3b30;
          color: #fff;
          font-size: 10px;
          font-weight: 800;
          line-height: 16px;
          text-align: center;
          box-shadow: 0 0 0 2px #000;
          pointer-events: none;
        }
        .notifPanel {
          position: fixed;
          width: 380px;
          max-width: calc(100vw - 32px);
          background: #0d0d0d;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 14px;
          box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
          overflow: hidden;
          z-index: 100000;
        }
        .notifPanelHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .notifPanelTitle {
          font-size: 16px;
          font-weight: 600;
          color: #fff;
        }
        .notifMarkAll {
          background: transparent;
          border: none;
          color: #a855ff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .notifMarkAll:hover {
          text-decoration: underline;
        }
        .notifPanelTabs {
          display: flex;
          gap: 20px;
          padding: 0 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .notifPanelTab {
          position: relative;
          padding: 9px 2px 11px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.5);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: color 140ms ease;
        }
        .notifPanelTab::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: -1px;
          height: 2px;
          border-radius: 2px;
          background: #a855ff;
          opacity: 0;
          transition: opacity 140ms ease;
        }
        .notifPanelTab:hover:not(.notifPanelTabActive) {
          color: rgba(255, 255, 255, 0.8);
        }
        .notifPanelTabActive {
          color: #fff;
        }
        .notifPanelTabActive::after {
          opacity: 1;
        }
        .notifPanelScroll {
          max-height: min(60vh, 460px);
          overflow-y: auto;
        }
        .notifPanel :global(.notifState) {
          padding: 32px 16px;
          text-align: center;
          color: rgba(255, 255, 255, 0.45);
          font-size: 14px;
        }
        .notifPanel :global(.notifViewAll) {
          display: block;
          padding: 12px;
          text-align: center;
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          text-decoration: none;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .notifPanel :global(.notifViewAll:hover) {
          background: rgba(255, 255, 255, 0.05);
        }
      `}</style>
    </div>
  );
}
