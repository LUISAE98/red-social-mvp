"use client";

// Panel presentacional del onboarding de perfil. Solo UI; la lógica (auth,
// guardado) vive en quien lo monta (CompleteProfileClient real, o el simulador
// dev). Maneja internamente el recorte de PORTADA (con ImageCropperModal) y
// entrega el blob por `onCoverBlobChange`; el resto son valores controlados.
// Identidad (handle/nombre) se muestra solo cuando `showIdentity` es true
// (usuario nuevo de Google que aún no tiene doc). Estilos = iniciar sesión.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import ImageCropperModal from "@/components/media/ImageCropperModal";
import { GROUP_CATEGORY_LABELS, type CanonicalGroupCategory } from "@/types/group";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

// Categorías ofrecidas como tags (todas menos "otros", que es fallback interno).
const TAG_CATEGORIES = (
  Object.keys(GROUP_CATEGORY_LABELS) as CanonicalGroupCategory[]
).filter((c) => c !== "otros");

export default function CompleteProfilePanel({
  showIdentity,
  handle,
  firstName,
  lastName,
  onHandleChange,
  onFirstNameChange,
  onLastNameChange,
  onCoverBlobChange,
  bio,
  onBioChange,
  selectedTags,
  onToggleTag,
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
  /** Entrega el blob de portada recortado (o null si se quita). */
  onCoverBlobChange: (blob: Blob | null) => void;
  bio: string;
  onBioChange: (value: string) => void;
  selectedTags: CanonicalGroupCategory[];
  onToggleTag: (category: CanonicalGroupCategory) => void;
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

  // Recorte de portada (interno al panel; entrega el blob al padre).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);

  const coverPreviewRef = useRef<string | null>(null);
  coverPreviewRef.current = coverPreview;
  const cropSrcRef = useRef<string | null>(null);
  cropSrcRef.current = cropSrc;
  useEffect(
    () => () => {
      if (coverPreviewRef.current) URL.revokeObjectURL(coverPreviewRef.current);
      if (cropSrcRef.current) URL.revokeObjectURL(cropSrcRef.current);
    },
    []
  );

  function onCoverFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
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
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverPreview(URL.createObjectURL(blob));
    onCoverBlobChange(blob);
    closeCrop();
  }

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

  // Sin contenedor: la tarjeta va transparente.
  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 420,
    padding: "28px 34px 34px",
    border: "none",
    background: "transparent",
    boxShadow: "none",
    boxSizing: "border-box",
  };

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

  return (
    <>
      <main style={pageStyle}>
        <div style={shellStyle}>
          <h1 style={titleStyle}>{t("title")}</h1>
          <p style={subtitleStyle}>{t("subtitle")}</p>

          <form onSubmit={onSubmit} style={{ display: "grid", gap: 13 }}>
            {showIdentity && (
              <>
                <label style={{ display: "grid", gap: 4 }}>
                  <span style={labelTextStyle}>{t("usernameLabel")}</span>
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
                    <span style={labelTextStyle}>{t("firstNameLabel")}</span>
                    <input
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

            {/* Portada */}
            <div style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>{t("coverLabel")}</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label={coverPreview ? t("coverChange") : t("coverAdd")}
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "16 / 9",
                  borderRadius: 12,
                  border: coverPreview ? "none" : "1px dashed rgba(168,85,255,0.5)",
                  background: "rgba(255,255,255,0.06)",
                  overflow: "hidden",
                  cursor: "pointer",
                  padding: 0,
                  color: "#a855ff",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {coverPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverPreview}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <circle cx="9" cy="10" r="1.6" />
                      <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17M14 14l1.5-1.5a2 2 0 0 1 2.8 0L21 15" />
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{t("coverAdd")}</span>
                  </span>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={onCoverFileSelected}
                style={{ display: "none" }}
              />
            </div>

            {/* Bio */}
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

            {/* Tags / intereses */}
            <div style={{ display: "grid", gap: 6 }}>
              <span style={labelTextStyle}>{t("tagsLabel")}</span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", lineHeight: 1.3 }}>
                {t("tagsHint")}
              </span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 2 }}>
                {TAG_CATEGORIES.map((cat) => {
                  const on = selectedTags.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => onToggleTag(cat)}
                      aria-pressed={on}
                      style={{
                        padding: "6px 11px",
                        borderRadius: 999,
                        border: on ? "none" : "1px solid rgba(168,85,255,0.3)",
                        background: on
                          ? "linear-gradient(100deg, #a855ff, #4f46ff)"
                          : "rgba(255,255,255,0.06)",
                        color: on ? "#fff" : "rgba(255,255,255,0.82)",
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                    >
                      {GROUP_CATEGORY_LABELS[cat]}
                    </button>
                  );
                })}
              </div>
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

      <ImageCropperModal
        open={cropOpen}
        title={t("cropCoverTitle")}
        hint={t("cropCoverHint")}
        imageSrc={cropSrc}
        aspect={16 / 9}
        cropShape="rect"
        onClose={closeCrop}
        onConfirm={handleCropConfirm}
      />
    </>
  );
}
