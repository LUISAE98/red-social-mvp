"use client";

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
    hour: String(date.getHours()).padStart(2, "0"),
    minute: String(date.getMinutes()).padStart(2, "0"),
  };
}

export function schedulePartsToIso(parts: ScheduleParts): string | null {
  const date = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    0,
    0
  );

  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

export default function ScheduleDateTimeSelector({
  value,
  onChange,
  disabled = false,
}: Props) {
  const currentYear = new Date().getFullYear();

  const yearOptions = Array.from({ length: 4 }, (_, index) =>
    String(currentYear + index)
  );

  const dayOptions = Array.from({ length: 31 }, (_, index) =>
    String(index + 1).padStart(2, "0")
  );

  const hourOptions = Array.from({ length: 24 }, (_, index) =>
    String(index).padStart(2, "0")
  );

  const minuteOptions = ["00", "15", "30", "45"];

  function updatePart(key: keyof ScheduleParts, nextValue: string) {
    onChange({
      ...value,
      [key]: nextValue,
    });
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
              {dayOptions.map((day) => (
                <option key={day} value={day}>
                  {day}
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
              {MONTH_OPTIONS.map((month) => (
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
              {hourOptions.map((hour) => (
                <option key={hour} value={hour}>
                  {hour}
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
              {minuteOptions.map((minute) => (
                <option key={minute} value={minute}>
                  {minute}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </>
  );
}