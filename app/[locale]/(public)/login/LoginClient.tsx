"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { getNextFromSearchParams } from "@/lib/auth-redirect";
import LoginCollageBackground from "./LoginCollageBackground";
import WalletOnboarding from "@/app/[locale]/(protected)/wallet/components/WalletOnboarding";
import LoginExperienceBlock from "./LoginExperienceBlock";
import LoginExperienceRail from "./LoginExperienceRail";

/**
 * ⚠️ TEMPORAL — video de muestra compartido por los bloques que todavía no
 * tienen el suyo. Cámbialo por los definitivos (uno por experiencia) cuando
 * existan: si son archivos del proyecto van en `public/`; si vienen de Mux hay
 * que reproducirlos con HLS, como el visor de posts.
 *
 * Se usa el archivo local a propósito. Antes apuntaba a un video de muestra
 * remoto de ~158 MB y el navegador lo descargaba para CADA card, con lo que
 * todo se atragantaba.
 */
const VIDEO_MUESTRA = "/videosaludosyconsejos.mp4";

/** Videos de las cinco experiencias, EN ORDEN. Constante estable: la precarga
 *  la memoriza y un literal por render la haría repetirse sin fin. */
const VIDEOS_EXPERIENCIAS = [
  "/videosaludosyconsejos.mp4",
  "/videosesiones3.mp4",
  VIDEO_MUESTRA,
  VIDEO_MUESTRA,
  VIDEO_MUESTRA,
] as const;

/** Cuántos se descargan enteros ANTES de abrir la página. El resto empieza en
 *  cuanto la página ya se ve. */
const VIDEOS_BLOQUEANTES = 3;
import LegalLinksFooter from "@/components/legal/LegalLinksFooter";
import RegisterPanel from "@/app/[locale]/(public)/register/RegisterPanel";
import CompleteProfilePanel from "@/app/[locale]/(public)/complete-profile/CompleteProfilePanel";
import { useProfileOnboarding } from "@/app/[locale]/(public)/complete-profile/useProfileOnboarding";
import { useScreenReady } from "@/lib/useScreenReady";
import { useExperienceVideos } from "./useExperienceVideos";
import CurrencySwitcher from "@/app/components/CurrencySwitcher";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855f7";
const vibraBlue = "#4f46ff";

function friendlyAuthErrorKey(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "auth/invalid-credential") return "errInvalidCredential";
  if (code === "auth/user-not-found") return "errUserNotFound";
  if (code === "auth/wrong-password") return "errWrongPassword";
  if (code === "auth/too-many-requests") return "errTooManyRequests";
  if (code === "auth/network-request-failed") return "errNetworkFailed";
  if (code === "auth/unauthorized-domain") return "errUnauthorizedDomain";
  if (code === "auth/operation-not-allowed") return "errOperationNotAllowed";
  if (code === "auth/account-exists-with-different-credential") return "errAccountExistsDiff";
  if (code === "auth/cancelled-popup-request") return "errCancelledPopup";
  if (code === "auth/popup-closed-by-user") return "errPopupClosed";
  if (code === "auth/popup-blocked") return "errPopupBlocked";
  return "errUnexpected";
}

function friendlyResetErrorKey(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "auth/invalid-email") return "errInvalidEmail";
  if (code === "auth/user-not-found") return "errUserNotFound";
  if (code === "auth/too-many-requests") return "errTooManyRequests";
  if (code === "auth/network-request-failed") return "errNetworkFailed";
  return "errUnexpected";
}

async function applyAuthPersistence(keepSession: boolean) {
  if (!keepSession) {
    await setPersistence(auth, browserSessionPersistence);
    return;
  }

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    await setPersistence(auth, browserSessionPersistence);
  }
}

export default function LoginClient() {
  const t = useTranslations("auth.login");
  const tReset = useTranslations("auth.resetPassword");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepSession, setKeepSession] = useState(true);
const [msg, setMsg] = useState<string | null>(null);
const [loading, setLoading] = useState(false);
const [isLeavingLogin, setIsLeavingLogin] = useState(false);
// Swap in-place entre los 3 paneles de auth (login ↔ recuperar ↔ crear cuenta),
// sin cambiar de página. `swapped` arranca en false para NO animar el primer
// render; cualquier cambio de panel lo pone en true y todos entran igual
// (deslizando desde la derecha).
const [mode, setMode] = useState<"login" | "reset" | "register" | "complete">("login");
const [swapped, setSwapped] = useState(false);
// Usuario autenticado por Google que aún debe completar perfil (4º panel).
const [googleUser, setGoogleUser] = useState<User | null>(null);
// Tarjeta de auth: para llevar el scroll a su inicio al cambiar de panel.
const cardRef = useRef<HTMLDivElement | null>(null);
const [resetMsg, setResetMsg] = useState<string | null>(null);
const [resetLoading, setResetLoading] = useState(false);
const { startAuthTransition } = useAuth();
// Lógica del panel "completar perfil" (4º panel); activa cuando hay googleUser.
const onboarding = useProfileOnboarding(googleUser);
// Precarga de los videos de las experiencias. El splash NO se quita hasta que
// la página terminó de cargar y los primeros videos están completos, para que
// nadie llegue a ellos mientras se descargan (que es cuando se entrecortan).
const { listo: experienciasListas, fuente: fuenteVideo } = useExperienceVideos(
  VIDEOS_EXPERIENCIAS,
  VIDEOS_BLOQUEANTES,
);
// Avisa al splash de arranque que la pantalla de login ya está pintada.
useScreenReady(experienciasListas);

// Transición al entrar a login desde una acción de invitado (comprar, iniciar
// sesión, etc.): en LAPTOP se re-muestra el splash de marca; en CELULAR la página
// entra deslizando desde la derecha (animación CSS de `.loginSplitPage`). Se activa
// al montar /login, así funciona venga de donde venga la navegación.
useEffect(() => {
  if (typeof window === "undefined") return;
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  if (!isMobile) window.dispatchEvent(new Event("vibra:auth-splash"));
}, []);

useEffect(() => {
  // Fondo negro a nivel de página para que, al scrollear más allá del collage,
  // el resto de la vista quede en negro (lienzo para el contenido de abajo).
  document.documentElement.classList.add("loginPageBg");
  document.body.classList.add("loginPageBg");

  // Al entrar/refrescar login siempre arriba del scroll. Desactivamos la
  // restauración automática del navegador (que reponía la posición de abajo).
  const prevScrollRestoration = window.history.scrollRestoration;
  window.history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  return () => {
    document.documentElement.classList.remove("loginPageBg");
    document.body.classList.remove("loginPageBg");
    window.history.scrollRestoration = prevScrollRestoration;
  };
}, []);

// Al cambiar de panel (login ↔ recuperar ↔ crear cuenta), llevar el scroll al
// inicio de la tarjeta para que el panel destino quede a la vista (ni muy
// arriba ni muy abajo). Solo tras un swap real, no en el primer render.
useEffect(() => {
  if (!swapped) return;
  const el = cardRef.current;
  if (!el) return;
  // Dejamos más aire arriba de la tarjeta (se alcanza a ver el tagline).
  const y = el.getBoundingClientRect().top + window.scrollY - 96;
  window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}, [mode, swapped]);

  const router = useRouter();
  const searchParams = useSearchParams();

  const registered = searchParams.get("registered") === "1";
  const nextPath = getNextFromSearchParams(searchParams, "/");

async function createSessionFromUser(user: User) {
  const idToken = await user.getIdToken(true);

  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idToken,
      keepSession,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data?.ok) {
    await signOut(auth);
    throw new Error(data?.error || t("errSessionFailed"));
  }
}

async function handleLogin(e: React.FormEvent) {
e.preventDefault();
setMsg(null);
setLoading(true);

  try {
      await applyAuthPersistence(keepSession);

      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );

await createSessionFromUser(credential.user);

      setIsLeavingLogin(true);
startAuthTransition("entering");
router.replace(nextPath);
} catch (err: unknown) {
  setIsLeavingLogin(false);

  if (err instanceof Error) {
        const maybeFirebaseError = err as Error & { code?: string };

        if (!maybeFirebaseError.code) {
          setMsg(err.message);
        } else {
          setMsg(t(friendlyAuthErrorKey(maybeFirebaseError) as Parameters<typeof t>[0]));
        }
      } else {
        setMsg(t("errUnexpected"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleLogin() {
  setMsg(null);
  setLoading(true);

  try {
    await applyAuthPersistence(keepSession);

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: "select_account",
    });

    const credential = await signInWithPopup(auth, provider);

    await createSessionFromUser(credential.user);

    const userRef = doc(db, "users", credential.user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      setIsLeavingLogin(true);
      startAuthTransition("entering");
      router.replace(nextPath);
      return;
    }

    // Moderadores no pasan por onboarding — van directo al panel
    const tokenResult = await credential.user.getIdTokenResult();
    if (tokenResult.claims["role"] === "moderator") {
      setIsLeavingLogin(true);
      startAuthTransition("entering");
      router.replace("/admin");
      return;
    }

    // Usuario nuevo de Google → completar perfil en el MISMO card (4º panel),
    // sin cambiar de página. Queda autenticado.
    setGoogleUser(credential.user);
    setSwapped(true);
    setMode("complete");
} catch (err: unknown) {
  setIsLeavingLogin(false);

    const maybeFirebaseError = err as Error & { code?: string };

    if (maybeFirebaseError?.code) {
      setMsg(t(friendlyAuthErrorKey(maybeFirebaseError) as Parameters<typeof t>[0]));
    } else if (err instanceof Error) {
      setMsg(err.message);
    } else {
      setMsg(t("errUnexpected"));
    }
  } finally {
    setLoading(false);
  }
}

async function handleReset(e: React.FormEvent) {
  e.preventDefault();
  setResetMsg(null);
  setResetLoading(true);

  try {
    await sendPasswordResetEmail(auth, email.trim());
    setResetMsg(tReset("successMsg"));
  } catch (err: unknown) {
    setResetMsg(tReset(friendlyResetErrorKey(err) as Parameters<typeof tReset>[0]));
  } finally {
    setResetLoading(false);
  }
}

function goTo(next: "login" | "reset" | "register") {
  setSwapped(true);
  setMode(next);
}

function openReset() {
  setResetMsg(null);
  goTo("reset");
}

function openRegister() {
  goTo("register");
}

function backToLogin() {
  goTo("login");
}

// Registro exitoso desde la tarjeta: el alta captura todo en un paso (foto,
// portada, bio, tags) y el usuario queda logueado → directo al feed.
function handleRegistered() {
  startAuthTransition("entering");
  router.replace(nextPath);
}

  const fontStack =
    'inherit';

const pageStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  background: "transparent",
  color: "#fff",
  fontFamily: fontStack,
  padding:
    "clamp(12px, 2.2vw, 18px) clamp(12px, 2.2vw, 18px) clamp(8px, 1.4vw, 14px)",
  boxSizing: "border-box",
};

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 380,
    padding: "16px clamp(16px, 4vw, 36px) 22px",
    borderRadius: 18,
    border: "none",
    background: "transparent",
    boxShadow: "none",
    boxSizing: "border-box",
  };

  const rightPaneStyle: React.CSSProperties = {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: "clamp(24px, 5vh, 60px)",
    gap: "clamp(36px, 6.5vh, 66px)",
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

  // Estilo canónico de campo Vibra (ver vibra_style.md → "Textarea / campo").
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

 const registerLinkStyle: React.CSSProperties = {
  color: vibraPurple,
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 600,
};

const forgotLinkStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.9)",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 600,
};

  const switchRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 10,
    border: "none",
    background: "rgba(255,255,255,0.022)",
  };

  const switchButtonStyle: React.CSSProperties = {
    position: "relative",
    width: 36,
    height: 20,
    borderRadius: 999,
    border: "none",
    background: keepSession
      ? `linear-gradient(100deg, ${vibraPurple}, ${vibraBlue})`
      : "rgba(255,255,255,0.10)",
    transition: "all 0.2s ease",
    cursor: "pointer",
    flexShrink: 0,
    padding: 0,
  };

  const switchThumbStyle: React.CSSProperties = {
    position: "absolute",
    top: 2,
    insetInlineStart: keepSession ? 18 : 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#fff",
    transition: "all 0.2s ease",
  };

  const noticeStyle: React.CSSProperties = {
    marginBottom: 10,
    borderRadius: 9,
    border: "1px solid rgba(168,85,255,0.18)",
    background: "rgba(255,255,255,0.035)",
    padding: "7px 9px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  return (
    <>
      <LoginCollageBackground />

      <style jsx global>{`

html.loginPageBg,
body.loginPageBg {
  background: #000;
  overscroll-behavior-x: none;
}

        .loginSplitPage {
          display: grid;
          place-items: center;
        }

        /* Contenido debajo del fold. El fondo empieza transparente para dejar ver
           el collage y se DESVANECE a negro (el difuminado del login), antes de
           quedar en negro sólido para el contenido. */
        .loginBelowFold {
          position: relative;
          z-index: 1;
          background: linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0) 0%,
            rgba(0, 0, 0, 0.55) 90px,
            #000 240px
          );
          padding: 34px 0 24px;
        }
        .loginTagline {
          margin: 0;
          font-size: clamp(26px, 3.1vw, 41px);
          font-weight: 700;
          letter-spacing: -0.035em;
          line-height: 1.1;
          white-space: nowrap;
          text-align: center;
          color: #fff;
        }
        .heroVibraGradientText {
  background: linear-gradient(
    100deg,
    #ff2fb3 0%,
    #a855f7 45%,
    #4f46ff 100%
  );
  background-size: 220% 220%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: vibraTextFlow 4.5s ease-in-out infinite;
}


@keyframes vibraTextFlow {
  0%, 100% {
    background-position: 0% 50%;
  }

  50% {
    background-position: 100% 50%;
  }
}

        .loginRightPane {
          min-width: 0;
          position: relative;
          z-index: 1;
        }

        /* Swap entre los 3 paneles de auth (login ↔ recuperar ↔ crear cuenta)
           dentro de la misma tarjeta. TODOS entran igual: deslizando desde la
           derecha. overflow-x: clip recorta el desborde del slide sin scroll. */
        .authSwap {
          overflow-x: clip;
        }
        /* Hint de composición: reservamos la capa GPU desde que el panel monta
           (no en plena primera animación), y aislamos el pintado del subárbol
           con contain. Esto quita el "tirón" de los primeros intentos, cuando el
           navegador tenía que crear la capa en caliente. */
        .authPanel {
          will-change: transform, opacity;
          backface-visibility: hidden;
          contain: paint;
        }
        .authFromRight {
          animation: authSwapFromRight 400ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        @keyframes authSwapFromRight {
          from {
            opacity: 0;
            transform: translateX(42px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .authFromRight {
            animation: none;
          }
        }

@media (max-width: 900px) {
  .loginRightPane {
    /* Menos padding abajo para que el switch de audiencia quede cerca del botón
       de "Continuar con Google" (antes quedaba muy lejos). */
    padding: clamp(28px, 8vh, 72px) 4px 8px;
    /* Celular: acerca el panel al tagline (los switches arriba del título añadían
       altura y lo separaban de "Conecta. Comparte. Vibra."). */
    gap: clamp(16px, 3vh, 34px) !important;
  }

  /* Y menos espacio arriba del switch, para acercarlo aún más al fold. */
  .loginBelowFold {
    padding-top: 8px;
  }

  .loginTagline {
    font-size: clamp(29px, 8.4vw, 41px);
    /* En celular: "Conecta. Comparte." en un renglón y "Vibra." debajo. */
    white-space: normal;
  }

  .loginTagline .heroVibraGradientText {
    display: block;
  }
}

.loginLeaving .loginRightPane {
  animation: vibraLoginAbsorbOut 520ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  pointer-events: none;
  transform-origin: 50% 50%;
}

@keyframes vibraLoginAbsorbOut {
  0% {
    opacity: 1;
    filter: blur(0);
  }

  100% {
    opacity: 0;
    filter: blur(10px);
    transform: scale(0.72);
  }
}

@media (max-width: 420px) {
  .loginRightPane > div {
    /* En celular, top/bottom más compactos; el lateral lo maneja el clamp
       del padding inline de la tarjeta (16px en celular → 36px en laptop). */
    padding-top: 12px !important;
    padding-bottom: 16px !important;
  }
}

/* Celular: al navegar a login (desde cualquier acción de invitado), la página
   entra deslizando desde la derecha. En laptop la transición es el splash. */
@keyframes vibraLoginSlideInRight {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}
@media (max-width: 900px) {
  .loginSplitPage {
    animation: vibraLoginSlideInRight 360ms cubic-bezier(0.22, 1, 0.36, 1);
    will-change: transform;
  }
}
@media (prefers-reduced-motion: reduce) {
  .loginSplitPage {
    animation: none;
  }
}

/* Switches de moneda/idioma dentro del login: SOLO celular (en laptop van arriba
   a la derecha vía (public)/layout). */
.loginMobileSwitches {
  display: none;
}
@media (max-width: 900px) {
  .loginMobileSwitches {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin: 0 0 6px;
  }
}
      `}</style>

     <main
  style={pageStyle}
  className={`loginSplitPage ${isLeavingLogin ? "loginLeaving" : ""}`}
>
        <div className="loginRightPane" style={rightPaneStyle}>
          <p className="loginTagline">
            {t("heroTitle")}{" "}
            <span className="heroVibraGradientText">Vibra.</span>
          </p>

          <div ref={cardRef} style={shellStyle}>
            <div className="authSwap">
              <div
                key={mode}
                className={`authPanel${swapped ? " authFromRight" : ""}`}
              >
                {mode === "login" && (
                  <>
{/* Solo CELULAR: switches de moneda/idioma arriba del título "Iniciar sesión".
    En laptop van arriba a la derecha (los pone el (public)/layout). */}
<div className="loginMobileSwitches">
  <CurrencySwitcher variant="desktop" />
  <LanguageSwitcher variant="desktop" />
</div>

<div>
  <h1 style={titleStyle}>{t("title")}</h1>
  <p style={subtitleStyle}>{t("subtitle")}</p>
</div>

            {registered && (
              <div style={noticeStyle}>
                {t("accountCreated")}
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: "grid", gap: 11 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>{t("emailLabel")}</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                  placeholder={t("emailPlaceholder")}
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>{t("passwordLabel")}</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={inputStyle}
                  placeholder={t("passwordPlaceholder")}
                />
              </label>

              <div style={switchRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                    {t("keepSession")}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    {t("keepSessionHint")}
                  </div>
                </div>

                <button
                  type="button"
                  aria-pressed={keepSession}
                  aria-label={t("keepSessionAriaLabel")}
                  onClick={() => setKeepSession((prev) => !prev)}
                  style={switchButtonStyle}
                >
                  <span style={switchThumbStyle} />
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  marginTop: 4,
marginBottom: 6,
                  flexWrap: "wrap",
                }}
              >
<button
  type="button"
  onClick={openRegister}
  style={{
    ...registerLinkStyle,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontFamily: "inherit",
  }}
>
  {t("createAccount")}
</button>

<button
  type="button"
  onClick={openReset}
  style={{
    ...forgotLinkStyle,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontFamily: "inherit",
  }}
>
  {t("forgotPassword")}
</button>
              </div>

<button
  type="submit"
  disabled={loading}
  style={{
    ...primaryButtonStyle,
    marginTop: 2,
    opacity: loading ? 0.84 : 1,
    cursor: loading ? "not-allowed" : "pointer",
    filter: loading ? "grayscale(0.15)" : "none",
  }}
>
  {t("submit")}
</button>

<button
  type="button"
  disabled={loading}
  onClick={handleGoogleLogin}
  style={{
    width: "100%",
    minHeight: 40,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.10)",
    background: "#fff",
    color: "#1f1f1f",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    fontFamily: fontStack,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.84 : 1,
    boxShadow: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  }}
>
  <svg
    width="18"
    height="18"
    viewBox="0 0 18 18"
    aria-hidden="true"
    focusable="false"
  >
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.94v2.33A9 9 0 0 0 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.16.28-1.71V4.96H.94A9 9 0 0 0 0 9c0 1.45.34 2.82.94 4.04l3.02-2.33z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .94 4.96l3.02 2.33C4.67 5.16 6.66 3.58 9 3.58z"
    />
  </svg>
  {t("googleContinue")}
</button>
            </form>

{msg && (
  <div
    style={{
      ...noticeStyle,
      marginTop: 10,
      marginBottom: 0,
      border: "1px solid rgba(255, 80, 80, 0.45)",
      background: "rgba(255, 40, 40, 0.10)",
      color: "rgba(255, 190, 190, 0.95)",
    }}
  >
    {msg}
  </div>
)}
                  </>
                )}

                {mode === "reset" && (
                  <>
                  <div>
                    <h1 style={titleStyle}>{tReset("title")}</h1>
                    <p style={subtitleStyle}>{tReset("subtitle")}</p>
                  </div>

                  <form onSubmit={handleReset} style={{ display: "grid", gap: 11 }}>
                    <label style={{ display: "grid", gap: 4 }}>
                      <span style={labelTextStyle}>{tReset("emailLabel")}</span>
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={inputStyle}
                        placeholder={tReset("emailPlaceholder")}
                      />
                    </label>

                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        marginTop: 4,
                        marginBottom: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        type="button"
                        onClick={backToLogin}
                        style={{
                          ...forgotLinkStyle,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {tReset("backToLogin")}
                      </button>

                      <button
                        type="button"
                        onClick={openRegister}
                        style={{
                          ...registerLinkStyle,
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {tReset("createAccount")}
                      </button>
                    </div>

                    <button
                      type="submit"
                      disabled={resetLoading}
                      style={{
                        ...primaryButtonStyle,
                        marginTop: 2,
                        opacity: resetLoading ? 0.84 : 1,
                        cursor: resetLoading ? "not-allowed" : "pointer",
                        filter: resetLoading ? "grayscale(0.15)" : "none",
                      }}
                    >
                      {resetLoading ? tReset("submitting") : tReset("submit")}
                    </button>
                  </form>

                  {resetMsg && (
                    <div
                      style={{
                        ...noticeStyle,
                        marginTop: 10,
                        marginBottom: 0,
                      }}
                    >
                      {resetMsg}
                    </div>
                  )}
                  </>
                )}

                {mode === "register" && (
                  <RegisterPanel
                    email={email}
                    onEmailChange={setEmail}
                    onSwitchToLogin={backToLogin}
                    onRegistered={handleRegistered}
                  />
                )}

                {mode === "complete" && (
                  <CompleteProfilePanel
                    {...onboarding.panel}
                    onSubmit={(e) =>
                      onboarding.submit(e, () => {
                        setIsLeavingLogin(true);
                        startAuthTransition("entering");
                        router.replace(nextPath);
                      })
                    }
                    onCancel={async () => {
                      await signOut(auth);
                      setGoogleUser(null);
                      backToLogin();
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Contenido debajo del fold: SOLO la propuesta para creadores. Se reutiliza
          la info de la wallet (sin los botones de los 11 servicios, porque la
          sesión está cerrada). Antes había un switch Creadores/Usuarios; se quitó
          junto con el panel de usuarios.
          En "completar perfil" (usuario ya autenticado) NO va el pitch de
          marketing, así que se oculta. */}
      {mode !== "complete" && (
      <section className="loginBelowFold">
        {/* Rediseño en curso: los bloques nuevos se van armando arriba y el
            contenido viejo (WalletOnboarding) se queda debajo hasta que lo
            sustituyan por completo. Los videos son de MUESTRA. */}
        {/* En laptop apila los bloques; en celular los vuelve un carrusel de
            una tarjeta por vista. */}
        <LoginExperienceRail>
        <LoginExperienceBlock
          itemsLeft
          eyebrow="Experiencias personales"
          title="Cuando es para ti, se siente distinto"
          description="Un saludo para hacer inolvidable un momento. Un consejo para dar el siguiente paso. Pídelo a quien admiras o grábalo para alguien que eligió escucharte."
          videoSrc={fuenteVideo(VIDEOS_EXPERIENCIAS[0])}
          service="saludo"
          accentColor="#a855f7"
          // Los textos por servicio hablan solo del saludo; esta card cubre
          // también los consejos, así que se escriben aquí para abarcar ambos.
          items={[
            {
              icon: "check",
              title: "Saludo o consejo personalizado",
              description:
                "Se graba a partir de lo que tú cuentes, con tu nombre, la ocasión o eso que quieres resolver.",
            },
            {
              icon: "download",
              title: "Descargable",
              description:
                "El video queda en alta calidad para que lo guardes, lo veas cuando quieras y lo compartas.",
            },
          ]}
        />

        <LoginExperienceBlock
          eyebrow="Encuentros exclusivos"
          title="Cuando el tiempo es para ustedes, todo cambia"
          description="Una conversación, una guía o una experiencia compartida en tiempo real. Reserva un momento con quien admiras o abre un espacio para quienes quieren conectar contigo."
          videoSrc={fuenteVideo(VIDEOS_EXPERIENCIAS[1])}
          service="meetGreet"
          accentColor="#ec4899"
          // Lista propia: la del servicio hablaba solo del meet & greet y este
          // card cubre también las sesiones exclusivas. Fuera quedan la
          // duración —cada creador fija la suya— y el "Qué incluye", que abría
          // una lista dentro de la lista.
          items={[
            {
              icon: "camera",
              title: "Conversación en privado",
              description:
                "Un momento en videollamada para conversar, pedir orientación o compartir una experiencia directamente con el creador.",
            },
            {
              icon: "calendar",
              title: "Elige cuándo conectar",
              description:
                "Consulta los horarios disponibles y reserva desde la agenda el momento que mejor funcione para ambos.",
            },
            {
              icon: "download",
              title: "Guarda el momento",
              description:
                "Al terminar, recibe la grabación para descargarla y conservar lo mejor de la conversación.",
            },
          ]}
        />

        <LoginExperienceBlock
          itemsLeft
          eyebrow="Apoyo directo"
          title="Cuando valoras lo que alguien crea, puedes hacerlo sentir"
          description="Apoya desde su perfil o dentro de su comunidad y forma parte de lo que está construyendo. Comparte tu reconocimiento o recibe el impulso de quienes creen en ti."
          videoSrc={fuenteVideo(VIDEOS_EXPERIENCIAS[2])}
          service="profileDonation"
          accentColor="#38bdf8"
          // Escritos aquí porque los del servicio hablan solo del perfil y en
          // tercera persona ("el creador…"), que en el login suena a manual.
          items={[
            {
              icon: "handHeart",
              title: "Apoyo directo",
              description:
                "Envía una donación desde un perfil o una comunidad, cuando quieras, para impulsar lo que ese creador está construyendo.",
            },
            {
              icon: "liveHeart",
              title: "Donaciones en vivo",
              description:
                "Hazte presente durante una transmisión con una donación y comparte tu apoyo justo mientras el momento está sucediendo.",
            },
          ]}
        />

        {/* Un solo card junta las tres experiencias del directo y el contenido
            de pago (ticket, supercomentarios y VOD). */}
        <LoginExperienceBlock
          eyebrow="Streaming"
          title="Hay experiencias que merecen vivirse más cerca"
          description="Accede a transmisiones especiales, haz que tu mensaje destaque y disfruta contenido premium cuando tú quieras. En vivo o después, crea experiencias que tu comunidad estará dispuesta a elegir."
          videoSrc={fuenteVideo(VIDEOS_EXPERIENCIAS[3])}
          service="liveAccess"
          // El mismo rojo del directo (aro, badge LIVE, panel del creador), no
          // uno nuevo: el color ya significa "en vivo" en el resto de la app.
          accentColor="#ef4444"
          // Una lista propia para las tres experiencias del card. Antes se
          // apilaban las listas de dos servicios (liveAccess y vodUnlock) y
          // salían seis items, con el ticket contado dos veces.
          items={[
            {
              icon: "ticket",
              title: "Ticket live",
              description:
                "Entra a transmisiones exclusivas comprando tu acceso y vive en directo un momento creado para una audiencia especial.",
            },
            {
              icon: "commentStar",
              title: "Supercomentarios",
              description:
                "Haz que tu mensaje destaque durante la transmisión para compartir tu apoyo y tener más posibilidades de ser visto por el creador.",
            },
            {
              icon: "videoLock",
              title: "VOD premium",
              description:
                "Desbloquea transmisiones grabadas y videos especiales para disfrutarlos cuando quieras, a tu propio ritmo.",
            },
          ]}
        />

        <LoginExperienceBlock
          itemsLeft
          eyebrow="Contenido exclusivo"
          title="Lo mejor se comparte con quienes deciden estar más cerca"
          description="Suscríbete para descubrir una parte diferente de quien sigues o accede solo a las publicaciones que elijas. Comparte algo más con tu comunidad y convierte cada publicación en una experiencia especial."
          videoSrc={fuenteVideo(VIDEOS_EXPERIENCIAS[4])}
          service="subscription"
          accentColor="#3b82f6"
          items={[
            {
              icon: "memberBadge",
              title: "Suscripciones",
              description:
                "Únete a la comunidad de un creador para disfrutar cada mes contenido exclusivo y beneficios reservados para sus miembros.",
            },
            {
              icon: "postUnlocked",
              title: "Publicaciones premium",
              description:
                "Desbloquea únicamente las publicaciones que te interesen con un solo pago, sin necesidad de suscribirte.",
            },
            {
              icon: "postStar",
              title: "Contenido en el feed",
              description:
                "Descubre publicaciones premium directamente en perfiles y comunidades, junto al contenido que ya disfrutas.",
            },
          ]}
        />
        </LoginExperienceRail>

        {/* Las 11 experiencias YA tienen bloque propio arriba, así que el
            listado de la wallet se queda sin ninguna que mostrar: la sección se
            oculta sola (ver `excludeServices` en WalletOnboarding). Se mantiene
            el resto del componente —presentación, comunidades y cierre— hasta
            que el rediseño lo sustituya. */}
        <WalletOnboarding
          showCtas={false}
          twoColumn
          excludeServices={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]}
        />
      </section>
      )}

      {/* Enlaces legales (Términos, Privacidad, Cookies, etc.). Hoy abren un
          panel placeholder; el contenido real llega cuando cada documento se
          valide (ver docs/legal/README.md). */}
      <LegalLinksFooter />
    </>
  );
}