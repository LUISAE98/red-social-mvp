"use client";

import { useEffect, useMemo, useState, useRef, type ReactNode } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import type { WalletServiceItem } from "@/lib/wallet/ownerWallet";
import ScheduleDateTimeSelector, {
  getSchedulePartsFromDate,
  schedulePartsToIso,
  type ScheduleParts,
} from "./ScheduleDateTimeSelector";

type Props = {
  open: boolean;
  title?: string;
  items: WalletServiceItem[];
  excludeId?: string;
  selectedDate?: Date | null;
  onSelectDate?: (date: Date) => void;
  onClose: () => void;
  renderItem?: (item: WalletServiceItem) => ReactNode;
  footer?: ReactNode;
  topContent?: ReactNode;
  conflictMessage?: string | null;
  selectedVariant?: "green" | "blue" | "pink";
  onReschedule?: (item: WalletServiceItem, scheduledAt: string) => Promise<void>;
};

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

  return `${month} ${date.getFullYear()}`;
}

function getWeekdayInitials(locale: string): string[] {
  const baseDate = new Date(2024, 0, 1); // Monday
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
    days.push(
      new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + i
      )
    );
  }

  return days;
}

function buildMonthWindow(baseDate: Date, count: number, locale: string): CalendarMonthItem[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addMonths(baseDate, index);

    return {
      key: getMonthKey(date),
      label: getMonthLabel(date, locale),
      firstDate: date,
    };
  });
}

function getCalendarInitials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
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
    if (!item.scheduledAt) return;

    const key = getDayKey(item.scheduledAt);
    const existing = map.get(key) ?? [];

    existing.push(item);
    map.set(key, existing);
  });

  return map;
}

function getDayCountLabel(count: number): string {
  return count > 9 ? "9+" : String(count);
}

function isSameDay(a: Date | null | undefined, b: Date): boolean {
  if (!a) return false;

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function ScheduleCalendarOverlay({
  open,
  title,
  items,
  excludeId,
  selectedDate,
  onSelectDate,
  onClose,
  renderItem,
  footer,
  topContent,
  conflictMessage,
  selectedVariant = "green",
  onReschedule,
}: Props) {
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const resolvedTitle = title ?? tWallet("creatorCalendar");
  const [mounted, setMounted] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const MAX_MONTHS_FORWARD = 6;
  const [isCompact, setIsCompact] = useState(false);
  const [selectedEventDayKey, setSelectedEventDayKey] = useState<string | null>(null);
  const lastEventDayKeyRef = useRef<string | null>(null);
  if (selectedEventDayKey) lastEventDayKeyRef.current = selectedEventDayKey;
  const displayEventDayKey = selectedEventDayKey ?? lastEventDayKeyRef.current;

  const [expandedRescheduleKey, setExpandedRescheduleKey] = useState<string | null>(null);
  const [rescheduleParts, setRescheduleParts] = useState<ScheduleParts>(getSchedulePartsFromDate(null));
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleResize() {
      setIsCompact(window.innerWidth <= 720);
    }

    handleResize();

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  const visibleItems = useMemo(
    () =>
      items
        .filter(isSafeCalendarItem)
        .filter((item) => !excludeId || item.id !== excludeId)
        .sort((a, b) => {
          const aTime = a.scheduledAt?.getTime() ?? 0;
          const bTime = b.scheduledAt?.getTime() ?? 0;
          return aTime - bTime;
        }),
    [items, excludeId]
  );

  const eventsByDay = useMemo(() => groupEventsByDay(visibleItems), [visibleItems]);

  const monthCount = isCompact ? 6 : 3;

  useEffect(() => {
    if (isCompact) setMonthOffset(0);
  }, [isCompact]);

  const currentMonthBase = useMemo(() => startOfMonth(new Date()), []);

  const monthsWindow = useMemo(
    () => buildMonthWindow(addMonths(currentMonthBase, monthOffset), monthCount, locale),
    [currentMonthBase, monthOffset, monthCount, locale]
  );

  const selectedEventItems = selectedEventDayKey
    ? eventsByDay.get(selectedEventDayKey) ?? []
    : [];

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <style jsx global>{`
        @keyframes vibraScheduleCalIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);     }
        }
        @keyframes vibraScheduleCalOut {
          from { opacity: 1; transform: scale(1)    translateY(0);     }
          to   { opacity: 0; transform: scale(0.94) translateY(10px);  }
        }

        .scheduleOverlayBackdrop {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100dvh;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(0, 0, 0, 0.88);
          font-family: inherit;
        }

        .scheduleOverlayPanel {
          width: min(720px, 100%);
          max-height: min(88vh, 680px);
          display: flex;
          flex-direction: column;
          border-radius: 18px;
          background: #0a0a0a;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 32px 72px rgba(0, 0, 0, 0.9);
          color: #fff;
          overflow: hidden;
          animation: vibraScheduleCalIn 180ms ease-out;
        }

        .scheduleOverlayHeader {
          height: 56px;
          display: grid;
          grid-template-columns: 48px 1fr 48px;
          align-items: center;
          padding: 0 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          flex-shrink: 0;
        }

        .scheduleOverlayTitle {
          margin: 0;
          color: #fff;
          font-size: 17px;
          font-weight: 500;
          line-height: 1.2;
          text-align: center;
          letter-spacing: -0.02em;
        }

        .scheduleOverlayBody {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
          max-height: calc(min(88vh, 680px) - 56px);
          padding: 18px 20px 20px;
          display: grid;
          gap: 16px;
          align-content: start;
        }

        .scheduleOverlayBody::-webkit-scrollbar { width: 7px; height: 7px; }
        .scheduleOverlayBody::-webkit-scrollbar-track { background: transparent; }
        .scheduleOverlayBody::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }

        .scheduleCalendarToolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .scheduleNavButton {
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.45);
          cursor: pointer;
          font-size: 24px;
          font-weight: 300;
          padding: 4px 8px;
          line-height: 1;
          transition: color 0.15s;
        }

        .scheduleNavButton:hover {
          color: #fff;
        }

        .scheduleCalendarGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .scheduleMonthCard {
          width: 100%;
          border: none;
          background: rgba(255, 255, 255, 0.06);
          border-radius: 18px;
          padding: 12px;
          box-sizing: border-box;
        }

        .scheduleMonthCardActive {
          background: rgba(255, 255, 255, 0.06);
        }

        .scheduleMonthHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .scheduleMonthTitle {
          margin: 0;
          font-size: 15px;
          line-height: 1.2;
          font-weight: 500;
          color: #fff;
          letter-spacing: -0.02em;
          text-transform: capitalize;
        }

        .scheduleMonthCount {
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

        .scheduleWeekdays {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
          margin-bottom: 8px;
        }

        .scheduleWeekday {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 16px;
          font-size: 10px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.44);
        }

        .scheduleDays {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
        }

        .scheduleDayButton {
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
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.28);
          font-size: 10px;
          font-weight: 500;
          cursor: pointer;
        }

        .scheduleDayButtonMuted {
          opacity: 0.22;
          cursor: default;
        }

        .scheduleDayButtonBusy {
          background: rgba(59, 130, 246, 0.28);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
        }

        .scheduleDayButtonSelected {
          border-color: rgba(34, 197, 94, 0.72);
          background: rgba(34, 197, 94, 0.28);
          color: #fff;
          outline: 2px solid rgba(34, 197, 94, 0.45);
          outline-offset: 2px;
        }

        .scheduleDayButtonSelectedBlue {
          border-color: rgba(29, 78, 216, 0.72);
          background: rgba(29, 78, 216, 0.28);
          color: #fff;
          outline: 2px solid rgba(29, 78, 216, 0.45);
          outline-offset: 2px;
        }

        .scheduleDayButtonSelectedPink {
          border-color: rgba(190, 24, 93, 0.72);
          background: rgba(190, 24, 93, 0.28);
          color: #fff;
          outline: 2px solid rgba(190, 24, 93, 0.45);
          outline-offset: 2px;
        }

        .scheduleSelectedEvents {
          display: grid;
          gap: 10px;
        }

        .scheduleEventsScroll {
          max-height: 260px;
          overflow-y: auto;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .scheduleEventsScroll::-webkit-scrollbar { width: 5px; }
        .scheduleEventsScroll::-webkit-scrollbar-track { background: transparent; }
        .scheduleEventsScroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }

        .scheduleSelectedTitle {
          margin: 0;
          color: #fff;
          font-size: 17px;
          font-weight: 500;
          line-height: 1.2;
          letter-spacing: -0.02em;
          text-align: center;
        }

        .scheduleEmpty {
          border-radius: 16px;
          border: 1px dashed rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.025);
          padding: 14px;
          color: rgba(255, 255, 255, 0.64);
          font-size: 13px;
          line-height: 1.5;
        }

        .scheduleConflictBox {
          border-radius: 14px;
          border: 1px solid rgba(248, 113, 113, 0.24);
          background: rgba(248, 113, 113, 0.09);
          color: #fecaca;
          padding: 12px 13px;
          font-size: 13px;
          line-height: 1.45;
          font-weight: 600;
        }

        .scheduleFooter {
          border-top: 1px solid rgba(255, 255, 255, 0.07);
          padding-top: 14px;
        }

        .scheduleRescheduleForm select,
        .scheduleRescheduleForm input {
          background: rgba(255, 255, 255, 0.06) !important;
          border-color: transparent !important;
          border-width: 0 !important;
        }

        @media (max-width: 720px) {
          .scheduleOverlayBackdrop {
            align-items: flex-end;
            padding: 0 0 env(safe-area-inset-bottom);
          }

          .scheduleOverlayPanel {
            width: 100%;
            max-height: 90vh;
            border-radius: 22px 22px 0 0;
            animation: none;
          }

          .scheduleOverlayHeader {
            grid-template-columns: 56px 1fr 56px;
          }

          .scheduleOverlayBody {
            padding: 14px 16px 20px;
            max-height: calc(90vh - 56px);
          }

          .scheduleEventsScroll {
            grid-template-columns: 1fr;
          }

          .scheduleCalendarToolbar {
            display: none;
          }

          .scheduleCalendarGrid {
            display: flex;
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            gap: 8px;
            margin: 0 -16px;
            padding: 0 16px 4px 20px;
            scroll-padding-left: 20px;
            scrollbar-width: none;
          }

          .scheduleCalendarGrid::-webkit-scrollbar {
            display: none;
          }

          .scheduleCalendarGrid > div {
            flex: 0 0 76%;
            width: 76%;
            scroll-snap-align: start;
            border-radius: 14px;
            padding: 10px;
          }
        }
      `}</style>

      <div
        className="scheduleOverlayBackdrop"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <section
          className="scheduleOverlayPanel"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="scheduleOverlayHeader">
            <div aria-hidden="true" />
            <h3 className="scheduleOverlayTitle">{resolvedTitle}</h3>
            <button
              type="button"
              onClick={onClose}
              aria-label={tCommon("closeAriaLabel")}
              style={{
                border: "none",
                background: "none",
                color: "#fff",
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                justifySelf: "end",
                padding: 4,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div className="scheduleOverlayBody">
            {topContent && <div>{topContent}</div>}
            <div className="scheduleCalendarToolbar">
              <button
                type="button"
                className="scheduleNavButton"
                onClick={() => {
  setSelectedEventDayKey(null);
  setMonthOffset((prev) => Math.max(prev - monthCount, 0));
}}
                aria-label={tServices("prevMonths")}
              >
                ‹
              </button>

              <button
                type="button"
                className="scheduleNavButton"
                onClick={() => {
  setSelectedEventDayKey(null);
  setMonthOffset((prev) =>
    Math.min(prev + monthCount, MAX_MONTHS_FORWARD)
  );
}}
                aria-label={tServices("nextMonths")}
              >
                ›
              </button>
            </div>

            <div className="scheduleCalendarGrid">
              {monthsWindow.map((month) => {
                const monthDays = getMonthDaysMatrix(month.firstDate);
                const monthEventDays = Array.from(eventsByDay.keys()).filter((key) =>
                  key.startsWith(`${month.key}-`)
                );
                const monthEventCount = monthEventDays.reduce(
                  (sum, key) => sum + (eventsByDay.get(key)?.length ?? 0),
                  0
                );
                const hasMonthEvents = monthEventCount > 0;

                return (
                  <div
                    key={month.key}
                    className={`scheduleMonthCard ${
                      hasMonthEvents ? "scheduleMonthCardActive" : ""
                    }`}
                  >
                    <div className="scheduleMonthHeader">
                      <h4 className="scheduleMonthTitle">{month.label}</h4>
                      {hasMonthEvents ? (
                        <div className="scheduleMonthCount">{monthEventCount > 9 ? "9+" : monthEventCount}</div>
                      ) : null}
                    </div>

                    <div className="scheduleWeekdays">
                      {getWeekdayInitials(locale).map((weekday, index) => (
                        <div key={`${weekday}-${index}`} className="scheduleWeekday">
                          {weekday}
                        </div>
                      ))}
                    </div>

                    <div className="scheduleDays">
                      {monthDays.map((day) => {
                        const inMonth = isSameMonth(day, month.firstDate);
                        const dayKey = getDayKey(day);
                        const dayItems = inMonth ? eventsByDay.get(dayKey) ?? [] : [];
                        const hasEvents = dayItems.length > 0;
                        const isSelected = isSameDay(selectedDate, day);
                        const countLabel = getDayCountLabel(dayItems.length);

                        return (
                          <button
                            key={day.toISOString()}
                            type="button"
                            className={[
                              "scheduleDayButton",
                              !inMonth ? "scheduleDayButtonMuted" : "",
                              hasEvents ? "scheduleDayButtonBusy" : "",
                              isSelected
                                ? selectedVariant === "blue"
                                  ? "scheduleDayButtonSelectedBlue"
                                  : selectedVariant === "pink"
                                  ? "scheduleDayButtonSelectedPink"
                                  : "scheduleDayButtonSelected"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            disabled={!inMonth}
                            onClick={() => {
  if (!inMonth) return;

  const nextDate =
    selectedDate instanceof Date && !Number.isNaN(selectedDate.getTime())
      ? new Date(selectedDate)
      : new Date();

  nextDate.setFullYear(day.getFullYear());
  nextDate.setMonth(day.getMonth());
  nextDate.setDate(day.getDate());

  onSelectDate?.(nextDate);
  setSelectedEventDayKey(hasEvents ? dayKey : null);
}}
                            title={
                              hasEvents
                                ? tWallet("calendarEventsCount", { count: dayItems.length })
                                : tWallet("selectDay")
                            }
                          >
                            {hasEvents ? countLabel : day.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{
              overflow: "hidden",
              maxHeight: selectedEventDayKey ? "3000px" : "0",
              opacity: selectedEventDayKey ? 1 : 0,
              transition: "max-height 0.5s cubic-bezier(0.16,1,0.3,1), opacity 0.25s ease",
            }}>
              {displayEventDayKey && (
                <div className="scheduleSelectedEvents">
                  <h4 className="scheduleSelectedTitle">
                    {tWallet("scheduledEventsDay")}
                  </h4>

                  <div className="scheduleEventsScroll">
                  {(eventsByDay.get(displayEventDayKey) ?? []).length > 0 ? (
                    (eventsByDay.get(displayEventDayKey) ?? []).map((item) => (
                      <div key={`${item.source}-${item.id}`}>
                        {renderItem ? renderItem(item) : (() => {
                          const bgImg = item.source === "exclusive_session"
                            ? "/sesionexclusiva.webp"
                            : "/encuentroenvivo.webp";
                          const rescheduleColor = item.source === "exclusive_session"
                            ? "rgb(236, 72, 153)"
                            : "rgb(96, 165, 250)";
                          const itemKey = `${item.source}-${item.id}`;
                          const isExpanded = expandedRescheduleKey === itemKey;
                          return (
                            <div style={{
                              position: "relative",
                              display: "flex", flexDirection: "column",
                              borderRadius: 12, overflow: "hidden", isolation: "isolate",
                            }}>
                              {/* Imagen de fondo */}
                              <div style={{
                                position: "absolute", inset: 0, zIndex: 0,
                                backgroundImage: `url('${bgImg}')`,
                                backgroundSize: "cover", backgroundPosition: "center",
                                opacity: 0.42,
                              }} />
                              {/* Overlay oscuro */}
                              <div style={{ position: "absolute", inset: 0, zIndex: 1, background: "rgba(0,0,0,0.28)" }} />
                              {/* Contenido principal */}
                              <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 6px" }}>
                                {/* Avatar */}
                                <div style={{
                                  width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                                  background: "rgba(255,255,255,0.10)", overflow: "hidden",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                  {item.buyerAvatarUrl
                                    ? <img src={item.buyerAvatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    : <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{getCalendarInitials(item.buyerDisplayName ?? item.buyerUsername)}</span>
                                  }
                                </div>
                                {/* Nombre + duración */}
                                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
                                  <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>
                                    {item.buyerDisplayName ?? item.buyerUsername ?? tCommon("buyer")}
                                  </span>
                                  {item.durationMinutes && (
                                    <>
                                      <span style={{ width: 1, height: 16, background: "rgba(255,255,255,0.35)", flexShrink: 0, borderRadius: 1 }} />
                                      <span style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.60)", whiteSpace: "nowrap" }}>
                                        {item.durationMinutes} {tCommon("minutes")}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                              {/* Hora + botón */}
                              <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 12px 10px" }}>
                                <span style={{ fontSize: 15, fontWeight: 600, color: "#fff", letterSpacing: "-0.01em" }}>
                                  {item.scheduledAt?.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })} {tWallet("hoursAbbr")}
                                </span>
                                {onReschedule && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isExpanded) {
                                        setExpandedRescheduleKey(null);
                                        setRescheduleError(null);
                                      } else {
                                        setExpandedRescheduleKey(itemKey);
                                        setRescheduleParts(getSchedulePartsFromDate(item.scheduledAt ?? new Date()));
                                        setRescheduleError(null);
                                      }
                                    }}
                                    style={{
                                      border: "none", background: "none", color: rescheduleColor,
                                      fontSize: 12, fontWeight: 700, padding: "4px 0",
                                      cursor: "pointer",
                                      letterSpacing: "-0.01em", lineHeight: 1.4, flexShrink: 0,
                                    }}
                                  >
                                    {isExpanded ? tCommon("cancel") : tServices("reschedule")}
                                  </button>
                                )}
                              </div>
                              {/* Sección expandida */}
                              <div style={{
                                position: "relative", zIndex: 2,
                                overflow: "hidden",
                                maxHeight: isExpanded ? "320px" : "0",
                                opacity: isExpanded ? 1 : 0,
                                transition: "max-height 0.35s cubic-bezier(0.16,1,0.3,1), opacity 0.2s ease",
                              }}>
                                <div style={{
                                  padding: "10px 12px 12px",
                                  borderTop: "1px solid rgba(255,255,255,0.10)",
                                  display: "grid", gap: 8,
                                  fontFamily: "inherit",
                                }}>
                                  <div className="scheduleRescheduleForm">
                                    <ScheduleDateTimeSelector
                                      value={rescheduleParts}
                                      onChange={setRescheduleParts}
                                      disabled={rescheduleBusy}
                                    />
                                  </div>
                                  {rescheduleError && (
                                    <div style={{
                                      borderRadius: 10, border: "1px solid rgba(248,113,113,0.18)",
                                      background: "rgba(248,113,113,0.08)", color: "#fecaca",
                                      padding: "7px 8px", fontSize: 12, lineHeight: 1.3,
                                    }}>
                                      {rescheduleError}
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    disabled={rescheduleBusy}
                                    onClick={async () => {
                                      const iso = schedulePartsToIso(rescheduleParts);
                                      if (!iso) { setRescheduleError(tServices("selectDateTimeFull")); return; }
                                      setRescheduleBusy(true);
                                      setRescheduleError(null);
                                      try {
                                        await onReschedule!(item, iso);
                                        setExpandedRescheduleKey(null);
                                      } catch (e) {
                                        setRescheduleError(e instanceof Error ? e.message : tServices("rescheduleError"));
                                      } finally {
                                        setRescheduleBusy(false);
                                      }
                                    }}
                                    style={{
                                      height: 34, borderRadius: 8, border: "none",
                                      background: rescheduleBusy ? "rgba(255,255,255,0.12)" : rescheduleColor,
                                      color: "#fff", fontSize: 13, fontWeight: 600,
                                      cursor: rescheduleBusy ? "not-allowed" : "pointer",
                                      opacity: rescheduleBusy ? 0.55 : 1,
                                      fontFamily: "inherit",
                                    }}
                                  >
                                    {rescheduleBusy ? tServices("confirmingLabel") : tServices("confirmLabel")}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    ))
                  ) : (
                    <div className="scheduleEmpty">
                      {tServices("noActiveEvents")}
                    </div>
                  )}
                  </div>
                </div>
              )}
            </div>

            {conflictMessage ? (
              <div className="scheduleConflictBox">{conflictMessage}</div>
            ) : null}

            {footer ? <div className="scheduleFooter">{footer}</div> : null}
          </div>
        </section>
      </div>
    </>,
    document.body
  );
}