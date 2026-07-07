"use client";

import { CSSProperties, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import LogoutButton from "@/app/LogoutButton";
import BlockedAccountsOverlay from "./BlockedAccountsOverlay";

type ProfileSettingsTabProps = {
  isSaving?: boolean;
  isRestricted: boolean;
  onToggleRestricted: (nextValue: boolean) => Promise<void> | void;

  commentsEnabled?: boolean;
  onToggleCommentsEnabled?: (nextValue: boolean) => Promise<void> | void;
  isSavingComments?: boolean;

  uid?: string | null;
  email?: string | null;
  displayName?: string | null;
  username?: string | null;
  birthDate?: string | Date | null;
  appCreatedAt?: string | Date | null;
  displayNameLastChangedAt?: string | Date | null;

  onUpdateDisplayName?: (nextName: string) => Promise<void> | void;
  bio?: string | null;
  onUpdateBio?: (nextBio: string) => Promise<void> | void;
  onSendPasswordReset?: () => Promise<void> | void;
};

function formatDate(value?: string | Date | null) {
  if (!value) return "No disponible";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "No disponible";

  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function daysUntilNameChange(value?: string | Date | null) {
  if (!value) return 0;

  const last = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(last.getTime())) return 0;

  const nextAllowed = last.getTime() + 60 * 24 * 60 * 60 * 1000;
  const diff = nextAllowed - Date.now();

  if (diff <= 0) return 0;

  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes profileSettingsGearSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          animation: "profileSettingsGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
        }}
      >
        ⚙
      </span>
    </>
  );
}

function FullScreenModal({
  open,
  children,
  onClose,
}: {
  open: boolean;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        background: "rgba(0,0,0,0.76)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding:
          "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>,
    document.body
  );
}

function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={label}
      title={label}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.08)",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 160ms ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 160ms ease",
        }}
      />
    </button>
  );
}

export default function ProfileSettingsTab({
  isSaving = false,
  isRestricted,
  onToggleRestricted,
  commentsEnabled = true,
  onToggleCommentsEnabled,
  isSavingComments = false,
  uid = null,
  email = null,
  displayName,
  username,
  birthDate,
  appCreatedAt,
  displayNameLastChangedAt = null,
  onUpdateDisplayName,
  bio = null,
  onUpdateBio,
  onSendPasswordReset,
}: ProfileSettingsTabProps) {
  const [localRestricted, setLocalRestricted] = useState(isRestricted);
  const [localCommentsEnabled, setLocalCommentsEnabled] = useState(commentsEnabled);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editBioOpen, setEditBioOpen] = useState(false);
  const [blockedAccountsOpen, setBlockedAccountsOpen] = useState(false);
  const [draftName, setDraftName] = useState(displayName ?? "");
  const [draftBio, setDraftBio] = useState(bio ?? "");
  const [savingName, setSavingName] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [sendingPassword, setSendingPassword] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { toast: settingsToast, showToast: showSettingsToast } = useVibraToast();
  useEffect(() => { if (err) showSettingsToast(err, "error"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLocalRestricted(isRestricted);
  }, [isRestricted]);

  useEffect(() => {
    setLocalCommentsEnabled(commentsEnabled);
  }, [commentsEnabled]);

  useEffect(() => {
    setDraftName(displayName ?? "");
  }, [displayName]);

  useEffect(() => {
    setDraftBio(bio ?? "");
  }, [bio]);

  const fontStack =
    'inherit';

  const remainingDays = daysUntilNameChange(displayNameLastChangedAt);
  const canChangeName = remainingDays <= 0;

  const resolvedDisplayName = displayName?.trim() || "No disponible";
  const resolvedUsername = username?.trim()
    ? `@${username.trim()}`
    : "No disponible";
  const resolvedEmail = email?.trim() || "No disponible";
  const resolvedBirthDate = formatDate(birthDate);
  const resolvedAppCreatedAt = formatDate(appCreatedAt);
  const restrictedHelpText = localRestricted
    ? "Reservado: nadie verá tus servicios, publicaciones ni comentarios desde tu perfil, incluyendo personas sin sesión."
    : "Público: las personas, incluso sin sesión, podrán ver tus servicios activos y publicaciones públicas.";

  const commentsHelpText = localCommentsEnabled
    ? "Abiertos: cualquiera que te siga puede comentar en tus publicaciones."
    : "Restringidos: solo tú puedes comentar en tus publicaciones.";

  async function handleCommentsEnabledChange(nextValue: boolean) {
    if (isSavingComments || !onToggleCommentsEnabled) return;

    setLocalCommentsEnabled(nextValue);
    setMsg(null);
    setErr(null);

    try {
      await onToggleCommentsEnabled(nextValue);
      setMsg(nextValue ? "Comentarios abiertos." : "Comentarios restringidos.");
    } catch (error: unknown) {
      setLocalCommentsEnabled(!nextValue);
      setErr((error instanceof Error ? error.message : null) ?? "No se pudo actualizar la configuración de comentarios.");
    }
  }

  async function handleRestrictedChange(nextValue: boolean) {
    if (isSaving) return;

    setLocalRestricted(nextValue);
    setMsg(null);
    setErr(null);

    try {
      await onToggleRestricted(nextValue);
      setMsg(nextValue ? "Perfil reservado activado." : "Perfil público activado.");
    } catch (error: unknown) {
      setLocalRestricted(!nextValue);
      setErr((error instanceof Error ? error.message : null) ?? "No se pudo actualizar el perfil reservado.");
    }
  }

  async function handleSaveName() {
    if (!onUpdateDisplayName) {
      setErr("Falta conectar la función para cambiar nombre.");
      return;
    }

    const nextName = draftName.trim();

    if (nextName.length < 3) {
      setErr("El nombre debe tener al menos 3 caracteres.");
      return;
    }

    if (!canChangeName) {
      setErr(`Podrás cambiar tu nombre nuevamente en ${remainingDays} día(s).`);
      return;
    }

    setSavingName(true);
    setMsg(null);
    setErr(null);

    try {
      await onUpdateDisplayName(nextName);
      setMsg("Nombre actualizado.");
      setEditNameOpen(false);
    } catch (error: unknown) {
      setErr((error instanceof Error ? error.message : null) ?? "No se pudo actualizar el nombre.");
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveBio() {
    if (!onUpdateBio) return;

    setSavingBio(true);
    setMsg(null);
    setErr(null);

    try {
      await onUpdateBio(draftBio);
      setMsg("Descripción actualizada.");
      setEditBioOpen(false);
    } catch (error: unknown) {
      setErr((error instanceof Error ? error.message : null) ?? "No se pudo actualizar la descripción.");
    } finally {
      setSavingBio(false);
    }
  }

  async function handlePasswordReset() {
    if (!onSendPasswordReset) {
      setErr("Falta conectar el envío de correo para cambiar contraseña.");
      return;
    }

    setSendingPassword(true);
    setMsg(null);
    setErr(null);

    try {
      await onSendPasswordReset();
      setMsg("Te enviamos un correo para cambiar tu contraseña.");
    } catch (error: unknown) {
      setErr((error instanceof Error ? error.message : null) ?? "No se pudo enviar el correo de cambio de contraseña.");
    } finally {
      setSendingPassword(false);
    }
  }

  const outer: CSSProperties = {
    display: "grid",
    gap: 12,
    width: "100%",
    minWidth: 0,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.2,
    color: "#fff",
  };

  const panel: CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 12,
    display: "grid",
    gap: 10,
    width: "100%",
    minWidth: 0,
    boxSizing: "border-box",
  };

  const item: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };

  const labelStyle: CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.2,
  };

  const valueStyle: CSSProperties = {
    marginTop: 4,
    fontSize: 14,
    color: "rgba(255,255,255,0.92)",
    fontWeight: 600,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  };

  const buttonStyle: CSSProperties = {
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const logoutButtonStyle: CSSProperties = {
    ...buttonStyle,
    width: "100%",
    justifyContent: "center",
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 46,
    padding: "0 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    fontSize: 14,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const noticeStyle: CSSProperties = {
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    padding: "9px 11px",
    fontSize: 12,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.84)",
  };

  const modalCard: CSSProperties = {
    width: "min(560px, calc(100vw - 32px))",
    maxHeight: "calc(100dvh - 32px)",
    overflowY: "auto",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.16)",
    background:
      "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
    color: "#fff",
    boxShadow: "0 24px 90px rgba(0,0,0,0.78)",
    padding: 18,
    display: "grid",
    gap: 14,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  return (
    <section style={outer}>
      <style jsx>{`
        .profile-logout-button {
          min-height: 36px;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.07);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          font-family: ${fontStack};
          cursor: pointer;
          white-space: nowrap;
        }

        .profile-logout-button:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .profile-logout-button:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .profile-logout-wrap {
          width: 180px;
          max-width: 100%;
        }

        @media (max-width: 520px) {
          .profile-setting-item {
            grid-template-columns: 1fr !important;
          }

          .profile-setting-button,
          .profile-logout-button,
          .profile-logout-wrap {
            width: 100%;
          }
        }
      `}</style>

      <h3 style={titleStyle}>Configuración de perfil</h3>

      <div style={panel}>
        <div className="profile-setting-item" style={item}>
          <div>
            <div style={labelStyle}>Perfil reservado</div>
            <div style={valueStyle}>
  {localRestricted ? "Activado" : "Desactivado"}
</div>

<div
  style={{
    marginTop: 5,
    fontSize: 11.5,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.4,
    maxWidth: 620,
  }}
>
  {restrictedHelpText}
</div>
          </div>

          <Switch
            checked={localRestricted}
            disabled={isSaving}
            onChange={handleRestrictedChange}
            label={
              localRestricted
                ? "Desactivar perfil reservado"
                : "Activar perfil reservado"
            }
          />
        </div>

        {onToggleCommentsEnabled && (
          <div className="profile-setting-item" style={item}>
            <div>
              <div style={labelStyle}>Comentarios en mis publicaciones</div>
              <div style={valueStyle}>
                {localCommentsEnabled ? "Abiertos" : "Solo yo"}
              </div>
              <div
                style={{
                  marginTop: 5,
                  fontSize: 11.5,
                  color: "rgba(255,255,255,0.58)",
                  lineHeight: 1.4,
                  maxWidth: 620,
                }}
              >
                {commentsHelpText}
              </div>
            </div>

            <Switch
              checked={localCommentsEnabled}
              disabled={isSavingComments}
              onChange={handleCommentsEnabledChange}
              label={
                localCommentsEnabled
                  ? "Restringir comentarios a solo yo"
                  : "Abrir comentarios a seguidores"
              }
            />
          </div>
        )}

        <div className="profile-setting-item" style={item}>
          <div>
            <div style={labelStyle}>Nombre</div>
            <div style={valueStyle}>{resolvedDisplayName}</div>
            {!canChangeName && (
              <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.50)" }}>
                Disponible en {remainingDays} día(s).
              </div>
            )}
          </div>

          <button
            className="profile-setting-button"
            type="button"
            style={{
              ...buttonStyle,
              opacity: canChangeName ? 1 : 0.55,
              cursor: canChangeName ? "pointer" : "not-allowed",
            }}
            disabled={!canChangeName}
            onClick={() => {
              setErr(null);
              setMsg(null);
              setDraftName(resolvedDisplayName === "No disponible" ? "" : resolvedDisplayName);
              setEditNameOpen(true);
            }}
          >
            Modificar
          </button>
        </div>

        {onUpdateBio && (
          <div className="profile-setting-item" style={item}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>Descripción del perfil</div>
              <div
                style={{
                  ...valueStyle,
                  fontWeight: 400,
                  color: bio?.trim()
                    ? "rgba(255,255,255,0.82)"
                    : "rgba(255,255,255,0.38)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {bio?.trim() || "Sin descripción"}
              </div>
            </div>

            <button
              className="profile-setting-button"
              type="button"
              style={buttonStyle}
              onClick={() => {
                setErr(null);
                setMsg(null);
                setDraftBio(bio ?? "");
                setEditBioOpen(true);
              }}
            >
              Modificar
            </button>
          </div>
        )}

        <div className="profile-setting-item" style={item}>
          <div>
            <div style={labelStyle}>Usuario</div>
            <div style={valueStyle}>{resolvedUsername}</div>
          </div>
        </div>

        <div className="profile-setting-item" style={item}>
          <div>
            <div style={labelStyle}>Correo</div>
            <div style={valueStyle}>{resolvedEmail}</div>
          </div>

          <button
            className="profile-setting-button"
            type="button"
            style={{
              ...buttonStyle,
              opacity: sendingPassword ? 0.7 : 1,
              cursor: sendingPassword ? "not-allowed" : "pointer",
            }}
            disabled={sendingPassword}
            onClick={handlePasswordReset}
          >
            {sendingPassword ? "Enviando..." : "Cambiar contraseña"}
          </button>
        </div>

        <div className="profile-setting-item" style={item}>
          <div>
            <div style={labelStyle}>Fecha de nacimiento</div>
            <div style={valueStyle}>{resolvedBirthDate}</div>
          </div>
        </div>

        <div className="profile-setting-item" style={item}>
          <div>
            <div style={labelStyle}>Fecha de creación</div>
            <div style={valueStyle}>{resolvedAppCreatedAt}</div>
          </div>
        </div>

        <div className="profile-setting-item" style={item}>
          <div>
            <div style={labelStyle}>Cuentas bloqueadas</div>
            <div style={valueStyle}>Perfiles y comunidades</div>

            <div
              style={{
                marginTop: 5,
                fontSize: 11.5,
                color: "rgba(255,255,255,0.58)",
                lineHeight: 1.4,
                maxWidth: 620,
              }}
            >
              Consulta los perfiles que bloqueaste y las cuentas bloqueadas dentro
              de comunidades.
            </div>
          </div>

          <button
            className="profile-setting-button"
            type="button"
            style={buttonStyle}
            onClick={() => {
              setErr(null);
              setMsg(null);
              setBlockedAccountsOpen(true);
            }}
          >
            Ver
          </button>
        </div>

        <div
          className="profile-logout-wrap"
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: 10,
            margin: "0 auto",
          }}
        >
<LogoutButton
  variant="settings"
  className="profile-setting-button"
  style={logoutButtonStyle}
/>
        </div>

        <VibraToast toast={settingsToast} />
        {msg && <div style={noticeStyle}>{msg}</div>}
      </div>

      <FullScreenModal open={editNameOpen} onClose={() => !savingName && setEditNameOpen(false)}>
        <div style={modalCard} onClick={(e) => e.stopPropagation()}>
          <strong style={{ fontSize: 16, color: "#fff", lineHeight: 1.2 }}>
            Modificar nombre
          </strong>

          <input
            style={inputStyle}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Nombre visible"
          />

          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.4 }}>
            Podrás volver a cambiar tu nombre después de 60 días.
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => !savingName && setEditNameOpen(false)}
              disabled={savingName}
              style={{
                ...buttonStyle,
                flex: "1 1 140px",
                opacity: savingName ? 0.7 : 1,
                cursor: savingName ? "not-allowed" : "pointer",
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSaveName}
              disabled={savingName}
              style={{
                ...buttonStyle,
                flex: "1 1 160px",
                background: savingName ? "rgba(255,255,255,0.16)" : "#fff",
                color: savingName ? "#fff" : "#000",
                opacity: savingName ? 0.8 : 1,
                cursor: savingName ? "not-allowed" : "pointer",
              }}
            >
              {savingName ? (
                <>
                  <SpinningGear /> Guardando...
                </>
              ) : (
                "Guardar"
              )}
            </button>
          </div>
        </div>
      </FullScreenModal>

      <FullScreenModal open={editBioOpen} onClose={() => !savingBio && setEditBioOpen(false)}>
        <div style={modalCard} onClick={(e) => e.stopPropagation()}>
          <strong style={{ fontSize: 16, color: "#fff", lineHeight: 1.2 }}>
            Descripción del perfil
          </strong>

          <textarea
            style={{
              ...inputStyle,
              minHeight: 110,
              padding: "10px 12px",
              resize: "vertical",
            }}
            value={draftBio}
            onChange={(e) => setDraftBio(e.target.value.slice(0, 300))}
            placeholder="Cuéntale a tu audiencia quién eres..."
            maxLength={300}
          />

          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", textAlign: "right" }}>
            {draftBio.length}/300
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => !savingBio && setEditBioOpen(false)}
              disabled={savingBio}
              style={{
                ...buttonStyle,
                flex: "1 1 140px",
                opacity: savingBio ? 0.7 : 1,
                cursor: savingBio ? "not-allowed" : "pointer",
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={handleSaveBio}
              disabled={savingBio}
              style={{
                ...buttonStyle,
                flex: "1 1 160px",
                background: savingBio ? "rgba(255,255,255,0.16)" : "#fff",
                color: savingBio ? "#fff" : "#000",
                opacity: savingBio ? 0.8 : 1,
                cursor: savingBio ? "not-allowed" : "pointer",
              }}
            >
              {savingBio ? (
                <>
                  <SpinningGear /> Guardando...
                </>
              ) : (
                "Guardar"
              )}
            </button>
          </div>
        </div>
      </FullScreenModal>

      <BlockedAccountsOverlay
        open={blockedAccountsOpen}
        currentUserId={uid}
        onClose={() => setBlockedAccountsOpen(false)}
      />
    </section>
  );
}