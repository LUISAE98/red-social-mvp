"use client";

/**
 * Módulo de Configuración del OwnerSidebar.
 *
 * En celular el sidebar es lo primero que aparece al entrar al propio perfil, y
 * llegar a los ajustes obligaba a cerrarlo, cargar el perfil y buscar la pestaña
 * de Configuración. Este módulo trae ahí abajo el subconjunto que se consulta a
 * diario, sin duplicar la pestaña completa del perfil: los interruptores de
 * privacidad del perfil (restringido, comentarios) siguen viviendo solo allá,
 * porque se tocan una vez y se olvidan.
 *
 * Es un módulo INDEPENDIENTE del acordeón de seguidos/comunidades de arriba
 * (OwnerSidebarTabNav), igual que Mensajes: se pliega solo, con su propio
 * estado, y no cierra las otras secciones al abrirse.
 *
 * Los datos se cargan en diferido: el listener de `users/{uid}` no se engancha
 * hasta que el módulo se abre por primera vez. Un sidebar que ya monta ~10
 * onSnapshot no necesita uno más para algo que la mayoría nunca despliega.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslations, useLocale } from "next-intl";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import LogoutButton from "@/app/LogoutButton";
import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";
import BlockedAccountsOverlay from "@/components/profile/BlockedAccountsOverlay";
import SessionsOverlay from "@/components/profile/SessionsOverlay";
import {
  PWD_RESET_COOLDOWN_S,
  SpinningGear,
  Switch,
  daysUntilNameChange,
  formatDate,
  pwdResetKey,
} from "@/components/profile/ProfileSettings.parts";
import MessagePolicySetting from "@/components/chat/MessagePolicySetting";
import { usePrivateProfile } from "@/lib/auth/usePrivateProfile";
import { updateMessagePolicy } from "@/lib/chat/messagePolicyService";
import { updateProfileDisplayName } from "@/lib/profile/updateProfileDisplayName";
import { isMessagePolicy, type MessagePolicy } from "@/lib/chat/types";
import { usePushNotifications } from "@/lib/hooks/usePushNotifications";
import type { ToastType } from "@/lib/hooks/useVibraToast";
import { SidebarSettingsIcon } from "@/app/components/VibraServiceIcons/OwnerSidebarNavIcons/OwnerSidebarNavIcons";

type SettingsDoc = {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  handle: string | null;
  bio: string | null;
  messagePolicy: MessagePolicy;
  birthDate: string | Date | null;
  createdAt: string | Date | null;
  displayNameLastChangedAt: string | Date | null;
};

type FirestoreDateLike =
  | string
  | Date
  | { toDate?: () => Date }
  | null
  | undefined;

function toDateValue(value: FirestoreDateLike): string | Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate();
  }
  return null;
}

export default function OwnerSidebarSettings({
  uid,
  email,
  onToast,
}: {
  uid: string | null;
  email: string | null;
  /** Reusa el VibraToast del sidebar; no montamos una segunda capa de toasts. */
  onToast: (text: string | null, type?: ToastType) => void;
}) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tProfile = useTranslations("profile");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  // Una vez abierto, el listener se queda: volver a plegar el módulo no debe
  // tirar la suscripción y recargar todo al reabrirlo.
  const [everOpened, setEverOpened] = useState(false);
  const [data, setData] = useState<SettingsDoc | null>(null);

  const [editNameOpen, setEditNameOpen] = useState(false);
  const [editBioOpen, setEditBioOpen] = useState(false);
  const [blockedAccountsOpen, setBlockedAccountsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const [draftName, setDraftName] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingBio, setSavingBio] = useState(false);
  const [savingMessagePolicy, setSavingMessagePolicy] = useState(false);
  const [localMessagePolicy, setLocalMessagePolicy] =
    useState<MessagePolicy>("everyone");
  const [sendingPassword, setSendingPassword] = useState(false);
  const [passwordSent, setPasswordSent] = useState(false);
  const [pwdCooldown, setPwdCooldown] = useState(0);

  const push = usePushNotifications(uid);

  // Datos personales del propio dueño (correo, fecha de nacimiento, sexo). Ya no
  // viven en el documento público del perfil, que lee cualquiera.
  const privateProfile = usePrivateProfile(uid, everOpened);

  // El toast se dispara desde handlers async; guardarlo en ref evita re-suscribir
  // el listener de Firestore cada vez que el padre re-renderiza.
  const toastRef = useRef(onToast);
  useEffect(() => {
    toastRef.current = onToast;
  }, [onToast]);

  useEffect(() => {
    if (!everOpened || !uid) return;

    const unsub = onSnapshot(
      doc(db, "users", uid),
      (snap) => {
        const raw = snap.data() as Record<string, unknown> | undefined;
        if (!raw) {
          setData(null);
          return;
        }

        const policy = raw.messagePolicy;

        setData({
          displayName: (raw.displayName as string) ?? null,
          firstName: (raw.firstName as string) ?? null,
          lastName: (raw.lastName as string) ?? null,
          handle: (raw.handle as string) ?? null,
          bio: (raw.bio as string) ?? null,
          messagePolicy: isMessagePolicy(policy) ? policy : "everyone",
          // La fecha de nacimiento ya no está en el documento público; se lee
          // aparte con `usePrivateProfile`. El fallback a `raw.birthDate`
          // sostiene a los perfiles que aún no pasaron por la migración.
          birthDate: toDateValue(
            (privateProfile?.birthDate ?? raw.birthDate) as FirestoreDateLike
          ),
          createdAt: toDateValue(raw.createdAt as FirestoreDateLike),
          displayNameLastChangedAt: toDateValue(
            raw.displayNameLastChangedAt as FirestoreDateLike
          ),
        });
      },
      () => {
        toastRef.current(tCommon("errorLoadProfile"), "error");
      }
    );

    return () => unsub();
  }, [everOpened, uid, tCommon]);

  useEffect(() => {
    if (data) setLocalMessagePolicy(data.messagePolicy);
  }, [data]);

  // Cooldown del correo de contraseña, persistido en localStorage para que
  // sobreviva recargas. Mismo contrato que la pestaña del perfil.
  useEffect(() => {
    if (!everOpened) return;

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
  }, [everOpened, uid, email]);

  const unavailableText = tProfile("unavailable");

  const resolvedDisplayName = useMemo(() => {
    const dn = data?.displayName?.trim();
    if (dn) return dn;

    const full = [data?.firstName?.trim(), data?.lastName?.trim()]
      .filter(Boolean)
      .join(" ")
      .trim();

    return full || unavailableText;
  }, [data, unavailableText]);

  const resolvedUsername = data?.handle?.trim()
    ? `@${data.handle.trim()}`
    : unavailableText;
  const resolvedEmail = email?.trim() || unavailableText;
  const resolvedBirthDate = formatDate(data?.birthDate, locale) ?? unavailableText;
  const resolvedCreatedAt = formatDate(data?.createdAt, locale) ?? unavailableText;

  const remainingDays = daysUntilNameChange(data?.displayNameLastChangedAt);
  const canChangeName = remainingDays <= 0;

  async function handlePushChange(nextValue: boolean) {
    if (push.busy) return;

    const res = await push.toggle(nextValue);

    if (nextValue && !res.ok) {
      if (res.reason === "denied") onToast(tProfile("pushDenied"), "error");
      else if (res.reason === "unsupported") onToast(tProfile("pushUnsupported"), "error");
      else if (res.reason !== "dismissed") onToast(tProfile("pushError"), "error");
      return;
    }

    if (res.ok) {
      onToast(
        nextValue ? tProfile("pushEnabledMsg") : tProfile("pushDisabledMsg"),
        "success"
      );
    }
  }

  async function handleMessagePolicyChange(next: MessagePolicy) {
    if (!uid || savingMessagePolicy) return;

    const previous = localMessagePolicy;
    setLocalMessagePolicy(next);
    setSavingMessagePolicy(true);

    try {
      await updateMessagePolicy(uid, next);
    } catch {
      setLocalMessagePolicy(previous);
      // Siempre el texto traducido: los Error del servicio son guardas internas
      // en español y mostrarlos crudos rompería el idioma de la interfaz.
      onToast(tProfile("messagePolicyUpdateError"), "error");
    } finally {
      setSavingMessagePolicy(false);
    }
  }

  async function handleSaveName() {
    const nextName = draftName.trim();

    if (nextName.length < 3) {
      onToast(tProfile("nameMinLengthError"), "error");
      return;
    }

    if (!canChangeName) {
      onToast(tProfile("nameChangeCooldown", { days: remainingDays }), "error");
      return;
    }

    setSavingName(true);

    try {
      await updateProfileDisplayName(nextName);
      onToast(tProfile("nameUpdated"), "success");
      setEditNameOpen(false);
    } catch (error: unknown) {
      onToast(
        (error instanceof Error ? error.message : null) ?? tProfile("nameUpdateError"),
        "error"
      );
    } finally {
      setSavingName(false);
    }
  }

  async function handleSaveBio() {
    if (!uid) return;

    setSavingBio(true);

    try {
      await updateDoc(doc(db, "users", uid), { bio: draftBio.trim() });
      onToast(tProfile("descriptionUpdated"), "success");
      setEditBioOpen(false);
    } catch (error: unknown) {
      onToast(
        (error instanceof Error ? error.message : null) ?? tProfile("descriptionError"),
        "error"
      );
    } finally {
      setSavingBio(false);
    }
  }

  async function handlePasswordReset() {
    if (sendingPassword || pwdCooldown > 0) return;

    const target = email?.trim();

    if (!target) {
      onToast(tCommon("noEmailFound"), "error");
      return;
    }

    setSendingPassword(true);

    try {
      await sendPasswordResetEmail(auth, target);

      try {
        window.localStorage.setItem(pwdResetKey(uid ?? email), String(Date.now()));
      } catch {
        /* localStorage no disponible: el cooldown vivirá solo en memoria */
      }

      setPasswordSent(true);
      setPwdCooldown(PWD_RESET_COOLDOWN_S);
    } catch (error: unknown) {
      onToast(
        (error instanceof Error ? error.message : null) ?? tProfile("passwordEmailError"),
        "error"
      );
    } finally {
      setSendingPassword(false);
    }
  }

  // ---- Estilos ----------------------------------------------------------

  // Contenedor de la opción: gris ligero con esquinas redondeadas. Envuelve el
  // módulo entero (encabezado + contenido desplegado), así que al abrirse la
  // caja crece y todo el bloque se lee como una sola tarjeta.
  const cardStyle: CSSProperties = {
    background: "rgba(255,255,255,0.06)",
    borderRadius: 14,
    padding: 6,
    marginTop: 8,
    minWidth: 0,
  };

  const headerStyle: CSSProperties = {
    position: "relative",
    width: "100%",
    minHeight: 39,
    display: "flex",
    alignItems: "center",
    gap: 8,
    // Dentro de la tarjeta gris el encabezado no lleva fondo propio: dos grises
    // encimados solo ensucian el contraste.
    background: "transparent",
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    padding: "7px 8px 7px 6px",
    textAlign: "start",
    WebkitTapHighlightColor: "transparent",
    fontFamily: "inherit",
  };

  const row: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    padding: "11px 0",
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
    fontSize: 13.5,
    color: "rgba(255,255,255,0.92)",
    fontWeight: 600,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  };

  const hintStyle: CSSProperties = {
    marginTop: 5,
    fontSize: 11,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.4,
  };

  const linkBtn: CSSProperties = {
    justifySelf: "end",
    alignSelf: "center",
    border: "none",
    background: "transparent",
    padding: 0,
    color: "#a855f7",
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

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
    fontFamily: "inherit",
    boxSizing: "border-box",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const panelPrimaryBtn: CSSProperties = {
    flex: 1,
    minHeight: 42,
    borderRadius: 5,
    border: "none",
    background: "#a855f7",
    color: "rgba(255,255,255,0.98)",
    fontSize: 16,
    fontWeight: 500,
    fontFamily: "inherit",
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
    fontFamily: "inherit",
    cursor: "pointer",
  };

  // La variante `settings` de LogoutButton trae fondo morado y un halo morado
  // (`boxShadow`). El fondo ya lo pisábamos con gris, pero el halo sobrevivía y
  // quedaba un brillo morado bajo un botón gris. `boxShadow: "none"` lo apaga.
  // Se hace aquí y no en LogoutButton para no alterar sus otros usos.
  const logoutButtonStyle: CSSProperties = {
    width: "100%",
    minHeight: 40,
    borderRadius: 6,
    border: "none",
    background: "rgba(255,255,255,0.10)",
    boxShadow: "none",
    color: "rgba(255,255,255,0.70)",
    fontWeight: 500,
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
  };

  if (!uid) return null;

  return (
    <div style={{ display: "grid", ...cardStyle }}>
      <style jsx>{`
        .vibra-sidebar-settings-input::placeholder {
          color: rgba(255, 255, 255, 0.42);
          opacity: 1;
        }

        /* Misma línea sutil entre opciones que en la pestaña del perfil. */
        .sidebar-setting-row::after {
          content: "";
          position: absolute;
          inset-inline-start: 6px;
          inset-inline-end: 6px;
          bottom: 0;
          height: 1px;
          background: rgba(255, 255, 255, 0.1);
        }
      `}</style>

      <button
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          setEverOpened(true);
        }}
        aria-expanded={open}
        aria-label={tNav("settings")}
        title={tNav("settings")}
        style={headerStyle}
      >
        <span style={{ display: "inline-flex", opacity: open ? 1 : 0.8 }}>
          <SidebarSettingsIcon size={28} strokeWidth={1.8} color="#ffffff" />
        </span>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            lineHeight: 1.15,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "#ffffff",
            fontWeight: open ? 700 : 600,
          }}
        >
          {tNav("settings")}
        </span>

        {/* Chevron: gira al desplegarse, como pista de que hay más abajo. */}
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            display: "inline-flex",
            color: "rgba(255,255,255,0.5)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 320ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path
              d="M6 9.5L12 15.5L18 9.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {/* Despliegue hacia abajo: 0fr→1fr anima hasta la altura real, sin tope
          fijo que recorte la lista. Mismo patrón que OwnerSidebarTabNav. */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
          transition:
            "grid-template-rows 380ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Sin padding lateral propio: el que aporta la tarjeta gris ya separa
              el contenido del borde, y sumar otro lo dejaba demasiado angosto. */}
          <div style={{ padding: "2px 6px 0", display: "grid", gap: 2, minWidth: 0 }}>
            {/* Quién puede enviarme mensajes — a una sola columna: son cuatro
                opciones con etiquetas largas, no caben junto a un control. */}
            <div
              className="sidebar-setting-row"
              style={{ ...row, gridTemplateColumns: "1fr", gap: 8 }}
            >
              <div style={labelStyle}>{tProfile("messagePolicyLabel")}</div>

              <MessagePolicySetting
                value={localMessagePolicy}
                disabled={savingMessagePolicy || !data}
                onChange={handleMessagePolicyChange}
              />
            </div>

            {push.supported === true && (
              <div className="sidebar-setting-row" style={row}>
                <div>
                  <div style={labelStyle}>{tProfile("pushLabel")}</div>
                  <div style={valueStyle}>
                    {push.enabled ? tProfile("pushOn") : tProfile("pushOff")}
                  </div>
                  <div style={hintStyle}>
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

            {/* Nombre */}
            <div className="sidebar-setting-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("nameFieldLabel")}</div>
                <div style={valueStyle}>{resolvedDisplayName}</div>
              </div>

              {canChangeName ? (
                <button
                  type="button"
                  style={linkBtn}
                  onClick={() => {
                    setDraftName(
                      resolvedDisplayName === unavailableText ? "" : resolvedDisplayName
                    );
                    setEditNameOpen(true);
                  }}
                >
                  {tProfile("changeNameLabel")}
                </button>
              ) : (
                <div
                  style={{
                    justifySelf: "end",
                    fontSize: 10,
                    lineHeight: 1.35,
                    color: "rgba(255,255,255,0.38)",
                    maxWidth: 120,
                    textAlign: "end",
                  }}
                >
                  {tProfile("nameChangeCountdown", { days: remainingDays })}
                </div>
              )}
            </div>

            {/* Usuario */}
            <div className="sidebar-setting-row" style={{ ...row, gridTemplateColumns: "1fr" }}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("usernameFieldLabel")}</div>
                <div style={valueStyle}>{resolvedUsername}</div>
              </div>
            </div>

            {/* Descripción del perfil */}
            <div className="sidebar-setting-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("bioFieldLabel")}</div>
                <div
                  style={{
                    ...valueStyle,
                    fontWeight: 400,
                    color: data?.bio?.trim()
                      ? "rgba(255,255,255,0.82)"
                      : "rgba(255,255,255,0.38)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {data?.bio?.trim() || tProfile("noDescription")}
                </div>
              </div>

              <button
                type="button"
                style={linkBtn}
                onClick={() => {
                  setDraftBio(data?.bio ?? "");
                  setEditBioOpen(true);
                }}
              >
                {tProfile("editLabel")}
              </button>
            </div>

            {/* Correo */}
            <div className="sidebar-setting-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("emailFieldLabel")}</div>
                <div style={valueStyle}>{resolvedEmail}</div>

                {passwordSent && (
                  <div style={hintStyle}>
                    {tProfile("passwordEmailSentLegend", { email: resolvedEmail })}
                  </div>
                )}
              </div>

              <button
                type="button"
                style={{
                  ...linkBtn,
                  cursor: sendingPassword || pwdCooldown > 0 ? "not-allowed" : "pointer",
                  opacity: sendingPassword || pwdCooldown > 0 ? 0.6 : 1,
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

            {/* Fecha de nacimiento */}
            <div className="sidebar-setting-row" style={{ ...row, gridTemplateColumns: "1fr" }}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("birthDateFieldLabel")}</div>
                <div style={valueStyle}>{resolvedBirthDate}</div>
              </div>
            </div>

            {/* Fecha de creación */}
            <div className="sidebar-setting-row" style={{ ...row, gridTemplateColumns: "1fr" }}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("creationDateFieldLabel")}</div>
                <div style={valueStyle}>{resolvedCreatedAt}</div>
              </div>
            </div>

            {/* Cuentas bloqueadas */}
            <div className="sidebar-setting-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("blockedAccountsLabel")}</div>
                <div style={valueStyle}>{tProfile("profilesAndCommunities")}</div>
                <div style={hintStyle}>{tProfile("blockedProfilesHint")}</div>
              </div>

              <button
                type="button"
                style={linkBtn}
                onClick={() => setBlockedAccountsOpen(true)}
              >
                {tCommon("viewLabel")}
              </button>
            </div>

            {/* Sesiones activas */}
            <div className="sidebar-setting-row" style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={labelStyle}>{tProfile("sessionsLabel")}</div>
                <div style={valueStyle}>{tProfile("sessionsValue")}</div>
                <div style={hintStyle}>{tProfile("sessionsHint")}</div>
              </div>

              <button type="button" style={linkBtn} onClick={() => setSessionsOpen(true)}>
                {tCommon("viewLabel")}
              </button>
            </div>

            {/* Cerrar sesión */}
            <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
              <LogoutButton variant="settings" style={logoutButtonStyle} />
            </div>
          </div>
        </div>
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
              style={{
                ...panelSecondaryBtn,
                opacity: savingName ? 0.7 : 1,
                cursor: savingName ? "not-allowed" : "pointer",
              }}
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
            className="vibra-sidebar-settings-input"
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
                fontFamily: "inherit",
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
            className="vibra-sidebar-settings-input"
            style={{ ...inputStyle, minHeight: 110, resize: "vertical" }}
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
    </div>
  );
}
