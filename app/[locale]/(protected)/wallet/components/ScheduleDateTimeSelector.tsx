"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import WheelPanel from "@/components/ui/WheelPanel";

/**
 * Por encima del modal desde el que se abre este selector (999999). El panel
 * de la rueda es lo último que se pinta en esa pantalla, así que va arriba.
 */
const WHEEL_Z_BASE = 1000010;

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

function getMonthOptions(locale: string): { value: string; label: string }[] {
  return Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label:
      new Date(2024, i, 1)
        .toLocaleString(locale, { month: "long" })
        .replace(/^\w/, (c) => c.toUpperCase()),
  }));
}

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
  const tWallet = useTranslations("wallet");
  const tCommon = useTranslations("common");
  // Fecha y hora en paneles SEPARADOS: cinco tambores a la vez son un muro, y
  // casi siempre se cambia una cosa o la otra, no las dos.
  const [wheelOpen, setWheelOpen] = useState<"date" | "time" | null>(null);
  const locale = useLocale();
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

  const allMonthOptions = getMonthOptions(locale);
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

  // Los cinco campos que se ven fuera, cada uno con su r\u00f3tulo y su valor.
  const mesElegido = allMonthOptions.find((m) => m.value === value.month);
  // `vacio` es el texto de marcador y se pinta atenuado, igual que en el alta de
  // cuenta (RegisterPanel): un campo sin rellenar se ve gris y al tener valor pasa
  // a blanco. Aquí el hueco vacío salía en blanco y sin texto, así que no se
  // distinguía de uno ya elegido.
  const camposFecha = [
    { key: "day", rotulo: tWallet("dayLabel"), texto: value.day, vacio: tWallet("dayLabel") },
    {
      key: "month",
      rotulo: tWallet("monthLabel"),
      texto: mesElegido?.label ?? value.month,
      vacio: tWallet("monthLabel"),
    },
    { key: "year", rotulo: tWallet("yearLabel"), texto: value.year, vacio: tWallet("yearLabel") },
  ];
  const camposHora = [
    { key: "hour", rotulo: tWallet("hourLabel"), texto: value.hour, vacio: tWallet("hourLabel") },
    {
      key: "minute",
      rotulo: tWallet("minuteLabel"),
      texto: value.minute,
      vacio: tWallet("minuteLabel"),
    },
  ];

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

      {/* Los cinco campos siguen separados y con su rótulo, como estaban. Lo
          único que cambia es que ya no son listas del sistema: los de fecha
          abren el panel de fecha y los de hora el de hora. */}
      <div>
        <div className="selectorGrid">
          {camposFecha.map((campo) => (
            <label className="fieldGroup" key={campo.key}>
              <span className="label">{campo.rotulo}</span>
              <button
                type="button"
                onClick={() => setWheelOpen("date")}
                disabled={disabled}
                className="field"
                style={{
                  textAlign: "start",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: disabled ? "not-allowed" : "pointer",
                  color: campo.texto ? "#fff" : "rgba(255,255,255,0.42)",
                }}
              >
                {campo.texto || campo.vacio}
              </button>
            </label>
          ))}
        </div>

        <div className="timeGrid">
          {camposHora.map((campo) => (
            <label className="fieldGroup" key={campo.key}>
              <span className="label">{campo.rotulo}</span>
              <button
                type="button"
                onClick={() => setWheelOpen("time")}
                disabled={disabled}
                className="field"
                style={{
                  textAlign: "start",
                  cursor: disabled ? "not-allowed" : "pointer",
                  color: campo.texto ? "#fff" : "rgba(255,255,255,0.42)",
                }}
              >
                {campo.texto || campo.vacio}
              </button>
            </label>
          ))}
        </div>
      </div>
      <WheelPanel
        // Se abre DESDE el modal de agendar (SessionRequestOverlay, z-index
        // 999999) y el valor por omisión del panel es 999990: quedaba justo
        // debajo y parecía que el campo no respondía. Lo advierte el propio
        // VibraResponsivePanel en su prop zIndexBase.
        zIndexBase={WHEEL_Z_BASE}
        open={wheelOpen === "date"}
        onClose={() => setWheelOpen(null)}
        onConfirm={() => setWheelOpen(null)}
        title={tCommon("date")}
        confirmLabel={tCommon("save")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        columns={[
          {
            key: "day",
            label: tWallet("dayLabel"),
            items: dayOptions.map((d) => ({ value: d, label: d })),
            value: value.day,
            onChange: (d) => updatePart("day", d),
          },
          {
            key: "month",
            label: tWallet("monthLabel"),
            items: monthOptions,
            value: value.month,
            onChange: (m) => updatePart("month", m),
            flex: 1.6,
          },
          {
            key: "year",
            label: tWallet("yearLabel"),
            items: yearOptions.map((y) => ({ value: y, label: y })),
            value: value.year,
            onChange: (y) => updatePart("year", y),
          },
        ]}
      />

      <WheelPanel
        // Se abre DESDE el modal de agendar (SessionRequestOverlay, z-index
        // 999999) y el valor por omisión del panel es 999990: quedaba justo
        // debajo y parecía que el campo no respondía. Lo advierte el propio
        // VibraResponsivePanel en su prop zIndexBase.
        zIndexBase={WHEEL_Z_BASE}
        open={wheelOpen === "time"}
        onClose={() => setWheelOpen(null)}
        onConfirm={() => setWheelOpen(null)}
        title={tCommon("time")}
        confirmLabel={tCommon("save")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        columns={[
          {
            key: "hour",
            label: tWallet("hourLabel"),
            items: hourOptions.map((h) => ({ value: h, label: h })),
            value: value.hour,
            onChange: (h) => updatePart("hour", h),
          },
          {
            key: "minute",
            label: tWallet("minuteLabel"),
            items: minuteOptions.map((m) => ({ value: m, label: m })),
            value: value.minute,
            onChange: (m) => updatePart("minute", m),
          },
        ]}
      />
    </>
  );
}