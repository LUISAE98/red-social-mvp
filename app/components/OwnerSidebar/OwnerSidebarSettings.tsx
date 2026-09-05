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
 * "Configuración" es el TÍTULO del grupo, y cada ajuste una pestaña con su
 * propia tarjeta y su icono. Es un acordeón —solo una abierta a la vez— e
 * INDEPENDIENTE del de seguidos/comunidades de arriba (OwnerSidebarTabNav):
 * abrir una pestaña de aquí no cierra nada de allá.
 *
 * ⚠️ EL LISTENER DE `users/{uid}` SE ENGANCHA AL MONTAR, no al abrir.
 *
 * Antes iba en diferido, y tenía sentido cuando todo esto era UN desplegable
 * cerrado que la mayoría no abría nunca. Ya no: las siete pestañas se ven
 * siempre, y con la carga diferida al abrir la primera te encontrabas las
 * opciones en gris —`disabled` cuelga de que haya datos— hasta que llegaban.
 * Un ajuste que aparece deshabilitado al abrirlo se lee como que no se puede
 * tocar, no como que está cargando.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TextButton } from "@/components/ui";
import { useTranslations, useLocale } from "next-intl";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
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
import { useCfError } from "@/lib/i18n/cfError";
import MessagePolicySetting from "@/components/chat/MessagePolicySetting";
import SocialLinksEditor, {
  draftHasInvalidHandle,
  socialLinksToDraft,
} from "@/components/profile/SocialLinksEditor";
import { listSocialLinks, type SocialLinks } from "@/lib/profile/socialNetworks";
import { updateProfileSocialLinks } from "@/lib/profile/updateProfileSocialLinks";
import { usePrivateProfile } from "@/lib/auth/usePrivateProfile";
import { updateMessagePolicy } from "@/lib/chat/messagePolicyService";
import { updateProfileDisplayName } from "@/lib/profile/updateProfileDisplayName";
import { DEFAULT_MESSAGE_POLICY, isMessagePolicy, type MessagePolicy } from "@/lib/chat/types";
import { usePushNotifications } from "@/lib/hooks/usePushNotifications";
import type { ToastType } from "@/lib/hooks/useVibraToast";
import { SidebarSettingsIcon } from "@/app/components/VibraServiceIcons/OwnerSidebarNavIcons/OwnerSidebarNavIcons";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import { useCurrency } from "@/app/components/CurrencyProvider";
import { readyLocaleMeta } from "@/i18n/locales";
import { currencyLabel } from "@/lib/currency/format";

/**
 * Estilo del botón de cerrar sesión. Vive aquí, junto al resto del vocabulario
 * visual del menú, pero lo consume `OwnerSidebar`: el botón ya no está dentro
 * del acordeón de Configuración, sino suelto debajo.
 *
 * La variante `settings` de LogoutButton trae fondo morado y un halo morado
 * (`boxShadow`). El fondo se pisa con gris, pero el halo sobrevivía y quedaba un
 * brillo morado bajo un botón gris; `boxShadow: "none"` lo apaga. Se hace aquí y
 * no en LogoutButton para no alterar sus otros usos.
 */
export const SIDEBAR_LOGOUT_BUTTON_STYLE: CSSProperties = {
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

type SettingsDoc = {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  handle: string | null;
  bio: string | null;
  messagePolicy: MessagePolicy;
  // Los tres que vienen de la pestana de Configuracion del perfil. Se leen del
  // mismo documento que ya se escuchaba; no hay listener nuevo.
  profileRestricted: boolean;
  profileCommentsEnabled: boolean;
  socialLinks: SocialLinks;
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

/**
 * Los iconos de las pestañas de ajustes.
 *
 * Se dibujan aquí y no se tiran de `OwnerSidebarNavIcons` porque allí solo hay
 * cinco —seguidos, comunidades, mensajes y el engrane— y ninguno sirve para
 * "datos de la cuenta" o "sesiones activas". Todos comparten la misma familia
 * del sidebar: trazo de 1.7, `currentColor` y lienzo de 24, para que puestos en
 * columna se lean como un juego y no como siete dibujos sueltos.
 */
function IconoAjuste({
  children,
  size = 20,
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Quién puede escribirte: un globo de mensaje. */
const ICONO_MENSAJES = (
  <IconoAjuste>
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
  </IconoAjuste>
);

/** Notificaciones: la campana. */
const ICONO_NOTIFICACIONES = (
  <IconoAjuste>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </IconoAjuste>
);

/** Datos de la cuenta: la persona. */
const ICONO_CUENTA = (
  <IconoAjuste>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </IconoAjuste>
);

/** Descripción del perfil: renglones de texto. */
const ICONO_BIO = (
  <IconoAjuste>
    <path d="M4 6h16" />
    <path d="M4 11h16" />
    <path d="M4 16h9" />
  </IconoAjuste>
);

/** Idioma y moneda: el globo terráqueo. */
const ICONO_IDIOMA = (
  <IconoAjuste>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
  </IconoAjuste>
);

/** Cuentas bloqueadas: el círculo tachado. */
const ICONO_BLOQUEADAS = (
  <IconoAjuste>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </IconoAjuste>
);

/** Sesiones activas: la pantalla de otro aparato. */
const ICONO_SESIONES = (
  <IconoAjuste>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8" />
    <path d="M12 16v4" />
  </IconoAjuste>
);

/** Las siete pestañas del cajón de ajustes, en el orden en que se ven. */
type SeccionId =
  | "mensajes"
  | "notificaciones"
  | "cuenta"
  | "bio"
  | "idioma"
  | "bloqueadas"
  | "sesiones";

/**
 * Una pestaña del cajón de ajustes.
 *
 * Hereda la cabecera que tenía "Configuración" cuando era ella la que se
 * desplegaba: título a la izquierda, chevron que gira, y el cuerpo abriéndose de
 * `0fr` a `1fr` para animar hasta su altura real sin un tope fijo que recorte la
 * lista de dentro.
 *
 * 🚨 VIVE A NIVEL DE MÓDULO, NO DENTRO DEL COMPONENTE. Una función declarada
 * dentro es un tipo nuevo en cada render, así que React desmonta y vuelve a
 * montar todo su subárbol: se perdería el foco de lo que se estuviera
 * escribiendo y se reiniciaría cualquier animación en curso.
 */
function SeccionAjuste({
  icono,
  titulo,
  abierta,
  onToggle,
  fija = false,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  abierta: boolean;
  onToggle: () => void;
  /**
   * Siempre abierta y sin nada que pulsar.
   *
   * En laptop hay sitio de sobra para las siete a la vez, y plegarlas solo
   * anade un clic para ver lo que ya cabe. Cuando esta fija la cabecera deja de
   * ser un boton y pierde el chevron: una flecha que no hace nada promete algo
   * que no va a pasar.
   */
  fija?: boolean;
  children: React.ReactNode;
}) {
  const desplegada = fija || abierta;
  return (
    <div
      style={{
        minWidth: 0,
        position: "relative",
        // 🚨 CADA PESTAÑA ES SU PROPIO MÓDULO, con su tarjeta. No van las siete
        // dentro de una sola: apiladas en un mismo bloque gris se leen como una
        // lista larga otra vez, que es justo de lo que se venía.
        //
        // La tarjeta va EN LÍNEA y no en el <style jsx> del padre: styled-jsx
        // solo pone su hash en lo que renderiza SU componente, y este div lo
        // pinta SeccionAjuste. Desde el padre la regla no llegaría, y además
        // fallaría en silencio.
        background: "rgba(255,255,255,0.06)",
        borderRadius: 14,
        padding: 6,
      }}
    >
      <button
        type="button"
        onClick={fija ? undefined : onToggle}
        // Fija no es un control: ni se puede pulsar ni anuncia estado plegable.
        disabled={fija}
        aria-expanded={fija ? undefined : abierta}
        style={{
          width: "100%",
          minHeight: 39,
          display: "flex",
          alignItems: "center",
          gap: 8,
          // Dentro de la tarjeta gris no lleva fondo propio: dos grises
          // encimados solo ensucian el contraste.
          background: "transparent",
          border: "none",
          borderRadius: 10,
          cursor: fija ? "default" : "pointer",
          padding: "9px 6px",
          textAlign: "start",
          WebkitTapHighlightColor: "transparent",
          fontFamily: "inherit",
        }}
      >
        <span
          style={{
            flexShrink: 0,
            display: "inline-flex",
            color: desplegada ? "#ffffff" : "rgba(255,255,255,0.72)",
          }}
        >
          {icono}
        </span>

        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "#ffffff",
            fontWeight: desplegada ? 700 : 600,
          }}
        >
          {titulo}
        </span>

        {!fija && (
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            display: "inline-flex",
            color: "rgba(255,255,255,0.5)",
            transform: abierta ? "rotate(180deg)" : "rotate(0deg)",
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
        )}
      </button>

      <div
        style={{
          display: "grid",
          gridTemplateRows: desplegada ? "1fr" : "0fr",
          opacity: desplegada ? 1 : 0,
          transition:
            "grid-template-rows 380ms cubic-bezier(0.4,0,0.2,1), opacity 240ms ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          {/* Relleno lateral propio: sin el, el contenido quedaba pegado al
              borde de la tarjeta y se leia apretado. */}
          <div style={{ padding: "0 6px 6px" }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function OwnerSidebarSettings({
  uid,
  email,
  onToast,
  variante = "sidebar",
}: {
  uid: string | null;
  email: string | null;
  /** Reusa el VibraToast del sidebar; no montamos una segunda capa de toasts. */
  onToast: (text: string | null, type?: ToastType) => void;
  /**
   * Donde se esta pintando.
   *
   *  · `sidebar` — dentro del espacio personal de celular. Columna estrecha, asi
   *    que las pestanas se pliegan y solo una esta abierta a la vez.
   *  · `pagina` — la pantalla propia de laptop (/configuracion). Ahi hay alto de
   *    sobra para las siete a la vez, y plegarlas solo anadiria un clic para ver
   *    lo que ya cabe. El titulo pasa a ser el de una pagina cualquiera, sin el
   *    engrane: en el sidebar el icono distinguia el modulo entre otros diez, y
   *    en una pantalla que ya se llama Configuracion no distingue nada.
   */
  variante?: "sidebar" | "pagina";
}) {
  const enPagina = variante === "pagina";
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tProfile = useTranslations("profile");
  const cfError = useCfError();
  const locale = useLocale();
  const { currency } = useCurrency();

  /**
   * Qué pestaña está abierta, o ninguna.
   *
   * Es un acordeón —solo una a la vez— y no siete interruptores sueltos: son
   * siete pestañas en una pantalla de celular, y con varias abiertas la lista
   * crece hasta obligar a rebuscar por dónde iba uno.
   */
  const [abierta, setAbierta] = useState<SeccionId | null>(null);

  function alternar(id: SeccionId) {
    setAbierta((prev) => (prev === id ? null : id));
  }
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
    // ⚠️ B9-bajo. Era "everyone" mientras las reglas y los tipos usan
    // DEFAULT_MESSAGE_POLICY ("following"). Mientras cargaba el ajuste real, la
    // pantalla decía que cualquiera podía escribirte cuando no era verdad.
    useState<MessagePolicy>(DEFAULT_MESSAGE_POLICY);

  /**
   * Los tres ajustes que se trajeron de la pestaña de Configuración del perfil.
   *
   * Van con copia local porque los dos interruptores se pintan de inmediato al
   * tocarlos y se revierten si la escritura falla; esperar a que vuelva el
   * snapshot dejaba el interruptor quieto medio segundo y se sentía roto.
   */
  const [localRestricted, setLocalRestricted] = useState(false);
  const [savingRestricted, setSavingRestricted] = useState(false);
  const [localComments, setLocalComments] = useState(true);
  const [savingComments, setSavingComments] = useState(false);

  const [editSocialOpen, setEditSocialOpen] = useState(false);
  const [draftSocial, setDraftSocial] = useState<Record<string, string>>({});
  const [savingSocial, setSavingSocial] = useState(false);

  const [sendingPassword, setSendingPassword] = useState(false);
  const [passwordSent, setPasswordSent] = useState(false);
  const [pwdCooldown, setPwdCooldown] = useState(0);

  const push = usePushNotifications(uid);

  // Datos personales del propio dueño (correo, fecha de nacimiento, sexo). Ya no
  // viven en el documento público del perfil, que lee cualquiera.
  const privateProfile = usePrivateProfile(uid, true);

  // El toast se dispara desde handlers async; guardarlo en ref evita re-suscribir
  // el listener de Firestore cada vez que el padre re-renderiza.
  const toastRef = useRef(onToast);
  useEffect(() => {
    toastRef.current = onToast;
  }, [onToast]);

  useEffect(() => {
    if (!uid) return;

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
          // ⚠️ El fallback tiene que ser DEFAULT_MESSAGE_POLICY, no "everyone".
          // Sin campo en Firestore, las rules y el botón de mensaje del perfil
          // aplican "following"; poniendo "everyone" aquí, el selector enseñaba
          // "Todos" a quien nunca tocó el ajuste. Como ya lo veía puesto, no lo
          // guardaba nunca — y su bandeja seguía cerrada a los desconocidos sin
          // que nada se lo dijera.
          messagePolicy: isMessagePolicy(policy) ? policy : DEFAULT_MESSAGE_POLICY,
          // Ausente = perfil abierto y comentarios abiertos, que es el mismo
          // valor por omision que aplica la pestana del perfil.
          profileRestricted: raw.profileRestricted === true,
          profileCommentsEnabled: raw.profileCommentsEnabled !== false,
          socialLinks: (raw.socialLinks as SocialLinks) ?? {},
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
  }, [uid, tCommon]);

  useEffect(() => {
    if (!data) return;
    setLocalMessagePolicy(data.messagePolicy);
    setLocalRestricted(data.profileRestricted);
    setLocalComments(data.profileCommentsEnabled);
  }, [data]);

  // Cooldown del correo de contraseña, persistido en localStorage para que
  // sobreviva recargas. Mismo contrato que la pestaña del perfil.
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


  /**
   * Perfil restringido.
   *
   * Escribe el MISMO campo que la pestaña del perfil (`profileRestricted`), así
   * que los dos sitios se ven siempre igual: quien cambie uno verá el otro ya
   * cambiado, porque ambos escuchan `users/{uid}`.
   */
  async function handleRestrictedChange(next: boolean) {
    if (!uid || savingRestricted) return;

    const previo = localRestricted;
    setLocalRestricted(next);
    setSavingRestricted(true);

    try {
      await updateDoc(doc(db, "users", uid), { profileRestricted: next });
    } catch {
      // Se devuelve al valor de antes: dejarlo puesto haría creer que el perfil
      // quedó restringido cuando sigue abierto.
      setLocalRestricted(previo);
      toastRef.current(tCommon("errorGeneric"), "error");
    } finally {
      setSavingRestricted(false);
    }
  }

  /** Comentarios en mis publicaciones. Mismo campo que la pestaña del perfil. */
  async function handleCommentsChange(next: boolean) {
    if (!uid || savingComments) return;

    const previo = localComments;
    setLocalComments(next);
    setSavingComments(true);

    try {
      await updateDoc(doc(db, "users", uid), { profileCommentsEnabled: next });
    } catch {
      setLocalComments(previo);
      toastRef.current(tCommon("errorGeneric"), "error");
    } finally {
      setSavingComments(false);
    }
  }

  /**
   * Redes sociales.
   *
   * Va por `updateProfileSocialLinks` y no por un `updateDoc` a pelo: ese
   * servicio limpia cada identificador y espera a `authStateReady()` antes de
   * escribir. Sin esa espera, un guardado disparado pronto sale sin sesión y
   * Firestore lo rechaza por permisos aunque la persona sí esté dentro.
   */
  async function handleSocialSave() {
    if (savingSocial) return;

    setSavingSocial(true);

    try {
      await updateProfileSocialLinks(draftSocial);
      setEditSocialOpen(false);
    } catch (e: unknown) {
      toastRef.current(
        (e instanceof Error ? cfError(e) : null) ?? tCommon("errorGeneric"),
        "error"
      );
    } finally {
      setSavingSocial(false);
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
      onToast(tCommon("minLength3"), "error");
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
  // Idioma y moneda actuales para la columna del valor. Salen de las mismas
  // fuentes que consultan los selectores —el catálogo de locales servidos y el
  // proveedor de moneda—, así que no hay una segunda tabla que mantener.
  const currentLanguageName =
    readyLocaleMeta().find((m) => m.code === locale)?.name ?? locale;
  /** Las redes ya guardadas, para el resumen del renglón. */
  const redesGuardadas = useMemo(
    () => listSocialLinks(data?.socialLinks ?? {}),
    [data?.socialLinks]
  );

  const currentCurrencyName = `${currency} · ${currencyLabel(currency, locale)}`;

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

  if (!uid) return null;

  return (
    /* Sin tarjeta propia: cada pestaña trae la suya. Este solo las apila. */
    <div style={{ display: "grid", gap: 8, marginTop: 22, minWidth: 0 }}>
      <style jsx>{`
        .vibra-sidebar-settings-input::placeholder {
          color: rgba(255, 255, 255, 0.42);
          opacity: 1;
        }

        /* Misma línea sutil entre opciones que en la pestaña del perfil. */
        /* Dentro de una pestana la ultima fila NO lleva raya: chocaria con la
           de la propia pestana y saldrian dos lineas pegadas. */
        .sidebar-setting-row:last-child::after {
          display: none;
        }

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

      {/* "Configuración" ya NO se despliega: es el TÍTULO del cajón.
          Lo que se despliega ahora es cada ajuste por su cuenta.

          Antes era un solo desplegable con doce renglones dentro, y para llegar
          a cualquiera había que abrirlo y recorrerlos todos. Con una pestaña por
          ajuste se ve de un vistazo qué hay, y solo se abre lo que se busca. */}
      {enPagina ? (
        <h1 className="vibra-page-title">{tNav("settings")}</h1>
      ) : (
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 8px 0 6px",
          }}
        >
          <span style={{ display: "inline-flex" }}>
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
              fontWeight: 700,
            }}
          >
            {tNav("settings")}
          </span>
        </div>
      )}

        {/* 1. Quién puede escribirte. Va primero porque es el ajuste que más se
               toca y el único que cambia quién puede llegar a ti. */}
        <SeccionAjuste
          icono={ICONO_MENSAJES}
          titulo={tProfile("messagePolicyLabel")}
          abierta={abierta === "mensajes"}
          onToggle={() => alternar("mensajes")}
          fija={enPagina}
        >
          <MessagePolicySetting
            value={localMessagePolicy}
            disabled={savingMessagePolicy || !data}
            onChange={handleMessagePolicyChange}
          />
        </SeccionAjuste>

        {/* 2. Notificaciones. La pestaña entera desaparece donde el navegador no
               las admite: una pestaña que se abre y no tiene nada dentro es peor
               que no estar. */}
        {/* 2. Notificaciones. La pestaña está SIEMPRE, tambien donde el
               navegador no admite avisos: esconderla dejaba la lista distinta
               segun el aparato y sin decir por que faltaba. Cuando no se puede,
               se dice dentro y no se ofrece el interruptor. */}
        <SeccionAjuste
          icono={ICONO_NOTIFICACIONES}
          titulo={tProfile("pushLabel")}
          abierta={abierta === "notificaciones"}
          onToggle={() => alternar("notificaciones")}
          fija={enPagina}
        >
          <div className="sidebar-setting-row" style={row}>
            <div>
              <div style={valueStyle}>
                {push.supported === false
                  ? tProfile("pushUnsupported")
                  : push.enabled
                    ? tProfile("pushOn")
                    : tProfile("pushOff")}
              </div>

              {push.supported !== false && (
                <div style={hintStyle}>
                  {push.permission === "denied"
                    ? tProfile("pushDeniedHint")
                    : tProfile("pushHint")}
                </div>
              )}
            </div>

            {/* Sin soporte no hay interruptor: un control que no puede hacer
                nada solo invita a pulsarlo y a no entender por que no pasa. */}
            {push.supported !== false && (
              <Switch
                checked={push.enabled}
                // Mientras se comprueba el soporte, `supported` es null y
                // todavía no se sabe si se puede.
                disabled={
                  push.busy || push.supported === null || push.permission === "denied"
                }
                onChange={handlePushChange}
                label={push.enabled ? tProfile("disablePush") : tProfile("enablePush")}
              />
            )}
          </div>
        </SeccionAjuste>

        {/* 3. Datos de la cuenta: lo que te identifica. Cinco renglones que
               antes andaban sueltos entre los ajustes y que juntos se leen como
               una ficha. */}
        <SeccionAjuste
          icono={ICONO_CUENTA}
          titulo={tProfile("accountDataLabel")}
          abierta={abierta === "cuenta"}
          onToggle={() => alternar("cuenta")}
          fija={enPagina}
        >
          {/* Nombre */}
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("nameFieldLabel")}</div>
              <div style={valueStyle}>{resolvedDisplayName}</div>
            </div>

            {canChangeName ? (
              <TextButton tone="brand" size="sm" style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }} onClick={() => { setDraftName( resolvedDisplayName === unavailableText ? "" : resolvedDisplayName ); setEditNameOpen(true); }}>
                {tProfile("changeNameLabel")}
              </TextButton>
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

          {/* Fecha de creación */}
          <div className="sidebar-setting-row" style={{ ...row, gridTemplateColumns: "1fr" }}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("creationDateFieldLabel")}</div>
              <div style={valueStyle}>{resolvedCreatedAt}</div>
            </div>
          </div>

          {/* Fecha de nacimiento */}
          <div className="sidebar-setting-row" style={{ ...row, gridTemplateColumns: "1fr" }}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("birthDateFieldLabel")}</div>
              <div style={valueStyle}>{resolvedBirthDate}</div>
            </div>
          </div>
        </SeccionAjuste>

        {/* 4. Configuración de perfil: la descripción mas los tres ajustes que
               vivian solo en la pestana del perfil. No son opciones nuevas, es
               el mismo campo de Firestore visto desde aqui, asi que cambiar uno
               en cualquiera de los dos sitios se ve en el otro al instante. */}
        <SeccionAjuste
          icono={ICONO_BIO}
          titulo={tProfile("settingsTitle")}
          abierta={abierta === "bio"}
          onToggle={() => alternar("bio")}
          fija={enPagina}
        >
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  ...valueStyle,
                  marginTop: 0,
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

            <TextButton tone="brand" size="sm" style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }} onClick={() => { setDraftBio(data?.bio ?? ""); setEditBioOpen(true); }}>
              {tProfile("editLabel")}
            </TextButton>
          </div>

          {/* Perfil restringido. Mismo campo y mismo texto de ayuda que en la
              pestaña del perfil: no es un ajuste nuevo, es el mismo visto desde
              aquí. */}
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("restricted")}</div>
              <div style={valueStyle}>
                {localRestricted ? tProfile("enabled") : tProfile("disabled")}
              </div>
              <div style={hintStyle}>
                {localRestricted
                  ? tProfile("reservedHelpActive")
                  : tProfile("publicHelpActive")}
              </div>
            </div>

            <Switch
              checked={localRestricted}
              disabled={savingRestricted || !data}
              onChange={handleRestrictedChange}
              label={
                localRestricted
                  ? tProfile("disableReserved")
                  : tProfile("enableReserved")
              }
            />
          </div>

          {/* Comentarios en mis publicaciones */}
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("commentsLabel")}</div>
              <div style={valueStyle}>
                {localComments
                  ? tProfile("commentsOpen")
                  : tProfile("commentsRestricted")}
              </div>
              <div style={hintStyle}>
                {localComments
                  ? tProfile("commentsOpenHelp")
                  : tProfile("commentsRestrictedHelp")}
              </div>
            </div>

            <Switch
              checked={localComments}
              disabled={savingComments || !data}
              onChange={handleCommentsChange}
              label={
                localComments
                  ? tProfile("restrictComments")
                  : tProfile("openComments")
              }
            />
          </div>

          {/* Redes sociales. El editor es el MISMO componente que usa la pestaña
              del perfil, dentro del mismo tipo de panel. */}
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tProfile("socialLinksFieldLabel")}</div>
              <div
                style={{
                  ...valueStyle,
                  fontWeight: 400,
                  color: redesGuardadas.length
                    ? "rgba(255,255,255,0.82)"
                    : "rgba(255,255,255,0.38)",
                  wordBreak: "break-word",
                }}
              >
                {redesGuardadas.length
                  ? redesGuardadas.map((r) => r.label).join(" · ")
                  : tProfile("socialLinksNone")}
              </div>
            </div>

            <TextButton
              tone="brand"
              size="sm"
              style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }}
              onClick={() => {
                // Se rearma desde lo guardado al abrir: si se canceló la vez
                // pasada, lo tecleado a medias no debe seguir ahí.
                setDraftSocial(socialLinksToDraft(data?.socialLinks));
                setEditSocialOpen(true);
              }}
            >
              {tProfile("editLabel")}
            </TextButton>
          </div>
        </SeccionAjuste>

        {/* 5. Idioma y moneda.

               Vivían en la esquina de la portada del perfil, en dos burbujas
               sobre la foto. Un ajuste de la aplicación no es parte del perfil
               de nadie, y ahí solo los encontraba quien pasara por su propia
               portada. En laptop no cambia nada: siguen en la cabecera. */}
        <SeccionAjuste
          icono={ICONO_IDIOMA}
          titulo={tProfile("languageAndCurrencyLabel")}
          abierta={abierta === "idioma"}
          onToggle={() => alternar("idioma")}
          fija={enPagina}
        >
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tCommon("changeLanguage")}</div>
              <div style={valueStyle}>{currentLanguageName}</div>
            </div>

            <LanguageSwitcher variant="settings" />
          </div>

          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={labelStyle}>{tCommon("changeCurrency")}</div>
              <div style={valueStyle}>{currentCurrencyName}</div>
            </div>

            <CurrencySwitcher variant="settings" />
          </div>
        </SeccionAjuste>

        {/* 6. Cuentas bloqueadas. La lista entera sigue viviendo en su panel:
               aquí dentro va lo que hay y la puerta para abrirlo. */}
        <SeccionAjuste
          icono={ICONO_BLOQUEADAS}
          titulo={tProfile("blockedAccountsLabel")}
          abierta={abierta === "bloqueadas"}
          onToggle={() => alternar("bloqueadas")}
          fija={enPagina}
        >
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={valueStyle}>{tProfile("profilesAndCommunities")}</div>
              <div style={hintStyle}>{tProfile("blockedProfilesHint")}</div>
            </div>

            <TextButton tone="brand" size="sm" style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }} onClick={() => setBlockedAccountsOpen(true)}>
              {tCommon("viewLabel")}
            </TextButton>
          </div>
        </SeccionAjuste>

        {/* 7. Sesiones activas */}
        <SeccionAjuste
          icono={ICONO_SESIONES}
          titulo={tProfile("sessionsLabel")}
          abierta={abierta === "sesiones"}
          onToggle={() => alternar("sesiones")}
          fija={enPagina}
        >
          <div className="sidebar-setting-row" style={row}>
            <div style={{ minWidth: 0 }}>
              <div style={valueStyle}>{tProfile("sessionsValue")}</div>
              <div style={hintStyle}>{tProfile("sessionsHint")}</div>
            </div>

            <TextButton tone="brand" size="sm" style={{ justifySelf: "end", alignSelf: "center", fontFamily: "inherit", whiteSpace: "nowrap" }} onClick={() => setSessionsOpen(true)}>
              {tCommon("viewLabel")}
            </TextButton>
          </div>
        </SeccionAjuste>

      {/* Cerrar sesión NO va aquí: vive suelto debajo del cajón, en
          OwnerSidebar. Salir de la sesión no es un ajuste más de la lista. */}

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


      {/* Editor de redes. El MISMO componente que usa la pestaña del perfil y el
          mismo panel: aquí solo se le da su hueco. */}
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
              onClick={handleSocialSave}
              // No se guarda con un identificador mal escrito: el editor ya
              // marca cuál es, y dejar guardar produciría un enlace roto en el
              // perfil sin decir cuál.
              disabled={savingSocial || draftHasInvalidHandle(draftSocial)}
              style={
                savingSocial || draftHasInvalidHandle(draftSocial)
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
                fontFamily: "inherit",
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
    </div>
  );
}
