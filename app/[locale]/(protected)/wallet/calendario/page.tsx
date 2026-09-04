"use client";

import Image from "next/image";
import { IconButton } from "@/components/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { useAuth } from "@/app/providers";
import {
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";
import { useWalletMoney } from "@/lib/wallet/useWalletMoney";
import { useCreatorNetRate } from "@/lib/wallet/useCreatorNetRate";
import { useWalletData } from "../components/WalletDataContext";
import { proposeExclusiveSessionSchedule } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { proposeMeetGreetSchedule } from "@/lib/meetGreet/meetGreetRequests";
import SessionRequestOverlay from "@/app/components/OwnerSidebar/SessionRequestOverlay";
import type { MeetGreetRequestDoc } from "@/app/components/OwnerSidebar/OwnerSidebar";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  WalletCard,
  WALLET_CARD_PAD,
} from "../components/WalletUi";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type CalendarViewMode = "calendar" | "list";

type CalendarMonthItem = {
  key: string;
  label: string;
  firstDate: Date;
};

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function getMonthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function getMonthLabel(date: Date, locale: string): string {
  const month = new Intl.DateTimeFormat(locale, {
    month: "long",
  }).format(date);
  return `${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
}

function getWeekdayInitials(locale: string): string[] {
  const baseDate = new Date(2024, 0, 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() + i);
    return d.toLocaleString(locale, { weekday: "narrow" }).toUpperCase();
  });
}

function getMonthDaysMatrix(monthDate: Date): Date[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1);
  const jsDay = firstDayOfMonth.getDay();
  const mondayBasedOffset = jsDay === 0 ? 6 : jsDay - 1;

  const gridStart = new Date(year, month, 1 - mondayBasedOffset);
  const days: Date[] = [];

  for (let i = 0; i < 42; i += 1) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }

  return days;
}

function buildMonthWindow(baseDate: Date, locale: string): CalendarMonthItem[] {
  return Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(baseDate, index);
    return {
      key: getMonthKey(date),
      label: getMonthLabel(date, locale),
      firstDate: date,
    };
  });
}

function isSafeCalendarItem(item: WalletServiceItem): boolean {
  if (!item.scheduledAt) return false;

  if (
    item.status === "rejected" ||
    item.status === "refund_requested" ||
    item.status === "refund_review" ||
    item.status === "cancelled" ||
    item.status === "completed"
  ) {
    return false;
  }

  return (
    item.status === "scheduled" ||
    item.status === "ready_to_prepare" ||
    item.status === "in_preparation"
  );
}

function groupEventsByDay(items: WalletServiceItem[]): Map<string, WalletServiceItem[]> {
  const map = new Map<string, WalletServiceItem[]>();

  items.forEach((item) => {
    if (!isSafeCalendarItem(item) || !item.scheduledAt) return;
    const key = getDayKey(item.scheduledAt);
    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
  });

  return map;
}

function sortEventsBySchedule(items: WalletServiceItem[]): WalletServiceItem[] {
  return [...items]
    .filter(isSafeCalendarItem)
    .sort((a, b) => {
      const aTime = a.scheduledAt?.getTime() ?? 0;
      const bTime = b.scheduledAt?.getTime() ?? 0;
      return aTime - bTime;
    });
}

function formatSelectedDayLabel(dayKey: string | null, locale: string): string {
  if (!dayKey) return "";

  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);

  const label = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);

  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getDayCountLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

function ViewModeIconButton({
  mode,
  onClick,
}: {
  mode: CalendarViewMode;
  onClick: () => void;
}) {
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const isList = mode === "list";

  return (
    <>
      <style jsx>{`
        .button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: none;
          background: none;
          color: #a855f7;
          cursor: pointer;
          padding: 0;
          transition: color 0.15s ease;
        }

        .button:hover {
          color: #c084fc;
        }

        .button:active {
          transform: scale(0.95);
        }
      `}</style>

      <IconButton label={isList ? tWallet("viewCalendarAriaLabel") : tWallet("viewListAriaLabel")} size="md" tone="bare" shape="square" className="button" onClick={onClick}>
        {isList ? (
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        ) : (
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="3" cy="6" r="1" fill="currentColor" stroke="none" />
            <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none" />
            <circle cx="3" cy="18" r="1" fill="currentColor" stroke="none" />
          </svg>
        )}
      </IconButton>
    </>
  );
}

function formatScheduledShort(date: Date | null, locale: string): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}



type ServiceCardTheme = {
  bgImage: string | null;
  btnBg: string;
  btnColor: string;
};

function getServiceCardTheme(kind: string): ServiceCardTheme {
  switch (kind) {
    case "saludo":
      return { bgImage: "/saludo.webp", btnBg: "rgba(168,85,247,0.22)", btnColor: "#d8b4fe" };
    case "consejo":
      return { bgImage: "/consejo.webp", btnBg: "rgba(250,204,21,0.20)", btnColor: "#fde047" };
    case "meet_greet":
      return { bgImage: "/encuentroenvivo.webp", btnBg: "rgba(29,78,216,0.28)", btnColor: "#93c5fd" };
    case "exclusive_session":
      return { bgImage: "/sesionexclusiva.webp", btnBg: "rgba(190,24,93,0.28)", btnColor: "#f9a8d4" };
    default:
      return { bgImage: null, btnBg: "rgba(168,85,247,0.22)", btnColor: "#d8b4fe" };
  }
}

function CalendarEventCard({
  item,
  onView,
  inOverlay = false,
}: {
  item: WalletServiceItem;
  onView: () => void;
  inOverlay?: boolean;
}) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  // Dinero del CREADOR, en USD o en su moneda según el switch de la wallet.
  // Formateador único: ver `useWalletMoney`.
  const { formatMoney } = useWalletMoney();
  const { netRate } = useCreatorNetRate();
  const initial = (item.buyerDisplayName ?? "U").charAt(0).toUpperCase();

  // Variante para lives: informativa, sin comprador. La portada del live es el
  // fondo de la card (o /live.webp por defecto). No abre overlay de sesión.
  if (item.kind === "live") {
    const dateLabel = item.scheduledAt
      ? (() => {
          const l = new Intl.DateTimeFormat(locale, {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(item.scheduledAt);
          return l.charAt(0).toUpperCase() + l.slice(1);
        })()
      : "";
    const timeLabel = item.liveOpenSchedule
      ? "Horario abierto"
      : item.scheduledAt
        ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(item.scheduledAt)
        : "";
    const cover = item.sourceAvatarUrl || "/live.webp";
    const initial = (item.buyerDisplayName ?? "?").charAt(0).toUpperCase();
    return (
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          // De lado a lado y sin esquinas, como las demas listas de la wallet.
          borderRadius: 0,
          padding: `13px ${WALLET_CARD_PAD}px`,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: `linear-gradient(rgba(8,8,10,0.72), rgba(8,8,10,0.72)), url(${cover}) center / cover no-repeat`,
        }}
      >
        {item.buyerAvatarUrl ? (
          <Image
            src={item.buyerAvatarUrl}
            alt=""
            width={40}
            height={40}
            style={{
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
              border: "1px solid rgba(255,255,255,0.25)",
              position: "relative",
              zIndex: 1,
            }}
          />
        ) : (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              flexShrink: 0,
              background: "rgba(255,255,255,0.14)",
              border: "1px solid rgba(255,255,255,0.25)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
              position: "relative",
              zIndex: 1,
            }}
          >
            {initial}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
          <div
            style={{
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.title}
          </div>
          <div
            style={{
              color: "rgba(255,255,255,0.72)",
              fontSize: 11,
              lineHeight: 1.3,
              marginTop: 3,
            }}
          >
            {[dateLabel, timeLabel].filter(Boolean).join(" · ")}
          </div>
        </div>

        <div
          style={{
            flexShrink: 0,
            position: "relative",
            zIndex: 1,
            textAlign: "center",
            textShadow: "0 1px 4px rgba(0,0,0,0.55)",
          }}
        >
          <div
            style={{
              color: "#fff",
              fontWeight: 500,
              fontSize: 19,
              letterSpacing: "0.06em",
              whiteSpace: "nowrap",
              lineHeight: 1.1,
            }}
          >
            EN VIVO
          </div>
          <div
            style={{
              color: "#fff",
              fontWeight: 500,
              fontSize: 10,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
          >
            programado
          </div>
        </div>
      </div>
    );
  }

  const theme = getServiceCardTheme(item.kind);

  return (
    <>
      <style jsx>{`
        /* A sangre y sin radio: el margen lateral lo pone la propia fila con
           su relleno, que vale lo mismo que el del contenedor de seccion. */
        .calEvCard {
          position: relative;
          overflow: hidden;
          border-radius: 0;
          padding: 13px ${WALLET_CARD_PAD}px;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        @media (max-width: 640px) {
          .calEvCard { cursor: pointer; }
          .calEvCardBtn { display: none !important; }
          .calEvCardChevron { display: flex !important; }
        }
      `}</style>
    <div
      className="calEvCard"
      onClick={onView}
      style={{
        background: theme.bgImage
          ? `linear-gradient(rgba(8,8,10,0.78), rgba(8,8,10,0.78)), url(${theme.bgImage}) center / cover no-repeat`
          : "rgba(255,255,255,0.04)",
      }}
    >
      {item.buyerAvatarUrl ? (
        <Image
          src={item.buyerAvatarUrl}
          alt={item.buyerDisplayName ?? ""}
          width={40}
          height={40}
          style={{
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
            border: "1px solid rgba(255,255,255,0.14)",
            position: "relative",
            zIndex: 1,
          }}
        />
      ) : (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            flexShrink: 0,
            background: "rgba(255,255,255,0.09)",
            border: "1px solid rgba(255,255,255,0.14)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: 14,
            color: "#fff",
            position: "relative",
            zIndex: 1,
          }}
        >
          {initial}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: "#fff",
              fontWeight: 600,
              fontSize: 13,
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 1,
            }}
          >
            {item.buyerDisplayName ?? tWallet("userFallback")}
          </span>
          {item.priceSnapshot != null ? (
            <span
              style={{
                color: "#86efac",
                fontWeight: 600,
                fontSize: 11,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              +{formatMoney(Math.round(item.priceSnapshot * netRate * 100) / 100, { code: true })}
            </span>
          ) : null}
        </div>
        <div
          style={{
            color: "rgba(255,255,255,0.48)",
            fontSize: 11,
            lineHeight: 1.3,
            marginTop: 3,
          }}
        >
          {item.scheduledAt
            ? (() => {
                const label = new Intl.DateTimeFormat(locale, {
                  weekday: "long", day: "numeric", month: "long", year: "numeric",
                }).format(item.scheduledAt);
                return label.charAt(0).toUpperCase() + label.slice(1);
              })()
            : tWallet("noDate")}
        </div>
      </div>

      <button
        className="calEvCardBtn"
        type="button"
        onClick={(e) => { e.stopPropagation(); onView(); }}
        style={{
          flexShrink: 0,
          width: 148,
          height: 32,
          borderRadius: 8,
          border: "none",
          background: theme.btnBg,
          color: theme.btnColor,
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
          position: "relative",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {tWallet("viewRequest")}
      </button>
      <span className="calEvCardChevron" style={{ display: "none", flexShrink: 0, color: theme.btnColor, alignItems: "center", justifyContent: "center", position: "relative", zIndex: 1 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </div>
    </>
  );
}

const PANEL_CLOSE_THRESHOLD = 130;

function applyPanelOffset(raw: number): number {
  if (raw >= 0) return Math.min(window.innerHeight, raw);
  return raw * 0.2;
}

function EventsOverlay({
  open,
  title,
  items,
  onClose,
  onViewItem,
}: {
  open: boolean;
  title: string;
  items: WalletServiceItem[];
  onClose: () => void;
  onViewItem: (item: WalletServiceItem) => void;
}) {
  const tCommon = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startY: 0, startOffset: 0 });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const mq = window.matchMedia("(max-width: 900px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsClosing(false);
      setShouldRender(true);
      setPanelOffsetY(0);
    } else {
      setIsClosing(true);
      const t = setTimeout(() => setShouldRender(false), 280);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    setIsDragging(true);
    dragRef.current = { startY: e.clientY, startOffset: panelOffsetY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLElement>) {
    if (!isDragging) return;
    const delta = e.clientY - dragRef.current.startY;
    setPanelOffsetY(applyPanelOffset(dragRef.current.startOffset + delta));
  }

  function handlePointerUp() {
    if (!isDragging) return;
    setIsDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      onClose();
    } else {
      setPanelOffsetY(0);
    }
  }

  if (!mounted || !shouldRender) return null;

  const panelTransition = isDragging
    ? "none"
    : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";

  return createPortal(
    <>
      <style jsx global>{`
        @keyframes vibraCalDesktopIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes vibraCalDesktopOut {
          from { opacity: 1; transform: scale(1) translateY(0); }
          to   { opacity: 0; transform: scale(0.94) translateY(10px); }
        }
        .vibra-panel-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .vibra-panel-scroll::-webkit-scrollbar-track { background: transparent; }
        .vibra-panel-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.18);
          border-radius: 999px;
        }
        .vibra-panel-mobile-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .vibra-panel-mobile-scroll::-webkit-scrollbar-track { background: transparent; }
        .vibra-panel-mobile-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.18);
          border-radius: 999px;
        }
      `}</style>

      {isMobile ? (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
          style={{
            position: "fixed",
            inset: 0,
            height: "var(--vb-alto-pantalla)",
            zIndex: 2147483647,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 0,
            background: isClosing ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.52)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            fontFamily: "inherit",
            transition: "background 260ms",
          }}
        >
          {/* panel-outer: entry/exit + drag-close + fills rubber-band gap */}
          <div
            style={{
              width: "100%",
              maxHeight: "calc(var(--vb-alto-pantalla) - 72px)",
              display: "flex",
              flexDirection: "column",
              background: "rgba(8,9,11,0.96)",
              paddingBottom: "var(--vb-safe-bottom, 0px)",
              transform: isClosing
                ? "translateY(100%)"
                : `translateY(${Math.max(0, panelOffsetY)}px)`,
              transition: panelTransition,
              willChange: "transform",
            }}
          >
            {/* section-wrapper: rubber-band toward top only */}
            <div
              style={{
                transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
                transition: panelTransition,
              }}
            >
              <section
                style={{
                  maxHeight: "calc(var(--vb-alto-pantalla) - 140px)",
                  borderRadius: "22px 22px 0 0",
                  background: "rgba(8,9,11,0.96)",
                  boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
                  color: "#fff",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <header
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{
                    height: 56,
                    display: "grid",
                    gridTemplateColumns: "72px 1fr 72px",
                    alignItems: "center",
                    padding: "0 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    flexShrink: 0,
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  }}
                >
                  <div aria-hidden="true" />
                  <h3
                    style={{
                      margin: 0,
                      textAlign: "center",
                      fontSize: 17,
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      lineHeight: 1.2,
                      color: "#fff",
                    }}
                  >
                    {title}
                  </h3>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={tCommon("closeAriaLabel")}
                    style={{
                      width: 40,
                      height: 40,
                      border: "none",
                      background: "transparent",
                      color: "rgba(255,255,255,0.86)",
                      cursor: "pointer",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 32,
                      fontWeight: 300,
                      lineHeight: 1,
                      justifySelf: "end",
                    }}
                  >
                    ×
                  </button>
                </header>

                <div
                  className="vibra-panel-mobile-scroll"
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    minHeight: 0,
                    padding: "12px 0 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {items.filter(isSafeCalendarItem).map((item) => (
                    <CalendarEventCard
                      key={`${item.source}-${item.id}`}
                      item={item}
                      onView={() => onViewItem(item)}
                      inOverlay
                    />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : (
        <div
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
          style={{
            position: "fixed",
            inset: 0,
            height: "var(--vb-alto-pantalla)",
            zIndex: 2147483647,
            background: "rgba(0,0,0,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "inherit",
          }}
        >
          <section
            style={{
              width: "min(100%, 540px)",
              maxHeight: "min(88vh, 680px)",
              display: "flex",
              flexDirection: "column",
              borderRadius: 18,
              background: "#0a0a0a",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
              color: "#fff",
              overflow: "hidden",
              animation: isClosing
                ? "vibraCalDesktopOut 180ms ease-in forwards"
                : "vibraCalDesktopIn 180ms ease-out",
            }}
          >
            <div
              style={{
                height: 56,
                display: "grid",
                gridTemplateColumns: "48px 1fr 48px",
                alignItems: "center",
                padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.12)",
                flexShrink: 0,
              }}
            >
              <div aria-hidden="true" />
              <h3
                style={{
                  margin: 0,
                  fontSize: 17,
                  lineHeight: 1.2,
                  fontWeight: 500,
                  color: "#fff",
                  textAlign: "center",
                  letterSpacing: "-0.02em",
                }}
              >
                {title}
              </h3>
              <IconButton label={tCommon("closeAriaLabel")} size="sm" tone="bare" shape="square" style={{ placeItems: "center", justifySelf: "end" }} onClick={onClose}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </IconButton>
            </div>

            <div
              className="vibra-panel-scroll"
              style={{
                flex: 1,
                overflowY: "auto",
                minHeight: 0,
                padding: "12px 0 8px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {items.filter(isSafeCalendarItem).map((item) => (
                <CalendarEventCard
                  key={`${item.source}-${item.id}`}
                  item={item}
                  onView={() => onViewItem(item)}
                  inOverlay
                />
              ))}
            </div>
          </section>
        </div>
      )}
    </>,
    document.body
  );
}






function MonthCard({
  month,
  eventsByDay,
  onSelectDay,
  onSelectMonth,
}: {
  month: CalendarMonthItem;
  eventsByDay: Map<string, WalletServiceItem[]>;
  onSelectDay: (dayKey: string) => void;
  onSelectMonth: (monthKey: string) => void;
}) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const previewDays = getMonthDaysMatrix(month.firstDate);
  const monthEventDays = new Set(
    Array.from(eventsByDay.keys()).filter((key) => key.startsWith(`${month.key}-`))
  );
  const monthEventCount = Array.from(monthEventDays).reduce(
    (sum, key) => sum + (eventsByDay.get(key)?.length ?? 0),
    0
  );
  const hasMonthEvents = monthEventCount > 0;

  return (
    <>
      <style jsx>{`
        .monthCard {
          width: 100%;
          border: none;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 18px;
          padding: 12px;
          box-sizing: border-box;
        }

        .monthHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .monthTitle {
          margin: 0;
          font-size: 15px;
          line-height: 1.2;
          font-weight: 500;
          color: #fff;
          letter-spacing: -0.02em;
          text-transform: capitalize;
        }

        .monthCount {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 28px;
          height: 28px;
          padding: 0 8px;
          border-radius: 999px;
          background: rgba(59, 130, 246, 0.16);
          border: none;
          color: #93c5fd;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
        }

        .weekdays {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
          margin-bottom: 8px;
        }

        .weekday {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 16px;
          font-size: 10px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.44);
        }

        .days {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
        }

        .dayCell,
        .dayButton {
          width: 100%;
          aspect-ratio: 1 / 1;
          min-height: 0;
          border-radius: 10px;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: none;
        }

        .dayCell {
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.28);
          font-size: 10px;
          font-weight: 500;
          cursor: default;
        }

        .dayCellMuted {
          opacity: 0.22;
        }

        .dayButton {
          background: rgba(59, 130, 246, 0.28);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          cursor: pointer;
        }

        .dayButton:hover {
          background: rgba(59, 130, 246, 0.42);
        }
      `}</style>

      <div className="monthCard">
        <div className="monthHeader">
          <h3 className="monthTitle">{month.label}</h3>
          {hasMonthEvents ? (
            <button
              type="button"
              className="monthCount"
              onClick={() => onSelectMonth(month.key)}
              title={tWallet("viewAllSessionsMonth")}
            >
              {monthEventCount > 9 ? "9+" : monthEventCount}
            </button>
          ) : null}
        </div>

        <div className="weekdays">
          {getWeekdayInitials(locale).map((weekday, index) => (
            <div key={`${weekday}-${index}`} className="weekday">
              {weekday}
            </div>
          ))}
        </div>

        <div className="days">
          {previewDays.map((day) => {
            const inMonth = isSameMonth(day, month.firstDate);
            const dayKey = getDayKey(day);
            const dayItems = inMonth ? eventsByDay.get(dayKey) ?? [] : [];
            const hasEvent = dayItems.length > 0;

            if (hasEvent) {
              const countLabel = getDayCountLabel(dayItems.length);
              const countTitle = tWallet("calendarEventsCount", { count: dayItems.length });
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  className="dayButton"
                  onClick={() => onSelectDay(dayKey)}
                  title={countTitle}
                  aria-label={countTitle}
                >
                  {countLabel}
                </button>
              );
            }

            return (
              <div
                key={day.toISOString()}
                className={`dayCell ${!inMonth ? "dayCellMuted" : ""}`}
              >
                {inMonth ? day.getDate() : ""}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default function WalletCalendarioPage() {
  const tWalletPage = useTranslations("wallet");
  const tServices = useTranslations("services");
  const locale = useLocale();
  // ⚠️ Antes `pf.format`, el precio del COMPRADOR: inflaba cada monto del calendario
  // con el 2% de colchón FX y el redondeo comercial. Ahora la misma lectura que el resto
  // de la wallet, y sigue su switch de moneda.
  const { formatMoney } = useWalletMoney();
  const { netRate } = useCreatorNetRate();
  const { user } = useAuth();
  const walletData = useWalletData();
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (walletData.error) showToast(walletData.error, "error"); }, [walletData.error]); // eslint-disable-line react-hooks/exhaustive-deps

  const [viewMode, setViewMode] = useState<CalendarViewMode>("calendar");
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [viewItem, setViewItem] = useState<WalletServiceItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  useEffect(() => { if (feedbackError) showToast(feedbackError, "error"); }, [feedbackError]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (feedbackSuccess) showToast(feedbackSuccess, "success"); }, [feedbackSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  // Muestra sesiones + lives en el calendario. Los lives son solo guía visual.
  const calendarItems = useMemo(
    () => sortEventsBySchedule([...walletData.calendar, ...walletData.lives]),
    [walletData.calendar, walletData.lives]
  );

  const currentMonthBase = useMemo(() => startOfMonth(new Date()), []);
  const monthsWindow = useMemo(() => buildMonthWindow(currentMonthBase, locale), [currentMonthBase, locale]);
  const eventsByDay = useMemo(() => groupEventsByDay(calendarItems), [calendarItems]);

  const selectedItems = useMemo(() => {
    if (selectedDayKey) return eventsByDay.get(selectedDayKey) ?? [];
    if (selectedMonthKey) return calendarItems.filter(
      (item) => item.scheduledAt && getMonthKey(item.scheduledAt) === selectedMonthKey
    );
    return [];
  }, [selectedDayKey, selectedMonthKey, eventsByDay, calendarItems]);

  const overlayTitle = useMemo(() => {
    if (selectedDayKey) return formatSelectedDayLabel(selectedDayKey, locale);
    if (selectedMonthKey) {
      const found = monthsWindow.find((m) => m.key === selectedMonthKey);
      if (found) {
        const label = found.label;
        return label.charAt(0).toUpperCase() + label.slice(1);
      }
    }
    return "";
  }, [selectedDayKey, selectedMonthKey, monthsWindow]);

  const overlayOpen = viewMode === "calendar" && selectedItems.length > 0;

  const fakeRequest = viewItem
    ? ({
        buyerId: viewItem.buyerId,
        buyerDisplayName: viewItem.buyerDisplayName ?? null,
        buyerAvatarUrl: viewItem.buyerAvatarUrl ?? null,
        creatorId: "",
        status: viewItem.status,
        buyerMessage: viewItem.requestText ?? null,
        priceSnapshot: viewItem.priceSnapshot ?? null,
        durationMinutes: viewItem.durationMinutes ?? null,
        scheduledAt: viewItem.scheduledAt,
        createdAt: viewItem.createdAt,
        creatorScheduleNote: viewItem.creatorScheduleNote ?? null,
        scheduleHistory: viewItem.scheduleHistory,
        rescheduleHistory: viewItem.rescheduleHistory,
        rescheduleRequestsUsed: 0,
        rejectionReason: viewItem.rejectionReason ?? null,
        refundReason: viewItem.refundReason ?? null,
      } as unknown as MeetGreetRequestDoc)
    : null;

  const viewItemEarning =
    viewItem?.priceSnapshot != null && viewItem.priceSnapshot > 0
      ? formatMoney(viewItem.priceSnapshot * netRate)
      : null;

  function closeViewItem() {
    setViewItem(null);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    setBusy(false);
  }

  async function handleSchedule(scheduledAtIso: string | null, _note: string | null) {
    if (!viewItem || !scheduledAtIso) return;
    setBusy(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);
    try {
      const creatorTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (viewItem.source === "exclusive_session") {
        await proposeExclusiveSessionSchedule({
          requestId: viewItem.id,
          scheduledAt: scheduledAtIso,
          creatorTimezone,
        });
      } else {
        await proposeMeetGreetSchedule({
          requestId: viewItem.id,
          scheduledAt: scheduledAtIso,
          creatorTimezone,
        });
      }
      setFeedbackSuccess(tServices("successRescheduled"));
      setTimeout(closeViewItem, 900);
    } catch (e: unknown) {
      setFeedbackError(
        (e instanceof Error ? e.message : null) ?? tServices("errorSaveDate")
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleViewMode() {
    setSelectedDayKey(null);
    setViewMode((prev) => (prev === "list" ? "calendar" : "list"));
  }

  function handleSelectDay(dayKey: string) {
    const items = eventsByDay.get(dayKey) ?? [];
    if (!items.length) return;
    setSelectedDayKey(dayKey);
  }

  function handleCloseOverlay() {
    setSelectedDayKey(null);
    setSelectedMonthKey(null);
  }

  return (
    <WalletSectionShell activeTab="calendar">
      <WalletCard title={tWalletPage("calendarTitle")} transparent>
        <style jsx>{`
          .cardButtonSlot {
            display: flex;
            justify-content: flex-end;
            margin-top: -50px;
            margin-bottom: 20px;
          }

          .calendarContentOffset {
            padding-top: 0;
          }

          .monthsGrid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 14px;
          }

          @media (max-width: 720px) {
            .cardButtonSlot {
              margin-top: -46px;
              margin-bottom: 18px;
            }

            .monthsGrid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @keyframes skelPulseC {
            0%, 100% { opacity: 0.5; }
            50%       { opacity: 1; }
          }
          .skelC {
            background: rgba(255,255,255,0.10);
            border-radius: 6px;
            animation: skelPulseC 1.4s ease-in-out infinite;
          }
          /* El hueco de carga tiene que medir lo mismo que la fila de verdad,
             o al llegar los datos la lista da un salto. */
          .skelCardC {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 13px ${WALLET_CARD_PAD}px;
            border-radius: 0;
            background: rgba(255,255,255,0.04);
          }
        `}</style>

        <div className="cardButtonSlot">
          <ViewModeIconButton mode={viewMode} onClick={toggleViewMode} />
        </div>

        <div className="calendarContentOffset">
          {walletData.loading ? (
            <div style={{ display: "grid", gap: 8, marginInline: -WALLET_CARD_PAD }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="skelCardC">
                  <div className="skelC" style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="skelC" style={{ width: "48%", height: 13, borderRadius: 5 }} />
                    <div className="skelC" style={{ width: "65%", height: 11, borderRadius: 5 }} />
                  </div>
                  <div className="skelC" style={{ width: 110, height: 32, borderRadius: 8, flexShrink: 0 }} />
                </div>
              ))}
            </div>
          ) : calendarItems.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                color: "rgba(255,255,255,0.5)",
                fontSize: 13,
                padding: "18px 0",
              }}
            >
              {tWalletPage("noEvents")}
            </div>
          ) : viewMode === "list" ? (
            <div style={{ display: "grid", gap: 8, marginInline: -WALLET_CARD_PAD }}>
              {calendarItems.map((item) => (
                <CalendarEventCard
                  key={`${item.source}-${item.id}`}
                  item={item}
                  onView={() => {
                    setViewItem(item);
                    setFeedbackError(null);
                    setFeedbackSuccess(null);
                    setBusy(false);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="monthsGrid">
              {monthsWindow.map((month) => (
                <MonthCard
                  key={month.key}
                  month={month}
                  eventsByDay={eventsByDay}
                  onSelectDay={handleSelectDay}
                  onSelectMonth={(key) => {
                    setSelectedMonthKey(key);
                    setSelectedDayKey(null);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <EventsOverlay
          open={overlayOpen}
          title={overlayTitle}
          items={selectedItems}
          onClose={handleCloseOverlay}
          onViewItem={(item) => {
            setSelectedDayKey(null);
            setSelectedMonthKey(null);
            setViewItem(item);
            setFeedbackError(null);
            setFeedbackSuccess(null);
            setBusy(false);
          }}
        />

        {viewItem && fakeRequest && (
          <SessionRequestOverlay
            open={viewItem !== null}
            onClose={closeViewItem}
            request={fakeRequest}
            requestId={viewItem.id}
            serviceKind={viewItem.source as "meet_greet" | "exclusive_session"}
            earning={viewItemEarning}
            busy={busy}
            ownerCalendarItems={walletData.calendar}
            getInitials={(name) => name?.charAt(0).toUpperCase() ?? "?"}
            onAccept={() => {}}
            onReject={async () => {}}
            onSchedule={handleSchedule}
            onAcceptAndSchedule={() => {}}
            onPrepare={() => {}}
            onKeepSchedule={async () => closeViewItem()}
          />
        )}
      </WalletCard>

      <VibraToast toast={toast} />
    </WalletSectionShell>
  );
}
