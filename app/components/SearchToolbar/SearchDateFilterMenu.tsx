"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Fecha aplicada (YYYY-MM-DD) o "". */
  fromDate: string;
  toDate: string;
  onApply: (from: string, to: string) => void;
};

type Parts = { d: string; m: string; y: string };

const MONTHS = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

function parseParts(value: string): Parts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return { d: "", m: "", y: "" };
  return { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) };
}

function composeParts(p: Parts): string {
  if (!p.y || !p.m || !p.d) return "";
  return `${p.y}-${p.m.padStart(2, "0")}-${p.d.padStart(2, "0")}`;
}

function daysInMonth(y: string, m: string): number {
  const month = m ? Number(m) : 0;
  if (!month) return 31;
  const year = y ? Number(y) : 2024; // año bisiesto por defecto (permite 29 feb)
  return new Date(year, month, 0).getDate();
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

// Estilo de campo Vibra (vibra_style.md): fondo translúcido, SIN contorno.
const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
  background: "rgba(255,255,255,0.06)",
  border: "none",
  borderRadius: 12,
  padding: "10px 12px",
  color: "#fff",
  fontSize: 13,
  lineHeight: 1.5,
  fontFamily: "inherit",
  outline: "none",
  cursor: "pointer",
};

const optionStyle: React.CSSProperties = { background: "#141414", color: "#fff" };

export default function SearchDateFilterMenu({ fromDate, toDate, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [fromParts, setFromParts] = useState<Parts>(() => parseParts(fromDate));
  const [toParts, setToParts] = useState<Parts>(() => parseParts(toDate));

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const out: number[] = [];
    for (let y = now + 1; y >= now - 6; y--) out.push(y);
    return out;
  }, []);

  const label =
    fromDate || toDate
      ? `${fromDate || "…"} hasta ${toDate || "…"}`
      : "Todas las fechas";

  function openMenu() {
    setFromParts(parseParts(fromDate));
    setToParts(parseParts(toDate));
    setClosing(false);
    setOpen(true);
  }

  function closeMenu() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 150);
  }

  function updateFrom(next: Partial<Parts>) {
    setFromParts((prev) => {
      const merged = { ...prev, ...next };
      const max = daysInMonth(merged.y, merged.m);
      if (merged.d && Number(merged.d) > max) merged.d = "";
      return merged;
    });
  }

  function updateTo(next: Partial<Parts>) {
    setToParts((prev) => {
      const merged = { ...prev, ...next };
      const max = daysInMonth(merged.y, merged.m);
      if (merged.d && Number(merged.d) > max) merged.d = "";
      return merged;
    });
  }

  function handleAccept() {
    const from = composeParts(fromParts);
    let to = composeParts(toParts);
    // "Hasta" nunca antes de "Desde".
    if (from && to && to < from) to = from;
    onApply(from, to);
    closeMenu();
  }

  function handleClear() {
    setFromParts({ d: "", m: "", y: "" });
    setToParts({ d: "", m: "", y: "" });
    onApply("", "");
    closeMenu();
  }

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && open) closeMenu();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open]);

  function renderPicker(
    title: string,
    parts: Parts,
    update: (next: Partial<Parts>) => void
  ) {
    const maxDay = daysInMonth(parts.y, parts.m);
    const dayValue = parts.d && Number(parts.d) <= maxDay ? parts.d : "";
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.74)" }}>
          {title}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <select
            aria-label={`${title} — día`}
            value={dayValue}
            onChange={(e) => update({ d: e.target.value })}
            style={selectStyle}
          >
            <option value="" style={optionStyle}>
              Día
            </option>
            {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
              <option key={d} value={String(d)} style={optionStyle}>
                {d}
              </option>
            ))}
          </select>

          <select
            aria-label={`${title} — mes`}
            value={parts.m}
            onChange={(e) => update({ m: e.target.value })}
            style={selectStyle}
          >
            <option value="" style={optionStyle}>
              Mes
            </option>
            {MONTHS.map((name, i) => (
              <option key={name} value={String(i + 1)} style={optionStyle}>
                {name}
              </option>
            ))}
          </select>

          <select
            aria-label={`${title} — año`}
            value={parts.y}
            onChange={(e) => update({ y: e.target.value })}
            style={selectStyle}
          >
            <option value="" style={optionStyle}>
              Año
            </option>
            {years.map((y) => (
              <option key={y} value={String(y)} style={optionStyle}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  const panel = open
    ? createPortal(
        <>
          <style jsx global>{`
            @keyframes vbDateFadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
            @keyframes vbDateFadeOut {
              from { opacity: 1; }
              to { opacity: 0; }
            }
            @keyframes vbDateScaleIn {
              from { opacity: 0; transform: scale(0.88); }
              to { opacity: 1; transform: scale(1); }
            }
            @keyframes vbDateScaleOut {
              from { opacity: 1; transform: scale(1); }
              to { opacity: 0; transform: scale(0.88); }
            }
          `}</style>

          {/* Backdrop */}
          <div
            onClick={closeMenu}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99990,
              background: "rgba(0,0,0,0.50)",
              animation: closing
                ? "vbDateFadeOut 0.15s ease forwards"
                : "vbDateFadeIn 0.18s ease forwards",
            }}
          />

          {/* Panel wrapper */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99991,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              padding: 16,
            }}
          >
            <div
              role="menu"
              style={{
                pointerEvents: "auto",
                width: "min(340px, 92vw)",
                background: "rgba(8,9,11,0.985)",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow:
                  "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
                backdropFilter: "blur(10px)",
                overflow: "hidden",
                animation: closing
                  ? "vbDateScaleOut 0.15s ease forwards"
                  : "vbDateScaleIn 0.18s ease forwards",
              }}
            >
              <div style={{ padding: "16px 16px 10px", display: "grid", gap: 14 }}>
                {renderPicker("Desde", fromParts, updateFrom)}
                {renderPicker("Hasta", toParts, updateTo)}
              </div>

              {/* Acciones */}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "4px 16px 10px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <button
                  type="button"
                  onClick={handleClear}
                  style={{
                    flex: 1,
                    border: "none",
                    borderRadius: 8,
                    background: "transparent",
                    color: "rgba(255,255,255,0.55)",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "8px 12px",
                    cursor: "pointer",
                    letterSpacing: "-0.01em",
                    fontFamily: "inherit",
                  }}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={handleAccept}
                  style={{
                    flex: 1,
                    border: "none",
                    borderRadius: 8,
                    background: "transparent",
                    color: "rgba(255,255,255,0.9)",
                    fontSize: 13,
                    fontWeight: 700,
                    padding: "8px 12px",
                    cursor: "pointer",
                    letterSpacing: "-0.01em",
                    fontFamily: "inherit",
                  }}
                >
                  Aceptar
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <style jsx>{`
        .dateFilterButton {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          max-width: 100%;
          min-width: 0;
          border-radius: 12px;
          border: none;
          background: transparent;
          padding: 9px 12px;
          color: rgba(255, 255, 255, 0.88);
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
          transition: background 0.18s ease;
          cursor: pointer;
          font-family: inherit;
        }

        .dateFilterButton :global(svg) {
          flex-shrink: 0;
        }

        .dateFilterButtonLabel {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dateFilterButton:hover {
          background: rgba(255, 255, 255, 0.06);
        }
      `}</style>

      <button
        type="button"
        className="dateFilterButton"
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <CalendarIcon />
        <span className="dateFilterButtonLabel">{label}</span>
      </button>

      {panel}
    </>
  );
}
