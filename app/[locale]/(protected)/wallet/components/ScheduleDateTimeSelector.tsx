"use client";

import { useEffect, useRef } from "react";

export type ScheduleParts = {
  day: string;
  month: string;
  year: string;
  hour: string;
  minute: string;
};

type Props = {
  value: ScheduleParts;
  onChange: (value: ScheduleParts) => void;
  disabled?: boolean;
};

const MONTH_OPTIONS = [
  { value: "01", label: "Enero" },
  { value: "02", label: "Febrero" },
  { value: "03", label: "Marzo" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Mayo" },
  { value: "06", label: "Junio" },
  { value: "07", label: "Julio" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Septiembre" },
  { value: "10", label: "Octubre" },
  { value: "11", label: "Noviembre" },
  { value: "12", label: "Diciembre" },
];

export function getSchedulePartsFromDate(value: Date | null): ScheduleParts {
  const date = value ?? new Date();

  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    year: String(date.getFullYear()),
    hour: value
      ? String(date.getHours()).padStart(2, "0")
      : "00",
    minute: value
      ? String(date.getMinutes()).padStart(2, "0")
      : "00",
  };
}

export function schedulePartsToIso(parts: ScheduleParts): string | null {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  if (date.getTime() <= Date.now()) {
    return null;
  }

  return date.toISOString();
}

export default function ScheduleDateTimeSelector({
  value,
  onChange,
  disabled = false,
}: Props) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  const selectedYear = Number(value.year);
  const selectedMonth = Number(value.month);
  const selectedDay = Number(value.day);
  const selectedHour = Number(value.hour);

  const isSelectedYear = selectedYear === currentYear;
  const isSelectedYearMonth = isSelectedYear && selectedMonth === currentMonth;
  const isToday =
    isSelectedYearMonth && selectedDay === currentDay;
  const isSameHour = isToday && selectedHour === currentHour;

  const yearOptions = Array.from({ length: 4 }, (_, i) =>
    String(currentYear + i)
  );

  const daysInSelectedMonth =
    Number.isInteger(selectedYear) &&
    Number.isInteger(selectedMonth) &&
    selectedMonth >= 1 &&
    selectedMonth <= 12
      ? new Date(selectedYear, selectedMonth, 0).getDate()
      : 31;

  const allDayOptions = Array.from({ length: daysInSelectedMonth }, (_, i) =>
    String(i + 1).padStart(2, "0")
  );
  const dayOptions = isSelectedYearMonth
    ? allDayOptions.filter((d) => Number(d) >= currentDay)
    : allDayOptions;

  const allMonthOptions = MONTH_OPTIONS;
  const monthOptions = isSelectedYear
    ? allMonthOptions.filter((m) => Number(m.value) >= currentMonth)
    : allMonthOptions;

  const allHourOptions = Array.from({ length: 24 }, (_, i) =>
    String(i).padStart(2, "0")
  );
  const hourOptions = isToday
    ? allHourOptions.filter((h) => {
        const hNum = Number(h);
        if (hNum > currentHour) return true;
        if (hNum === currentHour) {
          return ["00", "15", "30", "45"].some((m) => Number(m) > currentMinute);
        }
        return false;
      })
    : allHourOptions;

  const allMinuteOptions = ["00", "15", "30", "45"];
  const minuteOptions = isSameHour
    ? allMinuteOptions.filter((m) => Number(m) > currentMinute)
    : allMinuteOptions;

  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Normalize hour/minute when today is selected and the stored value is in the past.
  // This happens on mount (e.g. dialog opens with null → "00:00") and whenever
  // isToday transitions from false → true.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isToday) return;

    const nowSnap = new Date();
    const nHour = nowSnap.getHours();
    const nMinute = nowSnap.getMinutes();

    const validHours = Array.from({ length: 24 }, (_, i) => i).filter((h) => {
      if (h > nHour) return true;
      if (h === nHour) {
        return ["00", "15", "30", "45"].some((m) => Number(m) > nMinute);
      }
      return false;
    });

    if (validHours.length === 0) return;

    const snap = valueRef.current;
    const selectedH = Number(snap.hour);

    if (!validHours.includes(selectedH)) {
      const firstH = validHours[0];
      const firstMin =
        firstH === nHour
          ? (["00", "15", "30", "45"].find((m) => Number(m) > nMinute) ?? "00")
          : "00";
      onChangeRef.current({
        ...snap,
        hour: String(firstH).padStart(2, "0"),
        minute: firstMin,
      });
      return;
    }

    if (selectedH === nHour) {
      const validMins = ["00", "15", "30", "45"].filter((m) => Number(m) > nMinute);
      if (validMins.length > 0 && !validMins.includes(snap.minute)) {
        onChangeRef.current({ ...snap, minute: validMins[0] });
      }
    }
  }, [isToday]);

  function updatePart(key: keyof ScheduleParts, nextValue: string) {
    const nextParts: ScheduleParts = { ...value, [key]: nextValue };

    const nextYear = Number(nextParts.year);
    const nextMonth = Number(nextParts.month);
    const nextDay = Number(nextParts.day);
    const nextHour = Number(nextParts.hour);

    if (
      (key === "month" || key === "year") &&
      Number.isInteger(nextYear) &&
      Number.isInteger(nextMonth) &&
      nextMonth >= 1 &&
      nextMonth <= 12
    ) {
      const maxDay = new Date(nextYear, nextMonth, 0).getDate();
      if (Number.isInteger(nextDay) && nextDay > maxDay) {
        nextParts.day = String(maxDay).padStart(2, "0");
      }
    }

    const nowSnap = new Date();
    const nYear = nowSnap.getFullYear();
    const nMonth = nowSnap.getMonth() + 1;
    const nDay = nowSnap.getDate();
    const nHour = nowSnap.getHours();
    const nMinute = nowSnap.getMinutes();

    const nextIsToday =
      nextYear === nYear && nextMonth === nMonth && nextDay === nDay;
    const nextIsSameHour = nextIsToday && nextHour === nHour;

    if (nextIsToday) {
      const validHours = Array.from({ length: 24 }, (_, i) => i).filter((h) => {
        if (h > nHour) return true;
        if (h === nHour) return ["00", "15", "30", "45"].some((m) => Number(m) > nMinute);
        return false;
      });

      if (validHours.length > 0 && !validHours.includes(nextHour)) {
        nextParts.hour = String(validHours[0]).padStart(2, "0");
        nextParts.minute = "00";
      }
    }

    if (nextIsSameHour) {
      const validMinutes = ["00", "15", "30", "45"].filter(
        (m) => Number(m) > nMinute
      );
      if (validMinutes.length > 0 && !validMinutes.includes(nextParts.minute)) {
        nextParts.minute = validMinutes[0];
      }
    }

    onChange(nextParts);
  }

  return (
    <>
      <style jsx>{`
        .selectorGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .timeGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 10px;
        }

        .fieldGroup {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .label {
          color: rgba(255, 255, 255, 0.72);
          font-size: 12px;
          font-weight: 700;
          line-height: 1;
        }

        .field {
          width: 100%;
          box-sizing: border-box;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: #111;
          color: #fff;
          outline: none;
          padding: 12px 13px;
          font-size: 13px;
          font-weight: 600;
          min-height: 46px;
        }

        .field option {
          background: #111;
          color: #fff;
        }

        .field:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        @media (max-width: 620px) {
          .selectorGrid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 8px;
          }

          .timeGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
          }

          .field {
            padding: 11px 10px;
            font-size: 12px;
          }

          .label {
            font-size: 11px;
          }
        }
      `}</style>

      <div>
        <div className="selectorGrid">
          <label className="fieldGroup">
            <span className="label">Día</span>
            <select
              value={value.day}
              onChange={(e) => updatePart("day", e.target.value)}
              disabled={disabled}
              className="field"
            >
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>

          <label className="fieldGroup">
            <span className="label">Mes</span>
            <select
              value={value.month}
              onChange={(e) => updatePart("month", e.target.value)}
              disabled={disabled}
              className="field"
            >
              {monthOptions.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>

          <label className="fieldGroup">
            <span className="label">Año</span>
            <select
              value={value.year}
              onChange={(e) => updatePart("year", e.target.value)}
              disabled={disabled}
              className="field"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="timeGrid">
          <label className="fieldGroup">
            <span className="label">Hora</span>
            <select
              value={value.hour}
              onChange={(e) => updatePart("hour", e.target.value)}
              disabled={disabled}
              className="field"
            >
              {hourOptions.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>

          <label className="fieldGroup">
            <span className="label">Minuto</span>
            <select
              value={value.minute}
              onChange={(e) => updatePart("minute", e.target.value)}
              disabled={disabled}
              className="field"
            >
              {minuteOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </>
  );
}