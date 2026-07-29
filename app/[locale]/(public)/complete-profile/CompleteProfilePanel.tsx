"use client";

// Panel presentacional de "Completar perfil". Solo UI (shell, logo, campos,
// toggle de notificaciones, botones). NO tiene lógica de auth ni de guardado:
// recibe todo por props. Lo usan dos lugares:
//   - CompleteProfileClient (flujo real, tras entrar con Google).
//   - dev/complete-profile-preview (simulador para iterar el diseño sin sesión).
// Así, al pulir aquí, se actualizan ambos.

import { useTranslations } from "next-intl";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

export default function CompleteProfilePanel({
  handle,
  firstName,
  lastName,
  onHandleChange,
  onFirstNameChange,
  onLastNameChange,
  notifOn,
  onToggleNotif,
  pushSupported,
  loading,
  msg,
  onSubmit,
  onCancel,
}: {
  handle: string;
  firstName: string;
  lastName: string;
  onHandleChange: (value: string) => void;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  notifOn: boolean;
  onToggleNotif: () => void;
  pushSupported: boolean;
  loading: boolean;
  msg: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("completeProfile");
  const fontStack = "inherit";

  const pageStyle: React.CSSProperties = {
    minHeight: "100dvh",
    display: "grid",
    placeItems: "center",
    background: "transparent",
    color: "#fff",
    fontFamily: fontStack,
    padding: 18,
    boxSizing: "border-box",
  };

  // Sin contenedor: la tarjeta va transparente (sin fondo, borde, sombra ni
  // blur). Se conserva el ancho máximo y el padding para el ritmo del contenido.
  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 420,
    padding: "28px 34px 34px",
    border: "none",
    background: "transparent",
    boxShadow: "none",
    boxSizing: "border-box",
  };

  // Título y subtítulo idénticos a los de iniciar sesión / crear cuenta.
  const titleStyle: React.CSSProperties = {
    margin: "0 0 6px",
    fontSize: "clamp(18px, 2vw, 20px)",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: 1.08,
    textAlign: "center",
  };

  const subtitleStyle: React.CSSProperties = {
    margin: "0 0 16px",
    fontSize: 12,
    fontWeight: 600,
    color: vibraPurple,
    lineHeight: 1.35,
    textAlign: "center",
  };

  const labelTextStyle: React.CSSProperties = {
    fontSize: 10.5,
    fontWeight: 500,
    color: "rgba(255,255,255,0.88)",
    lineHeight: 1.15,
  };

  // Input idéntico al de iniciar sesión / crear cuenta.
  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "rgba(255,255,255,0.11)",
    border: "none",
    borderRadius: 12,
    padding: "10px 12px",
    color: "#fff",
    fontSize: 13,
    fontFamily: fontStack,
    lineHeight: 1.5,
    outline: "none",
    WebkitAppearance: "none",
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 40,
    padding: "8px 14px",
    borderRadius: 10,
    border: "none",
    backgroundImage: `linear-gradient(100deg, ${vibraPink} 0%, ${vibraPurple} 35%, ${vibraBlue} 70%, ${vibraPink} 100%)`,
    backgroundSize: "280% 280%",
    backgroundPosition: "0% 50%",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    fontFamily: fontStack,
    cursor: "pointer",
    boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
    overflow: "hidden",
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.08)",
    backgroundImage: "none",
    boxShadow: "none",
  };

  const noticeStyle: React.CSSProperties = {
    marginTop: 10,
    borderRadius: 9,
    border: "1px solid rgba(255, 80, 80, 0.45)",
    background: "rgba(255, 40, 40, 0.10)",
    padding: "7px 9px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255, 190, 190, 0.95)",
  };

  return (
    <>
      <main style={pageStyle}>
        <div style={shellStyle}>
          <h1 style={titleStyle}>{t("title")}</h1>
          <p style={subtitleStyle}>{t("subtitle")}</p>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: 13 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>{t("usernameLabel")}</span>
              <input
                className="completeProfileInput"
                value={handle}
                onChange={(e) => onHandleChange(e.target.value)}
                style={inputStyle}
                placeholder={t("usernamePlaceholder")}
                autoComplete="username"
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>{t("firstNameLabel")}</span>
                <input
                  className="completeProfileInput"
                  value={firstName}
                  onChange={(e) => onFirstNameChange(e.target.value)}
                  style={inputStyle}
                  placeholder={t("firstNamePlaceholder")}
                  autoComplete="given-name"
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>{t("lastNameLabel")}</span>
                <input
                  className="completeProfileInput"
                  value={lastName}
                  onChange={(e) => onLastNameChange(e.target.value)}
                  style={inputStyle}
                  placeholder={t("lastNamePlaceholder")}
                  autoComplete="family-name"
                />
              </label>
            </div>

            {pushSupported && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 11px",
                  borderRadius: 10,
                  border: "none",
                  background: "rgba(255,255,255,0.035)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ ...labelTextStyle, fontWeight: 600 }}>{t("notifLabel")}</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.6)",
                      lineHeight: 1.3,
                      marginTop: 2,
                    }}
                  >
                    {t("notifHint")}
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={notifOn}
                  aria-label={t("notifLabel")}
                  onClick={onToggleNotif}
                  style={{
                    position: "relative",
                    width: 40,
                    minWidth: 40,
                    height: 22,
                    borderRadius: 999,
                    border: "none",
                    background: notifOn
                      ? "linear-gradient(100deg, #a855ff, #4f46ff)"
                      : "rgba(255,255,255,0.14)",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                    transition: "background 0.2s ease",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: notifOn ? 20 : 2,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      background: "#fff",
                      transition: "left 0.2s ease",
                    }}
                  />
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                ...primaryButtonStyle,
                marginTop: 4,
                opacity: loading ? 0.84 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? t("submitting") : t("submit")}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={onCancel}
              style={{
                ...secondaryButtonStyle,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {t("cancel")}
            </button>
          </form>

          {msg && <div style={noticeStyle}>{msg}</div>}
        </div>
      </main>
    </>
  );
}
