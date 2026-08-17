"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { TextButton } from "@/components/ui";
import { Link } from "@/i18n/navigation";
import { useAuth } from "@/app/providers";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useSelfHandle } from "@/lib/hooks/useSelfHandle";
import { useWalletVisibility } from "@/lib/wallet/useWalletVisibility";
import { usePendingExperiences } from "@/lib/wallet/usePendingExperiences";
import { useExperiencesSeen } from "@/lib/experiences/useExperiencesSeen";
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { AppNotification, isExperienceNotification } from "@/lib/notifications/types";
import NotificationList from "./NotificationList";
import NotificationTabs, { type NotifTab } from "./NotificationTabs";
import ExperienceRequestsInbox from "./ExperienceRequestsInbox";

interface NotificationBellProps {
  active?: boolean;
}

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
  // El subnav aparece solo mientras haya experiencias vivas (por atender o
  // agendadas). `useWalletVisibility` (cacheado) filtra a los vendedores antes de
  // abrir listeners; el conteo de pendientes decide mostrarlo/ocultarlo.
  const { hasWallet } = useWalletVisibility(user?.uid ?? null);
  const { hasPending, count: experienceCount, latestMs: expLatestMs, pendingMsList } =
    usePendingExperiences(hasWallet ? user?.uid ?? null : null);
  const { seenAt: expSeenAt, markSeen: markExpSeen } = useExperiencesSeen(
    hasWallet ? user?.uid ?? null : null
  );
  // Cuántas experiencias son NUEVAS (sin ver) — NO el total pendiente. Así, tras
  // ver 3 y llegar 1 más, el badge marca 1, no 4.
  const newExperiencesCount = useMemo(
    () => pendingMsList.filter((ms) => ms > expSeenAt).length,
    [pendingMsList, expSeenAt]
  );
  const hasNewExperiences = newExperiencesCount > 0;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<NotifTab | null>(null);
  const [decidedTab, setDecidedTab] = useState<NotifTab | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  // Un overlay de detalle (saludo/sesión) abierto desde Experiencias: ocultamos
  // el panel para no estorbar, pero sin desmontarlo (el overlay vive dentro).
  const [detailOpen, setDetailOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<PanelPos>({ top: 64, right: 16 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

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
      // Con un overlay de detalle abierto, el panel está oculto: no cerrar por
      // clics fuera (serían clics dentro del overlay) para no desmontarlo.
      if (detailOpen) return;
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (detailOpen) return;
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, detailOpen]);

  const handleItemClick = (n: AppNotification) => {
    if (!n.read) markRead(n.id);
    setOpen(false);
  };

  // El badge de la campanita avisa por lo social (colección notifications) Y por
  // experiencias nuevas sin ver (saludos/consejos comprados, sesiones por
  // atender) — que se cuentan aparte, vía `greetingRequests`/sesiones. Sin esto,
  // vender un saludo no encendía la campanita (nunca escribe en notifications).
  const alertCount = badgeCount + newExperiencesCount;
  const badge = alertCount > 99 ? "99+" : String(alertCount);

  // Subnav: solo si hay experiencias pendientes.
  const showSubnav = hasPending;

  // Al abrir el panel se decide la pestaña por prioridad (una vez): hay
  // experiencias nuevas → Experiencias (prioridad); si no, hay sociales nuevas →
  // Sociales; si no hay nada nuevo → Experiencias. Se resetea al cerrar para que
  // el próximo abrir vuelva a decidir. La elección manual (`tab`) manda.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDecidedTab(null);
      setTab(null);
      return;
    }
    if (decidedTab !== null) return;
    setDecidedTab(
      !hasPending
        ? "social"
        : hasNewExperiences
          ? "experiences"
          : badgeCount > 0
            ? "social"
            : "experiences"
    );
  }, [open, decidedTab, hasPending, hasNewExperiences, badgeCount]);

  const activeTab: NotifTab = tab ?? decidedTab ?? (showSubnav ? "experiences" : "social");

  // Abrir el panel marca visto TODO lo que había, las dos pestañas a la vez.
  // Antes se marcaba solo la pestaña activa: como el panel abre en una sola, la
  // otra conservaba su cuenta para siempre y el punto rojo volvía en cada sesión
  // aunque no hubiera llegado nada nuevo. Las experiencias se marcan hasta el
  // timestamp de servidor más reciente, para que cuenten solo las posteriores.
  // Espera a que la pestaña por defecto esté decidida: marcar antes pondría los
  // contadores en 0 y la prioridad (Experiencias nuevas → Sociales nuevas) se
  // decidiría siempre sobre cero.
  useEffect(() => {
    if (!open || decidedTab === null) return;
    markSeen();
    markExpSeen(expLatestMs);
  }, [open, decidedTab, markSeen, markExpSeen, expLatestMs]);

  const visibleItems = useMemo(() => {
    if (showSubnav && activeTab === "experiences") {
      return items.filter(isExperienceNotification);
    }
    return items;
  }, [items, showSubnav, activeTab]);

  // Cambiar de pestaña desliza el contenido (mismas keyframes que el nav de rutas).
  const changeTab = (next: NotifTab) => {
    if (next === activeTab) return;
    const order: NotifTab[] = ["experiences", "social"];
    setSlideDir(order.indexOf(next) > order.indexOf(activeTab) ? "right" : "left");
    setTab(next);
  };

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
        {alertCount > 0 ? <span className="notifBadge">{badge}</span> : null}
      </button>

      {mounted && open
        ? createPortal(
            <div
              ref={panelRef}
              className="notifPanel"
              role="dialog"
              aria-label={t("title")}
              style={{
                top: pos.top,
                insetInlineEnd: pos.right,
                ...(detailOpen ? { display: "none" } : {}),
              }}
            >
              <div className="notifPanelHead">
                <span className="notifPanelTitle">{t("title")}</span>
                {unreadCount > 0 ? (
                  <TextButton tone="brand" className="notifMarkAll" onClick={() => markAllRead()}>
                    {t("markAllRead")}
                  </TextButton>
                ) : null}
              </div>
              {showSubnav ? (
                <NotificationTabs
                  activeTab={activeTab}
                  onChange={changeTab}
                  compact
                  counts={{ social: badgeCount, experiences: experienceCount }}
                />
              ) : null}
              <div className="notifPanelScroll">
                <div
                  className="notifPanelSlide"
                  key={activeTab}
                  data-nav-enter={showSubnav && slideDir ? slideDir : undefined}
                >
                  {showSubnav && activeTab === "experiences" ? (
                    <ExperienceRequestsInbox
                      uid={user?.uid ?? null}
                      emptyLabel={t("emptyExperiences")}
                      onDetailOpenChange={(isOpen) => {
                        if (isOpen) {
                          setDetailOpen(true);
                        } else {
                          // Al cerrar el overlay, cerramos también el panel.
                          setDetailOpen(false);
                          setOpen(false);
                        }
                      }}
                    />
                  ) : (
                    <NotificationList
                      items={visibleItems}
                      loading={loading}
                      onItemClick={handleItemClick}
                      selfHandle={selfHandle}
                    />
                  )}
                </div>
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
          inset-inline-end: 0;
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
        /* El aspecto sale de TextButton; aquí solo queda el subrayado al pasar. */
        .notifMarkAll:hover {
          text-decoration: underline;
        }
        .notifPanelScroll {
          max-height: min(60vh, 460px);
          overflow-y: auto;
          overflow-x: hidden;
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
