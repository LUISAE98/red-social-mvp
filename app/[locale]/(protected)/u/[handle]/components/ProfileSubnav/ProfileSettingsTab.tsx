"use client";

import { CSSProperties, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import LogoutButton from "@/app/LogoutButton";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import BlockedAccountsOverlay from "@/components/profile/BlockedAccountsOverlay";
import SessionsOverlay from "@/components/profile/SessionsOverlay";
import { usePushNotifications } from "@/lib/hooks/usePushNotifications";
import {
  PWD_RESET_COOLDOWN_S, SpinningGear, Switch,
  daysUntilNameChange, formatDate, pwdResetKey,
  type ProfileSettingsTabProps,
} from "@/components/profile/ProfileSettings.parts";
import MessagePolicySetting from "@/components/chat/MessagePolicySetting";
import SocialLinksEditor, {
  draftHasInvalidHandle,
  socialLinksToDraft,
} from "@/components/profile/SocialLinksEditor";
import { listSocialLinks } from "@/lib/profile/socialNetworks";
import type { MessagePolicy } from "@/lib/chat/types";

export default function ProfileSettingsTab({
  isSaving = false,
  isRestricted,
  onToggleRestricted,
  commentsEnabled = true,
  onToggleCommentsEnabled,
  isSavingComments = false,
  messagePolicy = "everyone",
  onChangeMessagePolicy,
  isSavingMessagePolicy = false,
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
  socialLinks = null,
  onUpdateSocialLinks,
  onSendPasswordReset,
}: ProfileSettingsTabProps) {
  const [localRestricted, setLocalRestricted] = useState(isRestricted);
  const [localCommentsEnabled, setLocalCommentsEnabled] = useState(commentsEnabled);
  const [localMessagePolicy, setLocalMessagePolicy] = useState<MessagePolicy>(messagePolicy);
  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editBioOpen, setEditBioOpen] = useState(false);
  const [editSocialOpen, setEditSocialOpen] = useState(false);
  const [draftSocial, setDraftSocial] = useState(() => socialLinksToDraft(socialLinks));
  const [savingSocial, setSavingSocial] = useState(false);
  // Las redes ya guardadas, para el resumen de la fila; y si lo tecleado tiene
  // algo que no sirve, para no dejar guardar.
  const savedSocial = listSocialLinks(socialLinks);
  const socialDraftInvalid = draftHasInvalidHandle(draftSocial);
  const [blockedAccountsOpen, setBlockedAccountsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [draftName, setDraftName] = useState(displayName ?? "");
  const [draftBio, setDraftBio] = useState(bio ?? "");
  const [savingName, setSavingName] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [sendingPassword, setSendingPassword] = useState(false);
  const [passwordSent, setPasswordSent] = useState(false);
  const [pwdCooldown, setPwdCooldown] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { toast: settingsToast, showToast: showSettingsToast } = useVibraToast();
  const tCommon = useTranslations("common");
  const tProfile = useTranslations("profile");
  const locale = useLocale();
  const push = usePushNotifications(uid);

  async function handlePushChange(nextValue: boolean) {
    if (push.busy) return;
    setMsg(null);
    setErr(null);
    const res = await push.toggle(nextValue);
    if (nextValue && !res.ok) {
      if (res.reason === "denied") setErr(tProfile("pushDenied"));
      else if (res.reason === "unsupported") setErr(tProfile("pushUnsupported"));
      else if (res.reason !== "dismissed") setErr(tProfile("pushError"));
      return;
    }
    if (res.ok) setMsg(nextValue ? tProfile("pushEnabledMsg") : tProfile("pushDisabledMsg"));
  }
  useEffect(() => { if (err) showSettingsToast(err, "error"); }, [err]); // eslint-disable-line react-hooks/exhaustive-deps
  // Los mensajes de éxito salen como VibraToast (no como letrero al fondo).
  useEffect(() => { if (msg) showSettingsToast(msg, "success"); }, [msg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Recalcula el cooldown del correo de contraseña cada segundo, leyendo el
  // timestamp persistido (sobrevive recargas). Fuente de verdad: localStorage.
  useEffect(() => {
    const key = pwdResetKey(uid ?? email);
    const compute = () => {
      const raw =
        typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      const sentAt = raw ? Number(raw) || 0 : 0;
      if (!sentAt) {
        setPwdCooldown(0);
        return;
      }
      const remaining = Math.ceil(
        (sentAt + PWD_RESET_COOLDOWN_S * 1000 - Date.now()) / 1000
      );
      if (remaining > 0) {
        setPwdCooldown(remaining);
        setPasswordSent(true);
      } else {
        setPwdCooldown(0);
      }
    };
    compute();
    const id = window.setInterval(compute, 1000);
    return () => window.clearInterval(id);
  }, [uid, email]);

  useEffect(() => {
    setLocalRestricted(isRestricted);
  }, [isRestricted]);

  useEffect(() => {
    setLocalCommentsEnabled(commentsEnabled);
  }, [commentsEnabled]);

  useEffect(() => {
    setLocalMessagePolicy(messagePolicy);
  }, [messagePolicy]);

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
  const unavailableText = tProfile("unavailable");

  const resolvedDisplayName = displayName?.trim() || unavailableText;
  const resolvedUsername = username?.trim()
    ? `@${username.trim()}`
    : unavailableText;
  const resolvedEmail = email?.trim() || unavailableText;
  const resolvedBirthDate = formatDate(birthDate, locale) ?? unavailableText;
  const resolvedAppCreatedAt = formatDate(appCreatedAt, locale) ?? unavailableText;
  const restrictedHelpText = localRestricted
    ? tProfile("reservedHelpActive")
    : tProfile("publicHelpActive");

  const commentsHelpText = localCommentsEnabled
    ? tProfile("commentsOpenHelp")
    : tProfile("commentsRestrictedHelp");

  async function handleCommentsEnabledChange(nextValue: boolean) {
    if (isSavingComments || !onToggleCommentsEnabled) return;

    setLocalCommentsEnabled(nextValue);
    setMsg(null);
    setErr(null);

    try {
      await onToggleCommentsEnabled(nextValue);
      setMsg(nextValue ? tProfile("commentsOpenMsg") : tProfile("commentsRestrictedMsg"));
    } catch (error: unknown) {
      setLocalCommentsEnabled(!nextValue);
      setErr((error instanceof Error ? error.message : null) ?? tProfile("commentsUpdateError"));
    }
  }

  async function handleMessagePolicyChange(next: MessagePolicy) {
    if (isSavingMessagePolicy || !onChangeMessagePolicy) return;

    const previous = localMessagePolicy;
    setLocalMessagePolicy(next);
    setMsg(null);
    setErr(null);

    try {
      await onChangeMessagePolicy(next);
    } catch {
      setLocalMessagePolicy(previous);
      // Siempre el texto traducido: los Error del servicio son guardas internas
      // en español y mostrarlos crudos rompería el idioma de la interfaz.
      setErr(tProfile("messagePolicyUpdateError"));
    }
  }

  async function handleRestrictedChange(nextValue: boolean) {
    if (isSaving) return;

    setLocalRestricted(nextValue);
    setMsg(null);
    setErr(null);

    try {
      await onToggleRestricted(nextValue);
      setMsg(nextValue ? tProfile("profileReservedActive") : tProfile("profilePublicActive"));
    } catch (error: unknown) {
      setLocalRestricted(!nextValue);
      setErr((error instanceof Error ? error.message : null) ?? tProfile("profileUpdateError"));
    }
  }

  async function handleSaveName() {
    if (!onUpdateDisplayName) {
      setErr(tProfile("nameConnectError"));
      return;
    }

    const nextName = draftName.trim();

    if (nextName.length < 3) {
      setErr(tProfile("nameMinLengthError"));
      return;
    }

    if (!canChangeName) {
      setErr(tProfile("nameChangeCooldown", { days: remainingDays }));
      return;
    }

    setSavingName(true);
    setMsg(null);
    setErr(null);

    try {
      await onUpdateDisplayName(nextName);
      setMsg(tProfile("nameUpdated"));
      setEditNameOpen(false);
    } catch (error: unknown) {
      setErr((error instanceof Error ? error.message : null) ?? tProfile("nameUpdateError"));
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
      setMsg(tProfile("descriptionUpdated"));
      setEditBioOpen(false);
    } catch (error: unknown) {
      setErr((error instanceof Error ? error.message : null) ?? tProfile("descriptionError"));
    } finally {
      setSavingBio(false);
    }
  }

  async function handleSaveSocialLinks() {
    if (!onUpdateSocialLinks) return;

    setSavingSocial(true);
    setMsg(null);
    setErr(null);

    try {
      await onUpdateSocialLinks(draftSocial);
      setMsg(tProfile("socialLinksUpdated"));
      setEditSocialOpen(false);
    } catch (error: unknown) {
      setErr((error instanceof Error ? error.message : null) ?? tProfile("socialLinksError"));
    } finally {
      setSavingSocial(false);
    }
  }

  async function handlePasswordReset() {
    if (sendingPassword || pwdCooldown > 0) return;

    if (!onSendPasswordReset) {
      setErr(tProfile("passwordEmailConnectError"));
      return;
    }

    setSendingPassword(true);
    setMsg(null);
    setErr(null);

    try {
      await onSendPasswordReset();
      // Marca el envío y arranca el cooldown (persistido para sobrevivir recargas).
      try {
        window.localStorage.setItem(pwdResetKey(uid ?? email), String(Date.now()));
      } catch {
        /* localStorage no disponible: el cooldown vivirá solo en memoria */
      }
      setPasswordSent(true);
      setPwdCooldown(PWD_RESET_COOLDOWN_S);
    } catch (error: unknown) {
      setErr((error instanceof Error ? error.message : null) ?? tProfile("passwordEmailError"));
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
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#fff",
  };

  const panel: CSSProperties = {
    background: "transparent",
    padding: 0,
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
    position: "relative",
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

  // Mismo estilo que el botón de desbloquear/cerrar sesión (gris neutro), pero
  // cubriendo todo el renglón.
  const logoutButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: 40,
    borderRadius: 6,
    border: "none",
    background: "rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.70)",
    fontWeight: 500,
    fontSize: 13,
    fontFamily: fontStack,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };

  // Campo de texto canónico de Vibra (vibra_style.md → "Textarea"): sin borde,
  // fondo rgba(255,255,255,0.06), radio 12, fontSize 13, lineHeight 1.5.
  const inputStyle: CSSProperties = {
    width: "100%",
    minHeight: 46,
    padding: "10px 12px",
    borderRadius: 12,
    border: "none",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    lineHeight: 1.5,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
    appearance: "none",
  };


  // Botones del footer de los paneles (estilo canónico vibra_style.md).
  const panelPrimaryBtn: CSSProperties = {
    flex: 1,
    minHeight: 42,
    borderRadius: 5,
    border: "none",
    background: "#a855f7",
    color: "rgba(255,255,255,0.98)",
    fontSize: 16,
    fontWeight: 500,
    fontFamily: fontStack,
    letterSpacing: "-0.02em",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  };

  const panelPrimaryBtnDisabled: CSSProperties = {
    ...panelPrimaryBtn,
    background: "rgba(255,255,255,0.1)",
    color: "rgba(255,255,255,0.36)",
    cursor: "not-allowed",
  };

  const panelSecondaryBtn: CSSProperties = {
    flex: "0 0 auto",
    minHeight: 42,
    padding: "0 16px",
    borderRadius: 5,
    border: "none",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontSize: 15,
    fontWeight: 500,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  return (
    <section style={outer}>
      <style jsx>{`
        /* Placeholder canónico de Vibra (vibra_style.md → "Textarea"): atenuado
           en rgba(255,255,255,0.42). opacity:1 evita que Firefox lo baje más. */
        .vibra-panel-input::placeholder {
          color: rgba(255, 255, 255, 0.42);
          opacity: 1;
        }

        /* Línea sutil bajo cada opción, igual a la de la pestaña de experiencias
           (.owner-sidebar-menu-divider): 1px, inset 6px, rgba(255,255,255,0.1). */
        .profile-setting-item::after {
          content: "";
          position: absolute;
          inset-inline-start: 6px;
          inset-inline-end: 6px;
          bottom: 0;
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
        }

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
          width: 100%;
          max-width: 100%;
        }

        @media (max-width: 520px) {
          .profile-setting-item {
            grid-template-columns: 1fr !important;
          }

          /* Las filas con switch (restringido y comentarios) mantienen el switch
             a la derecha, inline con el texto, igual que en experiencias. */
          .profile-setting-item--switch,
          .profile-setting-item--action {
            grid-template-columns: minmax(0, 1fr) auto !important;
          }

          /* Nombre y Descripción se quedan en un mismo renglón (dos columnas)
             también en celular: nombre a la izquierda, descripción a la derecha. */
          .profile-setting-item--split {
            grid-template-columns: 1fr 1fr !important;
            gap: 12px !important;
          }

          .profile-setting-button,
          .profile-logout-button,
          .profile-logout-wrap {
            width: 100%;
          }
        }
      `}</style>

      <h3 style={titleStyle}>{tProfile("settingsTitle")}</h3>

      <div style={panel}>
        <div className="profile-setting-item profile-setting-item--switch" style={item}>
          <div>
            <div style={labelStyle}>{tProfile("restricted")}</div>
            <div style={valueStyle}>
  {localRestricted ? tProfile("enabled") : tProfile("disabled")}
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
                ? tProfile("disableReserved")
                : tProfile("enableReserved")
            }
          />
        </div>

        {onToggleCommentsEnabled && (
          <div className="profile-setting-item profile-setting-item--switch" style={item}>
            <div>
              <div style={labelStyle}>{tProfile("commentsLabel")}</div>
              <div style={valueStyle}>
                {localCommentsEnabled ? tProfile("commentsOpen") : tProfile("commentsRestricted")}
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
                  ? tProfile("restrictComments")
                  : tProfile("openComments")
              }
            />
          </div>
        )}

        {onChangeMessagePolicy && (
          // A una sola columna: son cuatro opciones con etiquetas largas, no un
          // switch, y no caben en la columna estrecha de la derecha.
          <div
            className="profile-setting-item"
            style={{ ...item, gridTemplateColumns: "1fr", gap: 8 }}
          >
            {/* Sin texto de ayuda aquí: cada opción trae su propia descripción,
                como en el selector de visibilidad del compositor de lives. */}
            <div style={labelStyle}>{tProfile("messagePolicyLabel")}</div>

            <MessagePolicySetting
              value={localMessagePolicy}
              disabled={isSavingMessagePolicy}
              onChange={handleMessagePolicyChange}
            />
          </div>
        )}

        {push.supported === true && (
          <div className="profile-setting-item profile-setting-item--switch" style={item}>
            <div>
              <div style={labelStyle}>{tProfile("pushLabel")}</div>
              <div style={valueStyle}>
                {push.enabled ? tProfile("pushOn") : tProfile("pushOff")}
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
                {push.permission === "denied"
                  ? tProfile("pushDeniedHint")
                  : tProfile("pushHint")}
              </div>
            </div>

            <Switch
              checked={push.enabled}
              disabled={push.busy || push.permission === "denied"}
              onChange={handlePushChange}
              label={push.enabled ? tProfile("disablePush") : tProfile("enablePush")}
            />
          </div>
        )}

        <div
          className="profile-setting-item profile-setting-item--split"
          style={{
            ...item,
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* Nombre — columna izquierda (contenido centrado) */}
          <div style={{ display: "grid", gap: 8, minWidth: 0, justifyItems: "center", textAlign: "center" }}>
            <div>
              <div style={labelStyle}>{tProfile("nameFieldLabel")}</div>
              <div style={valueStyle}>{resolvedDisplayName}</div>
            </div>

            {canChangeName ? (
              <button
                type="button"
                style={{
                  justifySelf: "center",
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  color: "#a855f7",
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: fontStack,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                onClick={() => {
                  setErr(null);
                  setMsg(null);
                  setDraftName(resolvedDisplayName === unavailableText ? "" : resolvedDisplayName);
                  setEditNameOpen(true);
                }}
              >
                {tProfile("changeNameLabel")}
              </button>
            ) : (
              <div
                style={{
                  justifySelf: "center",
                  fontSize: 10,
                  fontWeight: 400,
                  lineHeight: 1.35,
                  color: "rgba(255,255,255,0.38)",
                  maxWidth: 220,
                }}
              >
                {tProfile("nameChangeCountdown", { days: remainingDays })}
              </div>
            )}
          </div>

          {/* Usuario — columna derecha (contenido centrado) */}
          <div style={{ minWidth: 0, textAlign: "center" }}>
            <div style={labelStyle}>{tProfile("usernameFieldLabel")}</div>
            <div style={valueStyle}>{resolvedUsername}</div>
          </div>
        </div>

        {onUpdateBio && (
          <div className="profile-setting-item" style={item}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("bioFieldLabel")}</div>
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
                {bio?.trim() || tProfile("noDescription")}
              </div>
            </div>

            <button
              type="button"
              style={{
                justifySelf: "center",
                alignSelf: "center",
                border: "none",
                background: "transparent",
                padding: 0,
                color: "#a855f7",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: fontStack,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onClick={() => {
                setErr(null);
                setMsg(null);
                setDraftBio(bio ?? "");
                setEditBioOpen(true);
              }}
            >
              {tProfile("editLabel")}
            </button>
          </div>
        )}

        {onUpdateSocialLinks && (
          <div className="profile-setting-item" style={item}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("socialLinksFieldLabel")}</div>
              <div
                style={{
                  ...valueStyle,
                  fontWeight: 400,
                  color: savedSocial.length
                    ? "rgba(255,255,255,0.82)"
                    : "rgba(255,255,255,0.38)",
                  wordBreak: "break-word",
                }}
              >
                {savedSocial.length
                  ? savedSocial.map((s) => s.label).join(" · ")
                  : tProfile("socialLinksNone")}
              </div>
            </div>

            <button
              type="button"
              style={{
                justifySelf: "center",
                alignSelf: "center",
                border: "none",
                background: "transparent",
                padding: 0,
                color: "#a855f7",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: fontStack,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onClick={() => {
                setErr(null);
                setMsg(null);
                // Se rearma desde lo guardado al abrir: si cancelaron la vez
                // pasada, lo tecleado a medias no debe seguir ahí.
                setDraftSocial(socialLinksToDraft(socialLinks));
                setEditSocialOpen(true);
              }}
            >
              {tProfile("editLabel")}
            </button>
          </div>
        )}

        <div className="profile-setting-item profile-setting-item--action" style={item}>
          <div>
            <div style={labelStyle}>{tProfile("emailFieldLabel")}</div>
            <div style={valueStyle}>{resolvedEmail}</div>
          </div>

          <div
            style={{
              display: "grid",
              gap: 6,
              justifyItems: passwordSent ? "center" : "end",
              minWidth: 0,
            }}
          >
            {passwordSent && (
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 400,
                  lineHeight: 1.35,
                  color: "rgba(255,255,255,0.42)",
                  textAlign: "center",
                  maxWidth: 240,
                }}
              >
                {tProfile("passwordEmailSentLegend", { email: resolvedEmail })}
              </div>
            )}

            <button
              type="button"
              style={{
                justifySelf: passwordSent ? "center" : "end",
                alignSelf: "center",
                border: "none",
                background: "transparent",
                padding: 0,
                color: "#a855f7",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: fontStack,
                cursor:
                  sendingPassword || pwdCooldown > 0 ? "not-allowed" : "pointer",
                opacity: sendingPassword || pwdCooldown > 0 ? 0.6 : 1,
                whiteSpace: "nowrap",
              }}
              disabled={sendingPassword || pwdCooldown > 0}
              onClick={handlePasswordReset}
            >
              {sendingPassword
                ? tCommon("sending")
                : pwdCooldown > 0
                ? tProfile("resendEmailIn", { seconds: pwdCooldown })
                : passwordSent
                ? tProfile("sendNewEmail")
                : tProfile("changePasswordLabel")}
            </button>
          </div>
        </div>

        <div
          className="profile-setting-item profile-setting-item--split"
          style={{
            ...item,
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            alignItems: "start",
          }}
        >
          {/* Fecha de nacimiento — columna izquierda (centrada) */}
          <div style={{ minWidth: 0, textAlign: "center" }}>
            <div style={labelStyle}>{tProfile("birthDateFieldLabel")}</div>
            <div style={valueStyle}>{resolvedBirthDate}</div>
          </div>

          {/* Fecha de creación — columna derecha (centrada) */}
          <div style={{ minWidth: 0, textAlign: "center" }}>
            <div style={labelStyle}>{tProfile("creationDateFieldLabel")}</div>
            <div style={valueStyle}>{resolvedAppCreatedAt}</div>
          </div>
        </div>

        <div className="profile-setting-item profile-setting-item--action" style={item}>
          <div>
            <div style={labelStyle}>{tProfile("blockedAccountsLabel")}</div>
            <div style={valueStyle}>{tProfile("profilesAndCommunities")}</div>

            <div
              style={{
                marginTop: 5,
                fontSize: 11.5,
                color: "rgba(255,255,255,0.58)",
                lineHeight: 1.4,
                maxWidth: 620,
              }}
            >
              {tProfile("blockedProfilesHint")}
            </div>
          </div>

          <button
            type="button"
            style={{
              justifySelf: "center",
              alignSelf: "center",
              border: "none",
              background: "transparent",
              padding: 0,
              color: "#a855f7",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: fontStack,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            onClick={() => {
              setErr(null);
              setMsg(null);
              setBlockedAccountsOpen(true);
            }}
          >
            {tCommon("viewLabel")}
          </button>
        </div>

        <div className="profile-setting-item profile-setting-item--action" style={item}>
          <div>
            <div style={labelStyle}>{tProfile("sessionsLabel")}</div>
            <div style={valueStyle}>{tProfile("sessionsValue")}</div>

            <div
              style={{
                marginTop: 5,
                fontSize: 11.5,
                color: "rgba(255,255,255,0.58)",
                lineHeight: 1.4,
                maxWidth: 620,
              }}
            >
              {tProfile("sessionsHint")}
            </div>
          </div>

          <button
            type="button"
            style={{
              justifySelf: "center",
              alignSelf: "center",
              border: "none",
              background: "transparent",
              padding: 0,
              color: "#a855f7",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: fontStack,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
            onClick={() => {
              setErr(null);
              setMsg(null);
              setSessionsOpen(true);
            }}
          >
            {tCommon("viewLabel")}
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
      </div>

      <VibraResponsivePanel
        open={editNameOpen}
        onClose={() => !savingName && setEditNameOpen(false)}
        title={tProfile("editNameTitle")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        maxWidthDesktop={440}
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={() => !savingName && setEditNameOpen(false)}
              disabled={savingName}
              style={{ ...panelSecondaryBtn, opacity: savingName ? 0.7 : 1, cursor: savingName ? "not-allowed" : "pointer" }}
            >
              {tCommon("cancel")}
            </button>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={savingName}
              style={savingName ? panelPrimaryBtnDisabled : panelPrimaryBtn}
            >
              {savingName ? (
                <>
                  <SpinningGear /> {tCommon("saving")}
                </>
              ) : (
                tCommon("save")
              )}
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          <input
            className="vibra-panel-input"
            style={inputStyle}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={tProfile("namePlaceholder")}
          />

          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", lineHeight: 1.4 }}>
            {tProfile("nameChangeNote")}
          </div>
        </div>
      </VibraResponsivePanel>

      <VibraResponsivePanel
        open={editBioOpen}
        onClose={() => !savingBio && setEditBioOpen(false)}
        title={tProfile("bioFieldLabel")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        maxWidthDesktop={440}
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={handleSaveBio}
              disabled={savingBio}
              style={savingBio ? panelPrimaryBtnDisabled : panelPrimaryBtn}
            >
              {savingBio ? (
                <>
                  <SpinningGear /> {tCommon("saving")}
                </>
              ) : (
                tCommon("save")
              )}
            </button>
            <button
              type="button"
              onClick={() => !savingBio && setEditBioOpen(false)}
              disabled={savingBio}
              style={{
                flex: 1,
                minHeight: 42,
                borderRadius: 5,
                border: "none",
                background: "rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.70)",
                fontWeight: 500,
                fontSize: 13,
                fontFamily: fontStack,
                display: "grid",
                placeItems: "center",
                cursor: savingBio ? "not-allowed" : "pointer",
                opacity: savingBio ? 0.7 : 1,
              }}
            >
              {tCommon("cancel")}
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          <textarea
            className="vibra-panel-input"
            style={{
              ...inputStyle,
              minHeight: 110,
              padding: "10px 12px",
              resize: "vertical",
            }}
            value={draftBio}
            onChange={(e) => setDraftBio(e.target.value.slice(0, 300))}
            placeholder={tProfile("bioPlaceholder")}
            maxLength={300}
          />

          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.42)", textAlign: "end" }}>
            {draftBio.length}/300
          </div>
        </div>
      </VibraResponsivePanel>

      <VibraResponsivePanel
        open={editSocialOpen}
        onClose={() => !savingSocial && setEditSocialOpen(false)}
        title={tProfile("socialLinksFieldLabel")}
        closeAriaLabel={tCommon("closeAriaLabel")}
        maxWidthDesktop={440}
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={handleSaveSocialLinks}
              disabled={savingSocial || socialDraftInvalid}
              style={
                savingSocial || socialDraftInvalid
                  ? panelPrimaryBtnDisabled
                  : panelPrimaryBtn
              }
            >
              {savingSocial ? (
                <>
                  <SpinningGear /> {tCommon("saving")}
                </>
              ) : (
                tCommon("save")
              )}
            </button>
            <button
              type="button"
              onClick={() => !savingSocial && setEditSocialOpen(false)}
              disabled={savingSocial}
              style={{
                flex: 1,
                minHeight: 42,
                borderRadius: 5,
                border: "none",
                background: "rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.70)",
                fontWeight: 500,
                fontSize: 13,
                fontFamily: fontStack,
                display: "grid",
                placeItems: "center",
                cursor: savingSocial ? "not-allowed" : "pointer",
                opacity: savingSocial ? 0.7 : 1,
              }}
            >
              {tCommon("cancel")}
            </button>
          </div>
        }
      >
        <SocialLinksEditor
          value={draftSocial}
          onChange={setDraftSocial}
          disabled={savingSocial}
        />
      </VibraResponsivePanel>

      <BlockedAccountsOverlay
        open={blockedAccountsOpen}
        currentUserId={uid}
        onClose={() => setBlockedAccountsOpen(false)}
      />

      <SessionsOverlay
        open={sessionsOpen}
        currentUserId={uid}
        onClose={() => setSessionsOpen(false)}
      />
    </section>
  );
}