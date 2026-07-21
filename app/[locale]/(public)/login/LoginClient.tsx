"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import {
  signInWithEmailAndPassword,
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
import Link from "next/link";
import {
  appendSafeNextParam,
  getNextFromSearchParams,
} from "@/lib/auth-redirect";
import LoginCollageBackground from "./LoginCollageBackground";
import WalletOnboarding from "@/app/[locale]/(protected)/wallet/components/WalletOnboarding";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepSession, setKeepSession] = useState(true);
const [msg, setMsg] = useState<string | null>(null);
const [loading, setLoading] = useState(false);
const [isLeavingLogin, setIsLeavingLogin] = useState(false);
// Switch del contenido debajo del fold: creadores (izq) / usuarios (der).
const [audience, setAudience] = useState<"creators" | "users">("creators");
const { startAuthTransition } = useAuth();

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

  const router = useRouter();
  const searchParams = useSearchParams();

  const registered = searchParams.get("registered") === "1";
  const nextPath = getNextFromSearchParams(searchParams, "/");
  const registerHref = appendSafeNextParam("/register", nextPath);

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

    setIsLeavingLogin(true);
    startAuthTransition("entering");

    if (userSnap.exists()) {
      router.replace(nextPath);
      return;
    }

    // Moderadores no pasan por onboarding — van directo al panel
    const tokenResult = await credential.user.getIdTokenResult();
    if (tokenResult.claims["role"] === "moderator") {
      router.replace("/admin");
      return;
    }

    router.replace(`/complete-profile?next=${encodeURIComponent(nextPath)}`);
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
    padding: "16px 36px 22px",
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
    left: keepSession ? 18 : 2,
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
          padding: 34px 0 80px;
        }
        .audienceSwitch {
          position: relative;
          display: flex;
          gap: 4px;
          width: fit-content;
          margin: 0 auto 34px;
          padding: 4px;
          border-radius: 999px;
          /* Fondo con blur para que el switch se lea sobre el collage. */
          background: rgba(6, 3, 14, 0.5);
          border: 1px solid rgba(255, 255, 255, 0.14);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
        }
        .audienceTab {
          border: none;
          border-radius: 999px;
          padding: 9px 24px;
          font-size: 14px;
          font-weight: 600;
          font-family: inherit;
          letter-spacing: -0.01em;
          color: rgba(255, 255, 255, 0.62);
          background: transparent;
          cursor: pointer;
          transition: background 200ms ease, color 200ms ease;
        }
        .audienceTab.isOn {
          background: #ffffff;
          color: #0a0810;
        }
        .usersPlaceholder {
          min-height: 40vh;
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
    #a855ff 45%,
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

@media (max-width: 900px) {
  .loginRightPane {
    padding: clamp(28px, 8vh, 72px) 4px clamp(32px, 8vh, 64px);
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
    padding: 28px 24px !important;
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

          <div style={shellStyle}>
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
<Link href={registerHref} style={registerLinkStyle}>
  {t("createAccount")}
</Link>

<Link href="/reset-password" style={forgotLinkStyle}>
  {t("forgotPassword")}
</Link>
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
          </div>
        </div>
      </main>

      {/* Contenido debajo del fold: switch Creadores/Usuarios. Para creadores se
          reutiliza la info de la wallet (sin los botones de los 11 servicios,
          porque la sesión está cerrada). Para usuarios, aún por definir. */}
      <section className="loginBelowFold">
        <div className="audienceSwitch" role="tablist" aria-label="Público">
          <button
            type="button"
            role="tab"
            aria-selected={audience === "creators"}
            className={`audienceTab${audience === "creators" ? " isOn" : ""}`}
            onClick={() => setAudience("creators")}
          >
            {t("audienceCreators")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={audience === "users"}
            className={`audienceTab${audience === "users" ? " isOn" : ""}`}
            onClick={() => setAudience("users")}
          >
            {t("audienceUsers")}
          </button>
        </div>

        <div className="audiencePanel">
          {audience === "creators" ? (
            <WalletOnboarding showCtas={false} twoColumn />
          ) : (
            <WalletOnboarding showCtas={false} twoColumn audience="users" />
          )}
        </div>
      </section>
    </>
  );
}