"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { WalletServiceItem } from "@/lib/wallet/ownerWallet";

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
  conflictMessage?: string | null;
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

function buildMonthWindow(baseDate: Date, count: number): CalendarMonthItem[] {
  return Array.from({ length: count }, (_, index) => {
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
  title = "Calendario del creador",
  items,
  excludeId,
  selectedDate,
  onSelectDate,
  onClose,
  renderItem,
  footer,
  conflictMessage,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const MAX_MONTHS_FORWARD = 6;
  const [isCompact, setIsCompact] = useState(false);
  const [selectedEventDayKey, setSelectedEventDayKey] = useState<string | null>(null);

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

  const monthCount = isCompact ? 2 : 3;

  const currentMonthBase = useMemo(() => startOfMonth(new Date()), []);

  const monthsWindow = useMemo(
    () => buildMonthWindow(addMonths(currentMonthBase, monthOffset), monthCount),
    [currentMonthBase, monthOffset, monthCount]
  );

  const selectedEventItems = selectedEventDayKey
    ? eventsByDay.get(selectedEventDayKey) ?? []
    : [];

  if (!mounted || !open) return null;

  return createPortal(
    <>
      <style jsx global>{`
        .scheduleOverlayBackdrop {
          position: fixed;
          inset: 0;
          z-index: 2147483647;
          background: rgba(0, 0, 0, 0.68);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
        }

        .scheduleOverlayPanel {
          width: min(720px, 100%);
          max-height: min(78vh, 680px);
          overflow: hidden;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.11);
          background: linear-gradient(
            180deg,
            rgba(14, 14, 16, 0.98),
            rgba(8, 8, 10, 0.98)
          );
          box-shadow: 0 30px 80px rgba(0, 0, 0, 0.42);
          display: flex;
          flex-direction: column;
        }

        .scheduleOverlayHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          padding: 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(10, 10, 12, 0.94);
        }

        .scheduleOverlayTitle {
          margin: 0;
          color: #fff;
          font-size: 18px;
          line-height: 1.2;
          font-weight: 800;
        }

        .scheduleOverlaySubtitle {
          margin: 7px 0 0;
          color: rgba(255, 255, 255, 0.64);
          font-size: 13px;
          line-height: 1.45;
        }

        .scheduleOverlayClose {
          width: 40px;
          height: 40px;
          min-width: 40px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .scheduleOverlayBody {
          padding: 14px 16px 16px;
          overflow: auto;
          display: grid;
          gap: 16px;
        }

        .scheduleCalendarToolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .scheduleNavButton {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: #fff;
          cursor: pointer;
          font-size: 18px;
          font-weight: 800;
        }

        .scheduleCalendarGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .scheduleMonthCard {
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.025);
          border-radius: 18px;
          padding: 12px;
          box-sizing: border-box;
          box-shadow: 0 10px 22px rgba(0, 0, 0, 0.12);
        }

        .scheduleMonthCardActive {
          border-color: rgba(59, 130, 246, 0.72);
          background: linear-gradient(
            180deg,
            rgba(59, 130, 246, 0.08),
            rgba(255, 255, 255, 0.025)
          );
          box-shadow:
            0 0 0 1px rgba(59, 130, 246, 0.12),
            0 14px 30px rgba(59, 130, 246, 0.12);
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
          font-weight: 700;
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
          border: 1px solid rgba(59, 130, 246, 0.42);
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
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          color: transparent;
          cursor: pointer;
        }

        .scheduleDayButtonMuted {
          opacity: 0.22;
          cursor: default;
        }

        .scheduleDayButtonBusy {
          border-color: rgba(59, 130, 246, 0.52);
          background: rgba(59, 130, 246, 0.28);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.08),
            0 0 0 1px rgba(59, 130, 246, 0.08);
        }

        .scheduleDayButtonSelected {
          border-color: rgba(34, 197, 94, 0.72);
          background: rgba(34, 197, 94, 0.28);
          color: #fff;
          outline: 2px solid rgba(34, 197, 94, 0.45);
          outline-offset: 2px;
        }

        .scheduleSelectedEvents {
          display: grid;
          gap: 10px;
        }

        .scheduleSelectedTitle {
          margin: 0;
          color: #fff;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.3;
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

        @media (max-width: 720px) {
          .scheduleOverlayBackdrop {
            align-items: flex-end;
            padding: 10px;
          }

          .scheduleOverlayPanel {
            width: 100%;
            max-height: 90vh;
            border-radius: 22px 22px 0 0;
          }

          .scheduleOverlayHeader {
            padding: 16px;
          }

          .scheduleOverlayBody {
            padding: 14px 16px 18px;
          }

          .scheduleCalendarGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .scheduleMonthCard {
            padding: 12px;
            border-radius: 18px;
          }
        }
      `}</style>

      <div className="scheduleOverlayBackdrop" onClick={onClose}>
        <div
          className="scheduleOverlayPanel"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="scheduleOverlayHeader">
            <div>
              <h3 className="scheduleOverlayTitle">{title}</h3>
              <p className="scheduleOverlaySubtitle">
                {visibleItems.length} evento
                {visibleItems.length === 1 ? "" : "s"} ocupado
                {visibleItems.length === 1 ? "" : "s"} en agenda.
              </p>
            </div>

            <button
              type="button"
              className="scheduleOverlayClose"
              onClick={onClose}
              aria-label="Cerrar calendario"
            >
              ✕
            </button>
          </div>

          <div className="scheduleOverlayBody">
            <div className="scheduleCalendarToolbar">
              <button
                type="button"
                className="scheduleNavButton"
                onClick={() => {
  setSelectedEventDayKey(null);
  setMonthOffset((prev) => Math.max(prev - monthCount, 0));
}}
                aria-label="Meses anteriores"
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
                aria-label="Meses siguientes"
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
                const hasMonthEvents = monthEventDays.length > 0;

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
                        <div className="scheduleMonthCount">{monthEventDays.length}</div>
                      ) : null}
                    </div>

                    <div className="scheduleWeekdays">
                      {getWeekdayInitials().map((weekday, index) => (
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
                              isSelected ? "scheduleDayButtonSelected" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            disabled={!inMonth}
                            onClick={() => {
                              if (!inMonth) return;

                              onSelectDate?.(day);
                              setSelectedEventDayKey(hasEvents ? dayKey : null);
                            }}
                            title={
                              hasEvents
                                ? `${dayItems.length} evento${dayItems.length === 1 ? "" : "s"}`
                                : "Seleccionar día"
                            }
                          >
                            {hasEvents ? countLabel : isSelected ? day.getDate() : "•"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedEventDayKey ? (
              <div className="scheduleSelectedEvents">
                <h4 className="scheduleSelectedTitle">
                  Eventos agendados para este día
                </h4>

                {selectedEventItems.length > 0 ? (
                  selectedEventItems.map((item) => (
                    <div key={`${item.source}-${item.id}`}>
                      {renderItem ? (
                        renderItem(item)
                      ) : (
                        <div className="scheduleEmpty">{item.title}</div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="scheduleEmpty">
                    No hay eventos agendados activos para este día.
                  </div>
                )}
              </div>
            ) : null}

            {conflictMessage ? (
              <div className="scheduleConflictBox">{conflictMessage}</div>
            ) : null}

            {footer ? <div className="scheduleFooter">{footer}</div> : null}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}