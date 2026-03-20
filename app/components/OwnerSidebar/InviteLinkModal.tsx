"use client";

import { useMemo, useState } from "react";
import { createInviteLink } from "@/lib/groups/inviteLinks";

type Props = {
  groupId: string;
  onClose: () => void;
};

type Unit = "minutes" | "hours" | "days";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function friendlyUnitLabel(unit: Unit, value: number) {
  if (unit === "days") return value === 1 ? "día" : "días";
  if (unit === "hours") return value === 1 ? "hora" : "horas";
  return value === 1 ? "minuto" : "minutos";
}

function sanitizeNumeric(value: string) {
  return value.replace(/\D/g, "");
}

async function copyToClipboardWithFallback(text: string) {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof window !== "undefined" &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (typeof document === "undefined") return false;

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    const ok = document.execCommand("copy");
    document.body.removeChild(textArea);
    return ok;
  } catch {
    document.body.removeChild(textArea);
    return false;
  }
}

export default function InviteLinkModal({ groupId, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("days");
  const [durationValue, setDurationValue] = useState("7");
  const [maxUsesValue, setMaxUsesValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const durationLabel = useMemo(() => {
    if (unit === "days") return "Días";
    if (unit === "hours") return "Horas";
    return "Minutos";
  }, [unit]);

  function convertToHours(value: number, selectedUnit: Unit) {
    if (selectedUnit === "days") return value * 24;
    if (selectedUnit === "hours") return value;
    return value / 60;
  }

  function validateDuration(value: number, selectedUnit: Unit) {
    if (!Number.isFinite(value) || value <= 0) {
      return "La duración debe ser mayor a 0.";
    }

    if (selectedUnit === "minutes" && value > 43200) {
      return "Los minutos deben estar entre 1 y 43200.";
    }

    if (selectedUnit === "hours" && value > 720) {
      return "Las horas deben estar entre 1 y 720.";
    }

    if (selectedUnit === "days" && value > 30) {
      return "Los días deben estar entre 1 y 30.";
    }

    const expiresInHours = convertToHours(value, selectedUnit);

    if (expiresInHours < 1 / 60 || expiresInHours > 720) {
      return "La vigencia total debe estar entre 1 minuto y 30 días.";
    }

    return null;
  }

  async function handleCreate() {
    try {
      setLoading(true);
      setError(null);
      setCopied(false);

      const parsedDuration = Number(durationValue.trim());
      const parsedMaxUses =
        maxUsesValue.trim() === "" ? null : Number(maxUsesValue.trim());

      const durationError = validateDuration(parsedDuration, unit);
      if (durationError) {
        setError(durationError);
        return;
      }

      if (
        parsedMaxUses !== null &&
        (!Number.isInteger(parsedMaxUses) ||
          parsedMaxUses < 1 ||
          parsedMaxUses > 1000)
      ) {
        setError("Los usos máximos deben estar entre 1 y 1000.");
        return;
      }

      const expiresInHours = convertToHours(parsedDuration, unit);

      const res = await createInviteLink({
        groupId,
        expiresInHours,
        maxUses: parsedMaxUses,
      });

      setLink(`${window.location.origin}/invite/${res.token}`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Error creando link.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!link) return;

    try {
      const ok = await copyToClipboardWithFallback(link);

      if (!ok) {
        setError(
          "No se pudo copiar automáticamente. Mantén presionado el link y cópialo manualmente."
        );
        setCopied(false);
        return;
      }

      setCopied(true);
      setError(null);
    } catch {
      setError(
        "No se pudo copiar automáticamente. Mantén presionado el link y cópialo manualmente."
      );
      setCopied(false);
    }
  }

  const parsedDuration = Number(durationValue || "0");

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 10050,
    background: "rgba(0,0,0,0.78)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px 16px calc(16px + env(safe-area-inset-bottom))",
    boxSizing: "border-box",
    fontFamily: fontStack,
    minHeight: "100dvh",
    backdropFilter: "blur(6px)",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 360,
    maxHeight: "min(88dvh, 720px)",
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background:
      "radial-gradient(circle at top, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.018) 18%, #0a0a0a 52%)",
    color: "#fff",
    boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    boxSizing: "border-box",
  };

  const headerStyle: React.CSSProperties = {
    padding: "16px 16px 10px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "18px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: 1.08,
  };

  const subtitleStyle: React.CSSProperties = {
    margin: "5px 0 0 0",
    fontSize: 12,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.66)",
  };

  const bodyStyle: React.CSSProperties = {
    padding: 16,
    display: "grid",
    gap: 10,
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "grid",
    gap: 6,
  };

  const labelTextStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 500,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.15,
  };

  const hintStyle: React.CSSProperties = {
    fontSize: 10,
    lineHeight: 1.25,
    color: "rgba(255,255,255,0.60)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    padding: "0 11px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    transition: "border-color 0.18s ease, background 0.18s ease",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "7px 9px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  const errorStyle: React.CSSProperties = {
    ...noticeStyle,
    border: "1px solid rgba(248,113,113,0.22)",
    background: "rgba(239,68,68,0.12)",
    color: "#fecaca",
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
    boxSizing: "border-box",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
  };

  const ghostButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 34,
    padding: "6px 10px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.78)",
    fontSize: 10.5,
    fontWeight: 400,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  return (
    <div
      style={overlayStyle}
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Link de invitación</h2>
          <p style={subtitleStyle}>
            Genera un acceso privado con vigencia personalizada.
          </p>
        </div>

        <div style={bodyStyle}>
          {!link ? (
            <>
              <label style={labelStyle}>
                <span style={labelTextStyle}>Duración</span>

                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={durationValue}
                  onChange={(e) =>
                    setDurationValue(sanitizeNumeric(e.target.value))
                  }
                  placeholder="Cantidad"
                  style={inputStyle}
                />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 6,
                  }}
                >
                  {(["minutes", "hours", "days"] as Unit[]).map((item) => {
                    const active = unit === item;

                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setUnit(item)}
                        style={{
                          height: 40,
                          borderRadius: 8,
                          border: active
                            ? "1px solid rgba(255,255,255,0.92)"
                            : "1px solid rgba(255,255,255,0.12)",
                          background: active
                            ? "#fff"
                            : "rgba(255,255,255,0.035)",
                          color: active ? "#000" : "#fff",
                          fontSize: 12.5,
                          fontWeight: 600,
                          fontFamily: fontStack,
                          cursor: "pointer",
                        }}
                      >
                        {item === "minutes"
                          ? "Minutos"
                          : item === "hours"
                          ? "Horas"
                          : "Días"}
                      </button>
                    );
                  })}
                </div>

                <span style={hintStyle}>
                  Define cuántos {durationLabel.toLowerCase()} estará activo.
                </span>
              </label>

              <label style={labelStyle}>
                <span style={labelTextStyle}>Usos máximos</span>

                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={maxUsesValue}
                  onChange={(e) =>
                    setMaxUsesValue(sanitizeNumeric(e.target.value))
                  }
                  placeholder="Déjalo vacío para ilimitado"
                  style={inputStyle}
                />

                <span style={hintStyle}>
                  Déjalo vacío para ilimitado. Rango permitido: 1 a 1000.
                </span>
              </label>

              <div style={noticeStyle}>
                El link expirará en {parsedDuration || 0}{" "}
                {friendlyUnitLabel(unit, parsedDuration || 0)}.
              </div>

              {error && <div style={errorStyle}>{error}</div>}

              <div style={{ display: "grid", gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={loading}
                  style={{
                    ...(loading ? secondaryButtonStyle : primaryButtonStyle),
                    opacity: loading ? 0.84 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Generando..." : "Generar link"}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={loading}
                  style={{
                    ...secondaryButtonStyle,
                    opacity: loading ? 0.6 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={noticeStyle}>
                Link generado. Ya puedes copiarlo y compartirlo.
              </div>

              <div
                style={{
                  ...inputStyle,
                  height: "auto",
                  minHeight: 72,
                  padding: "10px 11px",
                  lineHeight: 1.4,
                  wordBreak: "break-all",
                  display: "block",
                }}
              >
                {link}
              </div>

              {error && <div style={errorStyle}>{error}</div>}

              {copied && (
                <div style={noticeStyle}>Link copiado al portapapeles.</div>
              )}

              <div style={{ display: "grid", gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={handleCopy}
                  style={primaryButtonStyle}
                >
                  Copiar link
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLink(null);
                    setCopied(false);
                    setError(null);
                  }}
                  style={secondaryButtonStyle}
                >
                  Crear otro link
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  style={ghostButtonStyle}
                >
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}