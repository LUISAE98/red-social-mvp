"use client";

// Panel presentacional del onboarding de perfil (alta por Google). Mismo acomodo
// que "Crear cuenta": bloque portada + foto (estilo placeholder), luego los
// campos. Maneja internamente el recorte de foto y portada y entrega los blobs
// por callback; el resto son valores controlados. Identidad (handle/nombre) se
// muestra solo cuando `showIdentity` es true (usuario nuevo sin doc).

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import ImageCropperModal from "@/components/media/ImageCropperModal";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855f7";
const vibraBlue = "#4f46ff";

export default function CompleteProfilePanel({
  showIdentity,
  handle,
  firstName,
  lastName,
  onHandleChange,
  onFirstNameChange,
  onLastNameChange,
  initialPhotoUrl,
  onAvatarBlobChange,
  onCoverBlobChange,
  bio,
  onBioChange,
  notifOn,
  onToggleNotif,
  pushSupported,
  loading,
  msg,
  onSubmit,
  onCancel,
}: {
  showIdentity: boolean;
  handle: string;
  firstName: string;
  lastName: string;
  onHandleChange: (value: string) => void;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  /** Foto del proveedor (Google) para prellenar el avatar; null si no tiene. */
  initialPhotoUrl?: string | null;
  onAvatarBlobChange: (blob: Blob | null) => void;
  onCoverBlobChange: (blob: Blob | null) => void;
  bio: string;
  onBioChange: (value: string) => void;
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

  // Recorte de foto/portada (interno; entrega blobs al padre).
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  // El avatar arranca con la foto de Google (URL remota) si existe.
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialPhotoUrl ?? null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<"avatar" | "cover">("avatar");

  const avatarPreviewRef = useRef<string | null>(null);
  avatarPreviewRef.current = avatarPreview;
  const coverPreviewRef = useRef<string | null>(null);
  coverPreviewRef.current = coverPreview;
  const cropSrcRef = useRef<string | null>(null);
  cropSrcRef.current = cropSrc;
  useEffect(
    () => () => {
      // Solo revocamos object URLs (blob:), no la foto remota de Google.
      if (avatarPreviewRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(avatarPreviewRef.current);
      }
      if (coverPreviewRef.current) URL.revokeObjectURL(coverPreviewRef.current);
      if (cropSrcRef.current) URL.revokeObjectURL(cropSrcRef.current);
    },
    []
  );

  function onPickImage(
    e: React.ChangeEvent<HTMLInputElement>,
    mode: "avatar" | "cover"
  ) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCropMode(mode);
    setCropSrc(URL.createObjectURL(file));
    setCropOpen(true);
  }

  function closeCrop() {
    setCropOpen(false);
    if (cropSrc) {
      URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
    }
  }

  function handleCropConfirm(blob: Blob) {
    if (cropMode === "avatar") {
      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
      setAvatarPreview(URL.createObjectURL(blob));
      onAvatarBlobChange(blob);
    } else {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      setCoverPreview(URL.createObjectURL(blob));
      onCoverBlobChange(blob);
    }
    closeCrop();
  }

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

  // Asterisco morado para marcar campos obligatorios.
  const req = <span style={{ color: vibraPurple }}> *</span>;

  return (
    <>
      <h1 style={titleStyle}>{t("title")}</h1>
      <p style={subtitleStyle}>{t("subtitle")}</p>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: 13 }}>
            {/* Portada + foto de perfil (mismo acomodo/estilo que crear cuenta). */}
            <div style={{ position: "relative", width: "100%", marginBottom: 66 }}>
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                aria-label={coverPreview ? t("coverChange") : t("coverAdd")}
                style={{
                  position: "relative",
                  width: "100%",
                  height: 110,
                  borderRadius: 12,
                  border: "none",
                  background: "rgba(255,255,255,0.11)",
                  overflow: "hidden",
                  cursor: "pointer",
                  padding: 0,
                  display: "grid",
                  placeItems: "center",
                  color: "#a855f7",
                }}
              >
                {coverPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ position: "absolute", top: 14, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <circle cx="9" cy="10" r="1.6" />
                      <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17M14 14l1.5-1.5a2 2 0 0 1 2.8 0L21 15" />
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>{t("coverAdd")}</span>
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                aria-label={avatarPreview ? t("photoChange") : t("photoAdd")}
                style={{
                  position: "absolute",
                  left: "50%",
                  top: 66,
                  transform: "translateX(-50%)",
                  width: 84,
                  height: 84,
                  borderRadius: "50%",
                  border: "3px solid #0a0710",
                  background: "#d9d9de",
                  overflow: "hidden",
                  cursor: "pointer",
                  padding: 0,
                  display: "grid",
                  placeItems: "center",
                  color: "#a855f7",
                  boxShadow: "0 8px 20px rgba(0,0,0,0.35)",
                }}
              >
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }} />
                ) : (
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M14.5 4h-5L8 6H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-4l-1.5-2Z" />
                    <circle cx="12" cy="13" r="3.2" />
                  </svg>
                )}
              </button>

              {/* Texto: agregar / cambiar foto de perfil (debajo del avatar). */}
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  top: 156,
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: "center",
                }}
              >
                {avatarPreview ? t("photoChange") : t("photoAdd")}
              </button>

              <input ref={coverInputRef} type="file" accept="image/*" onChange={(e) => onPickImage(e, "cover")} style={{ display: "none" }} />
              <input ref={avatarInputRef} type="file" accept="image/*" onChange={(e) => onPickImage(e, "avatar")} style={{ display: "none" }} />
            </div>

            {showIdentity && (
              <>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={labelTextStyle}>{t("usernameLabel")}{req}</span>
                  <input
                    value={handle}
                    onChange={(e) => onHandleChange(e.target.value)}
                    style={inputStyle}
                    placeholder={t("usernamePlaceholder")}
                    autoComplete="username"
                  />
                </label>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={labelTextStyle}>{t("firstNameLabel")}{req}</span>
                    <input
                      value={firstName}
                      onChange={(e) => onFirstNameChange(e.target.value)}
                      style={inputStyle}
                      placeholder={t("firstNamePlaceholder")}
                      autoComplete="given-name"
                    />
                  </label>

                  <label style={{ display: "grid", gap: 4 }}>
                    <span style={labelTextStyle}>{t("lastNameLabel")}{req}</span>
                    <input
                      value={lastName}
                      onChange={(e) => onLastNameChange(e.target.value)}
                      style={inputStyle}
                      placeholder={t("lastNamePlaceholder")}
                      autoComplete="family-name"
                    />
                  </label>
                </div>
              </>
            )}

            {/* Bio (opcional) */}
            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>{t("bioLabel")}</span>
              <textarea
                value={bio}
                onChange={(e) => onBioChange(e.target.value.slice(0, 300))}
                style={{ ...inputStyle, minHeight: 74, resize: "vertical", lineHeight: 1.45 }}
                placeholder={t("bioPlaceholder")}
                maxLength={300}
              />
            </label>

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
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", lineHeight: 1.3, marginTop: 2 }}>
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
                      ? "linear-gradient(100deg, #a855f7, #4f46ff)"
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

      <ImageCropperModal
        open={cropOpen}
        title={cropMode === "avatar" ? t("cropPhotoTitle") : t("cropCoverTitle")}
        hint={cropMode === "avatar" ? t("cropPhotoHint") : t("cropCoverHint")}
        imageSrc={cropSrc}
        aspect={cropMode === "avatar" ? 1 : 16 / 9}
        cropShape={cropMode === "avatar" ? "round" : "rect"}
        onClose={closeCrop}
        onConfirm={handleCropConfirm}
      />
    </>
  );
}
