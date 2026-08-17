"use client";

// Panel de creación de cuenta, reutilizable. Renderiza SOLO el contenido (título,
// subtítulo, formulario, mensaje) —el shell/tarjeta lo pone quien lo monta—, con
// los estilos de la tarjeta de login. Lo usan dos lugares:
//   - La tarjeta de login (swap in-place login ↔ recuperar ↔ crear cuenta).
//   - La página /register (envuelto en su propio shell).
// La lógica de creación de cuenta (validación + transacción Firestore que crea el
// usuario y reserva el handle) vive AQUÍ, en un solo lugar (sin duplicar).

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { createUserProfileDoc } from "@/lib/auth/profileOnboarding";
import { isPasswordAcceptable } from "@/lib/auth/passwordPolicy";
import { TextButton } from "@/components/ui";
import { enablePush, isPushSupported } from "@/lib/push/fcm";
import ImageCropperModal from "@/components/media/ImageCropperModal";
import { uploadProfileImage } from "@/lib/storage/uploadProfileImage";
import SocialLinksEditor, { socialLinksToDraft } from "@/components/profile/SocialLinksEditor";
import DateWheelPanel from "@/components/ui/DateWheelPanel";
import OptionWheelPanel from "@/components/ui/OptionWheelPanel";
import { capitalizeFirst } from "@/i18n/locales";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855f7";
const vibraBlue = "#4f46ff";

type Sex = "male" | "female" | "other" | "prefer_not_say";

/**
 * Los meses del idioma que toque. `Intl` los devuelve en minúscula en español y
 * en muchos otros —"enero", "janvier"—, así que se sube la primera letra: en la
 * rueda cada mes va solo, no dentro de una frase, y ahí una minúscula se lee
 * como un descuido. `capitalizeFirst` respeta las reglas de cada idioma, y en
 * los que no tienen mayúsculas devuelve el mismo texto.
 */
function getMonths(locale: string) {
  return Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: capitalizeFirst(
      new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, i, 1)),
      locale
    ),
  }));
}

function normalizeHandle(raw: string) {
  return raw.trim().toLowerCase();
}

function isValidHandle(handle: string) {
  return /^[a-z0-9_]{3,20}$/.test(handle);
}

function cleanName(s: string) {
  return s.trim().replace(/\s+/g, " ");
}

function isValidName(s: string) {
  const v = cleanName(s);
  return v.length >= 1 && v.length <= 40;
}

/**
 * Los avisos que esta pantalla comparte con entrar y con restablecer viven en
 * `auth.shared`, con una sola redacción. `compartido` dice de cuál de los dos
 * grupos hay que sacar el texto.
 */
type ClaveAviso = { compartido: boolean; clave: string };

function friendlyAuthErrorKey(err: unknown): ClaveAviso {
  const code = (err as { code?: string } | null)?.code;
  if (code === "auth/email-already-in-use") return { compartido: false, clave: "errEmailInUse" };
  if (code === "auth/invalid-email") return { compartido: true, clave: "errInvalidEmail" };
  if (code === "auth/weak-password") return { compartido: false, clave: "errWeakPassword" };
  if (code === "auth/network-request-failed") return { compartido: true, clave: "errNetworkFailed" };
  return { compartido: true, clave: "errUnexpected" };
}

function friendlyProfileErrorKey(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  const msg = String((err as { message?: string } | null)?.message || "");
  if (code === "permission-denied") return "errPermissionDenied";
  if (msg.includes("HANDLE_TAKEN")) return "errHandleTaken";
  return "errRegistrationFailed";
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function getDaysInMonth(year: number, month: number) {
  if (!year || !month) return 31;

  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return isLeapYear(year) ? 29 : 28;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function buildBirthDate(year: string, month: string, day: string) {
  if (!year || !month || !day) return "";

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";

  const maxDay = getDaysInMonth(y, m);
  if (d < 1 || d > maxDay) return "";

  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function calculateAgeFromBirthDate(birthDate: string) {
  if (!birthDate) return NaN;

  const [y, m, d] = birthDate.split("-").map(Number);
  if (!y || !m || !d) return NaN;

  const today = new Date();
  let age = today.getFullYear() - y;
  const monthDiff = today.getMonth() + 1 - m;
  const dayDiff = today.getDate() - d;

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
}

/**
 * De menor a mayor, que es como se lee un tambor: arriba 1989, en medio 1990 y
 * abajo 1991. Al revés obligaba a girar hacia arriba para avanzar en el tiempo,
 * que es justo lo contrario de lo que espera la mano.
 */
function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const maxYear = currentYear - 18;
  const minYear = currentYear - 120;
  const years: number[] = [];

  for (let y = minYear; y <= maxYear; y += 1) {
    years.push(y);
  }

  return years;
}

/** Dónde se abre la rueda cuando aún no hay fecha. */
const DEFAULT_BIRTH_YEAR = 1990;

export default function RegisterPanel({
  email,
  onEmailChange,
  onSwitchToLogin,
  onRegistered,
}: {
  /** Correo (controlado por el padre, para compartirlo entre paneles). */
  email: string;
  onEmailChange: (value: string) => void;
  /** "¿Ya tienes cuenta?" — el padre decide (swap in-place o navegar). */
  onSwitchToLogin: () => void;
  /** Registro exitoso — el padre decide (swap a login + aviso, o navegar). */
  onRegistered: () => void;
}) {
  const t = useTranslations("auth.register");
  // El copy del switch de notificaciones se reutiliza del panel de completar
  // perfil (misma feature, mismo texto) en vez de duplicar claves.
  const tCP = useTranslations("completeProfile");
  const tProfile = useTranslations("profile");
  const tCommon = useTranslations("common");
  const tShared = useTranslations("auth.shared");
  // El aviso sale por el toast de Vibra, no como caja bajo el formulario.
  const { toast, showToast } = useVibraToast();

  /** Saca el texto del grupo que toque, compartido o propio de crear cuenta. */
  const textoAviso = (aviso: ClaveAviso) =>
    aviso.compartido
      ? tShared(aviso.clave as Parameters<typeof tShared>[0])
      : t(aviso.clave as Parameters<typeof t>[0]);
  const locale = useLocale();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [handleRaw, setHandleRaw] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthPanelOpen, setBirthPanelOpen] = useState(false);
  const [sex, setSex] = useState<Sex>("prefer_not_say");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (msg) showToast(msg, "error"); }, [msg]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(false);

  // Notificaciones: activadas por defecto al crear la cuenta (igual que en
  // completar perfil). El bloque solo se muestra si el navegador las soporta.
  const [notifOn, setCPOn] = useState(true);
  const [pushSupported, setPushSupported] = useState(false);

  useEffect(() => {
    let alive = true;
    void isPushSupported().then((ok) => {
      if (alive) setPushSupported(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Foto y portada: se recortan ANTES de que exista la cuenta; guardamos los
  // blobs y los subimos tras crear el usuario (dentro del gesto del submit).
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [avatarBlob, setAvatarBlob] = useState<Blob | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverBlob, setCoverBlob] = useState<Blob | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropMode, setCropMode] = useState<"avatar" | "cover">("avatar");

  // Bio (opcional): se guarda al crear la cuenta.
  const [bio, setBio] = useState("");
  // Texto crudo por red; se limpia dentro de createUserProfileDoc. Vive aquí y
  // no dentro del desplegable, así que cerrarlo no pierde lo ya escrito.
  const [socialDraft, setSocialDraft] = useState(() => socialLinksToDraft(null));
  const [socialOpen, setSocialOpen] = useState(false);

  // Revoca las object URLs al desmontar para no filtrar memoria.
  const avatarPreviewRef = useRef<string | null>(null);
  avatarPreviewRef.current = avatarPreview;
  const coverPreviewRef = useRef<string | null>(null);
  coverPreviewRef.current = coverPreview;
  const cropSrcRef = useRef<string | null>(null);
  cropSrcRef.current = cropSrc;
  useEffect(
    () => () => {
      if (avatarPreviewRef.current) URL.revokeObjectURL(avatarPreviewRef.current);
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
    e.target.value = ""; // permite reelegir el mismo archivo
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
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      setAvatarBlob(blob);
      setAvatarPreview(URL.createObjectURL(blob));
    } else {
      if (coverPreview) URL.revokeObjectURL(coverPreview);
      setCoverBlob(blob);
      setCoverPreview(URL.createObjectURL(blob));
    }
    closeCrop();
  }

  const handle = useMemo(() => normalizeHandle(handleRaw), [handleRaw]);

  const passwordsMatch = useMemo(() => {
    if (!password || !password2) return true;
    return password === password2;
  }, [password, password2]);

  const years = useMemo(() => getYearOptions(), []);
  // Los días ya no se arman aquí: los calcula el panel de tambores según el mes
  // y el año que estén girados en ese momento.

  const birthDate = useMemo(
    () => buildBirthDate(birthYear, birthMonth, birthDay),
    [birthYear, birthMonth, birthDay]
  );

  const calculatedAge = useMemo(() => calculateAgeFromBirthDate(birthDate), [birthDate]);

  const isUnder18 = useMemo(() => {
    if (!birthDate) return false;
    return Number.isFinite(calculatedAge) && calculatedAge < 18;
  }, [birthDate, calculatedAge]);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const fn = cleanName(firstName);
    const ln = cleanName(lastName);

    if (!isValidName(fn)) {
      setMsg(t("errInvalidName"));
      return;
    }

    if (!isValidName(ln)) {
      setMsg(t("errInvalidLastName"));
      return;
    }

    if (!isValidHandle(handle)) {
      setMsg(t("errInvalidHandle"));
      return;
    }

    if (!birthYear || !birthMonth || !birthDay || !birthDate) {
      setMsg(t("errCompleteBirthdate"));
      return;
    }

    if (!Number.isFinite(calculatedAge) || calculatedAge < 18) {
      // El aviso ya sale en rojo bajo el campo de la fecha.
      return;
    }

    if (password !== password2) {
      // El aviso ya sale en rojo bajo el campo de confirmar contraseña.
      return;
    }

    // Suelo de contraseña. Antes lo único que se pedía era que las dos
    // coincidieran, así que "1234" pasaba: la fortaleza real dependía por
    // completo de la política que hubiera configurada en Firebase Auth, que no
    // vive en el repositorio y no se puede dar por supuesta. Esto NO sustituye a
    // esa política —un cliente puede saltarse cualquier validación de interfaz—,
    // pero pone un mínimo demostrable para quien se registra por la vía normal.
    if (!isPasswordAcceptable(password)) {
      setMsg(t("errPasswordWeak"));
      return;
    }

    setLoading(true);

    try {
      const handleRef = doc(db, "handles", handle);
      const handleSnap = await getDoc(handleRef);

      if (handleSnap.exists()) {
        setMsg(t("errHandleTaken"));
        setLoading(false);
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;

      // Sube foto y portada (opcionales) mientras la cuenta recién creada está
      // autenticada; si falla alguna, seguimos el alta sin ella.
      let photoURL: string | null = null;
      let coverUrl: string | null = null;
      if (avatarBlob) {
        try {
          photoURL = await uploadProfileImage(uid, "avatar", avatarBlob);
        } catch {
          /* opcional */
        }
      }
      if (coverBlob) {
        try {
          coverUrl = await uploadProfileImage(uid, "cover", coverBlob);
        } catch {
          /* opcional */
        }
      }

      // Fuente única de creación de perfil (mismos campos + índice `search` que
      // el alta por Google). La transacción interna vuelve a validar el handle.
      await createUserProfileDoc(db, {
        user: cred.user,
        handle,
        firstName: fn,
        lastName: ln,
        birthDate,
        sex,
        provider: "password",
        photoURL,
        coverUrl,
        bio,
        socialLinks: socialDraft,
      });

      await sendEmailVerification(cred.user);

      // Si dejó el switch activado y el navegador soporta push, pide permiso y
      // registra el token de este dispositivo (dentro del gesto del submit,
      // mientras la cuenta recién creada sigue autenticada). No bloquea el alta.
      if (notifOn && pushSupported) {
        try {
          await enablePush(uid);
        } catch {
          /* si el navegador niega el permiso, seguimos con el alta igual */
        }
      }

      // NO cerramos sesión: el usuario queda autenticado. Como capturamos todo
      // aquí (foto, portada, bio, tags), onRegistered va directo al feed.
      onRegistered();
    } catch (err: unknown) {
      const errCode = (err as { code?: string } | null)?.code;
      if (typeof errCode === "string" && errCode.startsWith("auth/")) {
        setMsg(textoAviso(friendlyAuthErrorKey(err)));
      } else {
        setMsg(t(friendlyProfileErrorKey(err) as Parameters<typeof t>[0]));
      }
    } finally {
      setLoading(false);
    }
  }

  // Estilos espejo de la tarjeta de login (mismos inputs redondeados, mismo
  // botón, misma tipografía). Los selects heredan el look del input.
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
    fontFamily: "inherit",
    lineHeight: 1.5,
    outline: "none",
    WebkitAppearance: "none",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    color: "rgba(255,255,255,0.85)",
    appearance: "none",
    MozAppearance: "none",
    cursor: "pointer",
  };

  const helperTextStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 400,
    color: "rgba(255,255,255,0.60)",
    lineHeight: 1.35,
  };

  const errorTextStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 400,
    color: "rgba(255,120,120,0.95)",
    lineHeight: 1.35,
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
    fontFamily: "inherit",
    cursor: "pointer",
    boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
    overflow: "hidden",
  };

  const birthBorder = isUnder18
    ? { border: "1px solid rgba(255,107,107,0.72)" }
    : {};

  // Asterisco morado para marcar los campos obligatorios.
  const req = <span style={{ color: vibraPurple }}> *</span>;

  return (
    <>
      <style jsx>{`
        select option {
          background-color: #120922;
          color: #ffffff;
        }
        .reg-two-col {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .reg-birthdate-grid {
          display: grid;
          grid-template-columns: 1fr 1.2fr 1fr;
          gap: 8px;
        }
      `}</style>

      <div>
        <h1 style={titleStyle}>{t("title")}</h1>
        <p style={subtitleStyle}>{t("subtitle")}</p>
      </div>

      <form onSubmit={handleRegister} style={{ display: "grid", gap: 8 }}>
        {/* Portada + foto de perfil (acomodo tipo Crear comunidad; estilo
            placeholder: fondo translúcido sin borde). Ambos opcionales. */}
        <div style={{ position: "relative", width: "100%", marginBottom: 66 }}>
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            aria-label={coverPreview ? tCP("coverChange") : tCP("coverAdd")}
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
              <span style={{ position: "absolute", top: 14, insetInlineStart: 0, insetInlineEnd: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="m4 17 4.5-4.5a2 2 0 0 1 2.8 0L16 17M14 14l1.5-1.5a2 2 0 0 1 2.8 0L21 15" />
                </svg>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#fff" }}>{tCP("coverAdd")}</span>
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
          <TextButton
            tone="plain"
            size="sm"
            onClick={() => avatarInputRef.current?.click()}
            style={{
              position: "absolute",
              insetInlineStart: 0,
              insetInlineEnd: 0,
              top: 156,
              justifyContent: "center",
            }}
          >
            {avatarPreview ? t("photoChange") : t("photoAdd")}
          </TextButton>

          <input ref={coverInputRef} type="file" accept="image/*" onChange={(e) => onPickImage(e, "cover")} style={{ display: "none" }} />
          <input ref={avatarInputRef} type="file" accept="image/*" onChange={(e) => onPickImage(e, "avatar")} style={{ display: "none" }} />
        </div>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("emailLabel")}{req}</span>
          <input
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(e) => onEmailChange(e.target.value)}
            style={inputStyle}
            placeholder={t("emailPlaceholder")}
          />
        </label>

        <div className="reg-two-col">
          <label style={{ display: "grid", gap: 4 }}>
            <span style={labelTextStyle}>{t("firstNameLabel")}{req}</span>
            <input
              type="text"
              required
              value={firstName}
              autoComplete="given-name"
              onChange={(e) => setFirstName(e.target.value)}
              style={inputStyle}
              placeholder={t("firstNamePlaceholder")}
            />
          </label>

          <label style={{ display: "grid", gap: 4 }}>
            <span style={labelTextStyle}>{t("lastNameLabel")}{req}</span>
            <input
              type="text"
              required
              value={lastName}
              autoComplete="family-name"
              onChange={(e) => setLastName(e.target.value)}
              style={inputStyle}
              placeholder={t("lastNamePlaceholder")}
            />
          </label>
        </div>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("usernameLabel")}{req}</span>
          <input
            type="text"
            required
            value={handleRaw}
            onChange={(e) => setHandleRaw(e.target.value)}
            style={inputStyle}
            placeholder={t("usernamePlaceholder")}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <span style={helperTextStyle}>{t("usernameHelper")}</span>
        </label>

        <div style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("birthdateLabel")}{req}</span>

          {/* Tres campos, como antes, pero ya no son listas del sistema:
              cualquiera de los tres abre los tambores. Se conservan separados
              porque de un vistazo se ve qué falta por llenar, cosa que un solo
              campo con la fecha junta no dice. */}
          <div className="reg-birthdate-grid">
            {[
              { key: "day", texto: birthDay, vacio: t("dayPlaceholder") },
              {
                key: "month",
                texto:
                  getMonths(locale).find((m) => String(m.value) === birthMonth)?.label ?? "",
                vacio: t("monthPlaceholder"),
              },
              { key: "year", texto: birthYear, vacio: t("yearPlaceholder") },
            ].map((campo) => (
              <button
                key={campo.key}
                type="button"
                onClick={() => setBirthPanelOpen(true)}
                style={{
                  ...selectStyle,
                  ...birthBorder,
                  textAlign: "start",
                  cursor: "pointer",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: campo.texto ? "#fff" : "rgba(255,255,255,0.42)",
                }}
              >
                {campo.texto || campo.vacio}
              </button>
            ))}
          </div>

          <DateWheelPanel
            open={birthPanelOpen}
            onClose={() => setBirthPanelOpen(false)}
            value={{ day: birthDay, month: birthMonth, year: birthYear }}
            months={getMonths(locale).map((m) => ({
              value: String(m.value),
              label: m.label,
            }))}
            years={years}
            defaultYear={DEFAULT_BIRTH_YEAR}
            title={t("birthdateLabel")}
            labels={{
              day: t("dayPlaceholder"),
              month: t("monthPlaceholder"),
              year: t("yearPlaceholder"),
              confirm: tCommon("save"),
              closeAria: tCommon("closeAriaLabel"),
            }}
            onConfirm={({ day, month, year }) => {
              setBirthDay(day);
              setBirthMonth(month);
              setBirthYear(year);
              setBirthPanelOpen(false);
            }}
          />

          {isUnder18 ? (
            <span style={errorTextStyle}>{t("under18Error")}</span>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("sexLabel")}</span>
          <OptionWheelPanel
            value={sex}
            onChange={(v) => setSex(v as Sex)}
            title={t("sexLabel")}
            confirmLabel={tCommon("save")}
            closeAriaLabel={tCommon("closeAriaLabel")}
            options={[
              { value: "prefer_not_say", label: t("sexPreferNotSay") },
              { value: "male", label: t("sexMale") },
              { value: "female", label: t("sexFemale") },
              { value: "other", label: t("sexOther") },
            ]}
          />
        </div>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("passwordLabel")}{req}</span>
          <input
            type="password"
            required
            value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            placeholder={t("passwordPlaceholder")}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("confirmPasswordLabel")}{req}</span>
          <input
            type="password"
            required
            value={password2}
            autoComplete="new-password"
            onChange={(e) => setPassword2(e.target.value)}
            style={{
              ...inputStyle,
              border: passwordsMatch
                ? "none"
                : "1px solid rgba(255,107,107,0.72)",
            }}
            placeholder={t("confirmPasswordPlaceholder")}
          />
          {!passwordsMatch && password2 ? (
            <span style={errorTextStyle}>{t("passwordMismatch")}</span>
          ) : null}
        </label>

        {/* Bio (opcional) */}
        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{tCP("bioLabel")}</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 300))}
            style={{ ...inputStyle, minHeight: 74, resize: "vertical", lineHeight: 1.45 }}
            placeholder={tCP("bioPlaceholder")}
            maxLength={300}
          />
        </label>

        {/* Redes sociales (opcional). El formulario ya es largo, así que van
            plegadas: quien no las quiera ni las abre, y quien sí, las llena de
            una vez y no tiene que volver a ajustes. */}
        <div style={{ display: "grid", gap: 6, justifyItems: "start" }}>
          <button
            type="button"
            onClick={() => setSocialOpen((v) => !v)}
            aria-expanded={socialOpen}
            aria-controls="registro-redes"
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              color: vibraPurple,
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              textAlign: "start",
            }}
          >
            {tProfile("socialLinksAdd")}
          </button>

          {/* Se despliega de 0fr a 1fr: es la única forma de animar hasta un
              alto que no se conoce de antemano sin medirlo a mano.
              El editor NO se desmonta al cerrar. Lo tecleado vive en el estado
              del formulario, así que se conservaría igual, pero desmontarlo
              haría perder el foco y daría un parpadeo al reabrir. Cerrado va
              deshabilitado para que el tabulador no entre en campos que no se
              ven. */}
          <div
            id="registro-redes"
            style={{
              width: "100%",
              display: "grid",
              gridTemplateRows: socialOpen ? "1fr" : "0fr",
              transition: "grid-template-rows 280ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <div style={{ minHeight: 0, overflow: "hidden" }}>
              <div style={{ paddingTop: 6 }}>
                <SocialLinksEditor
                  value={socialDraft}
                  onChange={setSocialDraft}
                  disabled={!socialOpen}
                />
              </div>
            </div>
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
              <div style={{ ...labelTextStyle, fontWeight: 600 }}>{tCP("notifLabel")}</div>
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(255,255,255,0.6)",
                  lineHeight: 1.3,
                  marginTop: 2,
                }}
              >
                {tCP("notifHint")}
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={notifOn}
              aria-label={tCP("notifLabel")}
              onClick={() => setCPOn((v) => !v)}
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
                  insetInlineStart: notifOn ? 20 : 2,
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

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 1,
            flexWrap: "wrap",
          }}
        >
          <TextButton tone="brand" size="sm" onClick={onSwitchToLogin}>
            {t("haveAccount")}
          </TextButton>
        </div>

        <button
          type="submit"
          disabled={loading || isUnder18}
          style={{
            ...primaryButtonStyle,
            marginTop: 2,
            opacity: loading || isUnder18 ? 0.82 : 1,
            cursor: loading || isUnder18 ? "not-allowed" : "pointer",
            filter: loading ? "grayscale(0.15)" : "none",
          }}
        >
          {loading ? t("submitting") : t("submit")}
        </button>
      </form>


      <ImageCropperModal
        open={cropOpen}
        title={cropMode === "avatar" ? t("cropPhotoTitle") : tCP("cropCoverTitle")}
        hint={cropMode === "avatar" ? t("cropPhotoHint") : tCP("cropCoverHint")}
        imageSrc={cropSrc}
        aspect={cropMode === "avatar" ? 1 : 16 / 9}
        cropShape={cropMode === "avatar" ? "round" : "rect"}
        onClose={closeCrop}
        onConfirm={handleCropConfirm}
      />

      <VibraToast toast={toast} />
    </>
  );
}
