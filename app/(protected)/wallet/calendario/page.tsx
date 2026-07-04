"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/app/providers";
import {
  useOwnerWalletData,
  type WalletServiceItem,
} from "@/lib/wallet/ownerWallet";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  EmptyRows,
  WalletCard,
  WalletErrorBox,
  WalletList,
} from "../components/WalletUi";

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

function getMonthLabel(date: Date): string {
  const month = new Intl.DateTimeFormat("es-MX", {
    month: "long",
  }).format(date);

  return `${month} ${date.getFullYear()}`;
}

function getWeekdayInitials(): string[] {
  return ["L", "M", "M", "J", "V", "S", "D"];
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

function buildMonthWindow(baseDate: Date): CalendarMonthItem[] {
  return Array.from({ length: 12 }, (_, index) => {
    const date = addMonths(baseDate, index);
    return {
      key: getMonthKey(date),
      label: getMonthLabel(date),
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

function formatSelectedDayLabel(dayKey: string | null): string {
  if (!dayKey) return "";

  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);

  return new Intl.DateTimeFormat("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
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

      <button
        type="button"
        className="button"
        onClick={onClick}
        title={isList ? "Ver calendario" : "Ver lista"}
        aria-label={isList ? "Ver calendario" : "Ver lista"}
      >
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
      </button>
    </>
  );
}

function EventsOverlay({
  open,
  title,
  items,
  onClose,
}: {
  open: boolean;
  title: string;
  items: WalletServiceItem[];
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <style jsx global>{`
        @keyframes walCalIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }

        .walletCalendarOverlay {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          z-index: 2147483647;
          background: rgba(0, 0, 0, 0.88);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: inherit;
        }

        .walletCalendarOverlayPanel {
          width: min(720px, 100%);
          max-height: min(88vh, 680px);
          display: flex;
          flex-direction: column;
          border-radius: 18px;
          background: #0a0a0a;
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 32px 72px rgba(0, 0, 0, 0.9);
          color: #fff;
          overflow: hidden;
          animation: walCalIn 180ms ease-out;
        }

        .walletCalendarOverlayHeader {
          height: 56px;
          display: grid;
          grid-template-columns: 48px 1fr 48px;
          align-items: center;
          padding: 0 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          flex-shrink: 0;
        }

        .walletCalendarOverlayTitle {
          margin: 0;
          font-size: 17px;
          line-height: 1.2;
          font-weight: 500;
          color: #fff;
          text-align: center;
          letter-spacing: -0.02em;
          text-transform: capitalize;
        }

        .walletCalendarOverlayClose {
          width: 40px;
          height: 40px;
          border: none;
          background: none;
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          justify-self: end;
        }

        .walletCalendarOverlayContent {
          flex: 1;
          overflow-y: auto;
          min-height: 0;
          padding: 18px 20px 20px;
          display: grid;
          gap: 12px;
          align-content: start;
        }

        .walletCalendarOverlayContent::-webkit-scrollbar { width: 7px; }
        .walletCalendarOverlayContent::-webkit-scrollbar-track { background: transparent; }
        .walletCalendarOverlayContent::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.18);
          border-radius: 999px;
        }
      `}</style>

      <div className="walletCalendarOverlay" onClick={onClose}>
        <div
          className="walletCalendarOverlayPanel"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="walletCalendarOverlayHeader">
            <div aria-hidden="true" />
            <h3 className="walletCalendarOverlayTitle">{title}</h3>
            <button
              type="button"
              className="walletCalendarOverlayClose"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6L18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="walletCalendarOverlayContent">
            <WalletList items={items.filter(isSafeCalendarItem)} calendarItems={items} />
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

function MonthCard({
  month,
  eventsByDay,
  onSelectDay,
}: {
  month: CalendarMonthItem;
  eventsByDay: Map<string, WalletServiceItem[]>;
  onSelectDay: (dayKey: string) => void;
}) {
  const previewDays = getMonthDaysMatrix(month.firstDate);
  const monthEventDays = new Set(
    Array.from(eventsByDay.keys()).filter((key) => key.startsWith(`${month.key}-`))
  );
  const hasMonthEvents = monthEventDays.size > 0;

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
          {hasMonthEvents ? <div className="monthCount">{monthEventDays.size}</div> : null}
        </div>

        <div className="weekdays">
          {getWeekdayInitials().map((weekday, index) => (
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
              const countTitle =
                dayItems.length > 9
                  ? `${dayItems.length} eventos programados`
                  : `${dayItems.length} evento${dayItems.length === 1 ? "" : "s"}`;
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
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);

  const [viewMode, setViewMode] = useState<CalendarViewMode>("calendar");
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const calendarItems = useMemo(
    () => sortEventsBySchedule(walletData.calendar),
    [walletData.calendar]
  );

  const currentMonthBase = useMemo(() => startOfMonth(new Date()), []);
  const monthsWindow = useMemo(() => buildMonthWindow(currentMonthBase), [currentMonthBase]);
  const eventsByDay = useMemo(() => groupEventsByDay(calendarItems), [calendarItems]);

  const selectedItems = selectedDayKey ? eventsByDay.get(selectedDayKey) ?? [] : [];
  const overlayOpen = viewMode === "calendar" && selectedItems.length > 0;

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
  }

  return (
    <WalletSectionShell activeTab="calendar">
      {walletData.error ? <WalletErrorBox message={walletData.error} /> : null}

      <WalletCard title="Calendario" transparent>
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
        `}</style>

        <div className="cardButtonSlot">
          <ViewModeIconButton mode={viewMode} onClick={toggleViewMode} />
        </div>

        <div className="calendarContentOffset">
          {walletData.loading ? (
            <EmptyRows
              title="Cargando calendario"
              subtitle="Estamos leyendo tus Meet & Greet y sesiones exclusivas programadas."
            />
          ) : calendarItems.length === 0 ? (
            <EmptyRows
              title="Sin eventos programados"
              subtitle="Todavía no tienes Meet & Greet o sesiones exclusivas activas para mostrar en calendario."
            />
          ) : viewMode === "list" ? (
            <WalletList items={calendarItems} />
          ) : (
            <div className="monthsGrid">
              {monthsWindow.map((month) => (
                <MonthCard
                  key={month.key}
                  month={month}
                  eventsByDay={eventsByDay}
                  onSelectDay={handleSelectDay}
                />
              ))}
            </div>
          )}
        </div>

        <EventsOverlay
          open={overlayOpen}
          title={formatSelectedDayLabel(selectedDayKey)}
          items={selectedItems}
          onClose={handleCloseOverlay}
        />
      </WalletCard>
    </WalletSectionShell>
  );
}
