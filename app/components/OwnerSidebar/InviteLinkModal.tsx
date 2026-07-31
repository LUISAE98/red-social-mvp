"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { createInviteLink } from "@/lib/groups/inviteLinks";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type Props = {
  groupId: string;
  onClose: () => void;
  /** Se dispara tras crear un link con éxito, para refrescar la lista del dueño. */
  onCreated?: () => void;
};

type Unit = "minutes" | "hours" | "days";

const fontStack =
  'inherit';

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

export default function InviteLinkModal({ groupId, onClose, onCreated }: Props) {
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
    const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [unit, setUnit] = useState<Unit>("days");
  const { toast: inviteToast, showToast: showInviteToast } = useVibraToast();
  const [durationValue, setDurationValue] = useState("7");
  const [maxUsesValue, setMaxUsesValue] = useState("");

  const durationLabel = useMemo(() => {
    if (unit === "days") return tGroups("daysLabel");
    if (unit === "hours") return tGroups("hoursLabel");
    return tGroups("minutesLabel");
  }, [unit, tGroups]);

  function convertToHours(value: number, selectedUnit: Unit) {
    if (selectedUnit === "days") return value * 24;
    if (selectedUnit === "hours") return value;
    return value / 60;
  }

  function validateDuration(value: number, selectedUnit: Unit) {
    if (!Number.isFinite(value) || value <= 0) {
      return tGroups("durationPositiveError");
    }

    if (selectedUnit === "minutes" && value > 43200) {
      return tGroups("minutesRangeError");
    }

    if (selectedUnit === "hours" && value > 720) {
      return tGroups("hoursRangeError");
    }

    if (selectedUnit === "days" && value > 30) {
      return tGroups("daysRangeError");
    }

    const expiresInHours = convertToHours(value, selectedUnit);

    if (expiresInHours < 1 / 60 || expiresInHours > 720) {
      return tGroups("totalValidityError");
    }

    return null;
  }

  async function handleCreate() {
    try {
      setLoading(true);

      const parsedDuration = Number(durationValue.trim());
      const parsedMaxUses =
        maxUsesValue.trim() === "" ? null : Number(maxUsesValue.trim());

      const durationError = validateDuration(parsedDuration, unit);
      if (durationError) {
        showInviteToast(durationError, "error");
        return;
      }

      if (
        parsedMaxUses !== null &&
        (!Number.isInteger(parsedMaxUses) ||
          parsedMaxUses < 1 ||
          parsedMaxUses > 1000)
      ) {
        showInviteToast(tGroups("maxUsesRangeError"), "error");
        return;
      }

      const expiresInHours = convertToHours(parsedDuration, unit);

      const res = await createInviteLink({
        groupId,
        expiresInHours,
        maxUses: parsedMaxUses,
      });

      setLink(`${window.location.origin}/invite/${res.token}`);
      showInviteToast(tGroups("linkGeneratedSuccess"), "success");
      onCreated?.();
    } catch (e: unknown) {
      console.error(e);
      showInviteToast((e instanceof Error ? e.message : null) ?? tGroups("linkCreateError"), "error");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!link) return;

    try {
      const ok = await copyToClipboardWithFallback(link);

      if (!ok) {
        showInviteToast(
          tGroups("copyManuallyError"),
          "error"
        );
        return;
      }

      showInviteToast(tCommon("linkCopiedToClipboard"), "success");
    } catch {
      showInviteToast(tGroups("copyManuallyError"), "error");
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
    padding: "16px 16px calc(16px + var(--vb-safe-bottom, 0px))",
    boxSizing: "border-box",
    fontFamily: fontStack,
    minHeight: "100dvh",
    backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
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

  useBodyScrollLock(true);

  if (!mounted) return null;
    return createPortal(
    <>
    <VibraToast toast={inviteToast} />
    <div
      style={overlayStyle}
      onClick={() => {
        if (!loading) onClose();
      }}
    >
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>{tGroups("inviteLinkTitle")}</h2>
          <p style={subtitleStyle}>
            {tGroups("inviteLinkSubtitle")}
          </p>
        </div>

        <div style={bodyStyle}>
          {!link ? (
            <>
              <label style={labelStyle}>
                <span style={labelTextStyle}>{tGroups("durationField")}</span>

                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={durationValue}
                  onChange={(e) =>
                    setDurationValue(sanitizeNumeric(e.target.value))
                  }
                  placeholder={tGroups("quantityPlaceholder")}
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
                          ? tGroups("minutesLabel")
                          : item === "hours"
                          ? tGroups("hoursLabel")
                          : tGroups("daysLabel")}
                      </button>
                    );
                  })}
                </div>

                <span style={hintStyle}>
                  {unit === "days" ? tGroups("durationHintDays") : unit === "hours" ? tGroups("durationHintHours") : tGroups("durationHintMinutes")}
                </span>
              </label>

              <label style={labelStyle}>
                <span style={labelTextStyle}>{tGroups("maxUsesField")}</span>

                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={maxUsesValue}
                  onChange={(e) =>
                    setMaxUsesValue(sanitizeNumeric(e.target.value))
                  }
                  placeholder={tGroups("maxUsesPlaceholder")}
                  style={inputStyle}
                />

                <span style={hintStyle}>
                  {tGroups("maxUsesHint")}
                </span>
              </label>

              <div style={noticeStyle}>
                {unit === "days"
                  ? tGroups("expiresInDays", { count: parsedDuration || 0 })
                  : unit === "hours"
                  ? tGroups("expiresInHours", { count: parsedDuration || 0 })
                  : tGroups("expiresInMinutes", { count: parsedDuration || 0 })}
              </div>

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
                  {loading ? tGroups("generatingLink") : tGroups("generateLink")}
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
                  {tCommon("cancel")}
                </button>
              </div>
            </>
          ) : (
            <>
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


              <div style={{ display: "grid", gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={handleCopy}
                  style={primaryButtonStyle}
                >
                  {tGroups("copyLinkButton")}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLink(null);
                  }}
                  style={secondaryButtonStyle}
                >
                  {tGroups("createAnotherLink")}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  style={ghostButtonStyle}
                >
                  {tCommon("close")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
     </div>
    </>,
    document.body
  );
}