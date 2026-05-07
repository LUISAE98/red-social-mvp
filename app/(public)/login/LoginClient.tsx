"use client";

import { useState } from "react";
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  signOut,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  appendSafeNextParam,
  getNextFromSearchParams,
} from "@/lib/auth-redirect";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

function friendlyAuthError(err: any) {
  const code = err?.code as string | undefined;

  if (code === "auth/invalid-credential") return "Correo o contraseña incorrectos.";
  if (code === "auth/user-not-found") return "Usuario no encontrado.";
  if (code === "auth/wrong-password") return "Contraseña incorrecta.";
  if (code === "auth/too-many-requests") return "Demasiados intentos. Intenta más tarde.";
  if (code === "auth/network-request-failed") return "Error de red. Revisa tu conexión.";

  return "Error inesperado. Intenta nuevamente.";
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [keepSession, setKeepSession] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();

  const registered = searchParams.get("registered") === "1";
  const nextPath = getNextFromSearchParams(searchParams, "/");
  const registerHref = appendSafeNextParam("/register", nextPath);

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

      const idToken = await credential.user.getIdToken(true);

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
        throw new Error(data?.error || "No se pudo crear la sesión");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        const maybeFirebaseError = err as Error & { code?: string };

        if (!maybeFirebaseError.code) {
          setMsg(err.message);
        } else {
          setMsg(friendlyAuthError(maybeFirebaseError));
        }
      } else {
        setMsg("Error inesperado. Intenta nuevamente.");
      }
    } finally {
      setLoading(false);
    }
  }

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageStyle: React.CSSProperties = {
    minHeight: "100dvh",
    position: "relative",
    overflow: "hidden",
    background: "#000",
    color: "#fff",
    fontFamily: fontStack,
    padding:
      "clamp(12px, 2.2vw, 18px) clamp(12px, 2.2vw, 18px) clamp(44px, 6vw, 72px)",
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 380,
    padding: "24px 36px 34px",
    borderRadius: 18,
    border: `1px solid rgba(168, 85, 255, 0.58)`,
    background: "rgba(10, 7, 28, 0.30)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 28px rgba(168,85,255,0.18)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    boxSizing: "border-box",
  };

const logoStyle: React.CSSProperties = {
  width: 118,
  height: "auto",
  display: "block",
  margin: "0 auto 22px auto",
};

  const rightPaneStyle: React.CSSProperties = {
    width: "100%",
    minHeight: "100%",
    display: "grid",
    placeItems: "center",
  };
const heroContentStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 1,
  height: "100%",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "clamp(86px, 12vh, 118px)",
  paddingLeft: "clamp(42px, 7vw, 96px)",
  paddingRight: "clamp(24px, 4vw, 60px)",
  boxSizing: "border-box",
};

const heroInnerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 44,
  width: "100%",
  maxWidth: 820,
  transform: "translateY(-24px)",
};

const heroCopyStyle: React.CSSProperties = {
  minWidth: 0,
  width: "min(540px, 100%)",
};

const heroLogoStyle: React.CSSProperties = {
  width: "clamp(150px, 13vw, 260px)",
  height: "auto",
  flexShrink: 0,
};

const heroTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(34px, 3.2vw, 50px)",
  fontWeight: 700,
  letterSpacing: "-0.045em",
  lineHeight: 1.03,
  whiteSpace: "nowrap",
};

const heroTextStyle: React.CSSProperties = {
  margin: "18px 0 0 0",
  fontSize: "clamp(15px, 1.35vw, 18px)",
  fontWeight: 400,
  lineHeight: 1.45,
  color: "rgba(255,255,255,0.82)",
  whiteSpace: "nowrap",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(18px, 2vw, 20px)",
  fontWeight: 600,
  letterSpacing: "-0.02em",
  lineHeight: 1.08,
  textAlign: "center",
};

const subtitleStyle: React.CSSProperties = {
  margin: "6px 0 26px 0",
  fontSize: 12,
  color: "rgba(255,255,255,0.66)",
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
    height: 40,
    padding: "0 11px",
    borderRadius: 8,
    border: "1px solid rgba(168,85,255,0.22)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    transition: "border-color 0.18s ease, background 0.18s ease",
    WebkitAppearance: "none",
  };

const primaryButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  padding: "8px 14px",
  borderRadius: 10,
  border: "none",
  background: `linear-gradient(100deg, ${vibraPink} 0%, ${vibraPurple} 52%, ${vibraBlue} 100%)`,
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
    color: "#fff",
  };

 const registerLinkStyle: React.CSSProperties = {
  color: vibraPurple,
  textDecoration: "none",
  fontSize: 10.5,
  fontWeight: 600,
};

const forgotLinkStyle: React.CSSProperties = {
  color: "rgba(255,255,255,0.9)",
  textDecoration: "none",
  fontSize: 10.5,
  fontWeight: 600,
};

  const switchRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(168,85,255,0.18)",
    background: "rgba(255,255,255,0.022)",
  };

  const switchButtonStyle: React.CSSProperties = {
    position: "relative",
    width: 36,
    height: 20,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.18)",
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
      <style jsx global>{`
        .loginSplitPage {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        }

        .loginBackgroundLayer {
          position: absolute;
          inset: -4%;
          z-index: 0;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(0,0,0,0.18), rgba(0,0,0,0.18)),
            url("/background-vibra.png");
          background-size: cover;
          background-position: center bottom;
          background-repeat: no-repeat;
          transform: scale(1);
          transform-origin: center center;
          animation: loginBackgroundBreath 26s cubic-bezier(0.45, 0, 0.55, 1) infinite;
          will-change: transform;
        }

        @keyframes loginBackgroundBreath {
          0%, 100% {
            transform: scale(1);
          }

          50% {
            transform: scale(1.035);
          }
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

        .loginWaveColorFilter {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          background:
            linear-gradient(
              115deg,
              transparent 0%,
              rgba(79, 70, 255, 0.08) 36%,
              rgba(168, 85, 255, 0.075) 50%,
              rgba(255, 47, 179, 0.08) 64%,
              transparent 100%
            );
          mix-blend-mode: screen;
          opacity: 0.45;
          animation: loginWaveColorFlow 9s ease-in-out infinite;
        }

        @keyframes loginWaveColorFlow {
          0%, 100% {
            transform: translateX(-8%);
            opacity: 0.28;
          }

          50% {
            transform: translateX(8%);
            opacity: 0.5;
          }
        }

        .loginParticles {
          position: absolute;
          inset: 0;
          pointer-events: none;
          overflow: hidden;
          z-index: 0;
        }

        .loginParticle {
          position: absolute;
          border-radius: 999px;
          animation: particleFloat 8s ease-in-out infinite;
        }

        .loginParticle::before,
        .loginParticle::after {
          content: none;
        }

        .loginParticle.isGlowing::before {
          content: "";
          position: absolute;
          inset: -180%;
          border-radius: inherit;
          background: inherit;
          filter: blur(5px);
          opacity: 0.28;
        }

        .loginParticle.isGlowing::after {
          content: "";
          position: absolute;
          inset: -320%;
          border-radius: inherit;
          background: inherit;
          filter: blur(9px);
          opacity: 0.09;
        }

        @keyframes particleFloat {
          0%, 100% {
            transform: translate3d(0, 0, 0);
            opacity: 0.35;
          }

          50% {
            transform: translate3d(12px, -18px, 0);
            opacity: 1;
          }
        }

        .loginLeftPane {
          min-width: 0;
        }

        .loginRightPane {
          min-width: 0;
          position: relative;
          z-index: 1;
        }

        @media (max-width: 1180px) {
  .loginLeftPane {
    transform: scale(0.82);
    transform-origin: center center;
  }
}

@media (max-width: 1040px) {
  .loginLeftPane {
    transform: scale(0.72);
    transform-origin: center center;
  }
}
@media (max-width: 900px) {
  .loginSplitPage {
    grid-template-columns: 1fr;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
  }

  .loginBackgroundLayer {
    inset: -7%;
    background-size: auto 108%;
    background-position: center bottom;
  }

  .loginRightPane {
    width: 100%;
    order: 1;
    padding-top: 18px;
  }

  .loginLeftPane {
    order: 2;
    display: flex;
    width: 100%;
    height: auto !important;
    transform: none;
    padding: 18px 30px 34px !important;
    justify-content: flex-start !important;
  }

  .loginLeftPane img {
    display: none !important;
  }

  .loginLeftPane > div {
    width: 100% !important;
    max-width: none !important;
    justify-content: flex-start !important;
    text-align: left;
    gap: 0 !important;
    transform: none !important;
  }

  .loginLeftPane h2 {
    font-size: 36px !important;
    line-height: 1.02 !important;
    letter-spacing: -0.055em !important;
    text-align: left !important;
  }

  .loginLeftPane p {
    font-size: 15px !important;
    line-height: 1.42 !important;
    margin-top: 18px !important;
    text-align: left !important;
  }
}
.loginRightPane {
  width: 100%;
  order: 1;
  padding-top: 18px;
}

@media (max-width: 420px) {
  .loginRightPane > div {
    padding: 28px 24px !important;
  }
}
      `}</style>

      <main style={pageStyle} className="loginSplitPage">
        <div className="loginBackgroundLayer" aria-hidden="true" />

        <div className="loginWaveColorFilter" aria-hidden="true" />

        <div className="loginParticles" aria-hidden="true">
          {Array.from({ length: 86 }).map((_, index) => {
            const randomA = Math.abs(Math.sin(index * 12.9898) * 43758.5453) % 1;
            const randomB = Math.abs(Math.sin(index * 78.233) * 24634.6345) % 1;
            const randomC = Math.abs(Math.sin(index * 39.425) * 12983.445) % 1;

            const isLowerParticle = index < 68;

            const left = randomA * 100;
            const top = isLowerParticle ? 50 + randomB * 46 : 4 + randomB * 36;

            const color =
              left > 62
                ? "rgba(79, 70, 255, 0.9)"
                : left > 38
                  ? "rgba(168, 85, 255, 0.92)"
                  : "rgba(255, 47, 179, 0.95)";

            const glow =
              left > 62
                ? "rgba(79, 70, 255, 0.9)"
                : left > 38
                  ? "rgba(168, 85, 255, 0.9)"
                  : "rgba(255, 47, 179, 0.95)";

            const size = isLowerParticle ? 2 + randomC * 4.2 : 1.4 + randomC * 2.2;

            return (
              <span
                key={index}
                className={`loginParticle ${randomC > 0.93 ? "isGlowing" : ""}`}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  width: size,
                  height: size,
                  background: color,
                  boxShadow:
                    randomC > 0.93
                      ? `0 0 ${size * 1.8}px ${glow}`
                      : `0 0 ${size * 0.8}px ${glow}`,
                  filter:
                    randomC > 0.93
                      ? `brightness(${1.12 + randomB * 0.18})`
                      : "brightness(1)",
                  animationDelay: `${randomB * 4}s`,
                  animationDuration: `${7 + randomC * 6}s`,
                  opacity:
                    randomA > 0.72
                      ? 0.82
                      : isLowerParticle
                        ? 0.38 + randomC * 0.22
                        : 0.08 + randomC * 0.12,
                }}
              />
            );
          })}
        </div>

        <div className="loginLeftPane" style={heroContentStyle}>
  <div style={heroInnerStyle}>
    <img
      src="/logotipo.png"
      alt="Vibra"
      style={heroLogoStyle}
    />

<div style={heroCopyStyle}>
  <h2 style={heroTitleStyle}>
    Conecta. Comparte.
    <br />
    <span className="heroVibraGradientText">Vibra.</span>
  </h2>

  <p style={heroTextStyle}>
    Únete a comunidades que vibran contigo.
    <br />
    Comparte ideas, contenido y experiencias únicas.
  </p>
</div>
  </div>
</div>

        <div className="loginRightPane" style={rightPaneStyle}>
          <div style={shellStyle}>
<div>
  <img
    src="/logotipo.png"
    alt="Vibra"
    style={logoStyle}
  />

  <h1 style={titleStyle}>Iniciar sesión</h1>
  <p style={subtitleStyle}>Accede con tu correo y contraseña.</p>
</div>

            {registered && (
              <div style={noticeStyle}>
                Cuenta creada. Revisa tu correo para verificarla.
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Correo</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                  placeholder="tucorreo@ejemplo.com"
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Contraseña</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={inputStyle}
                  placeholder="Tu contraseña"
                />
              </label>

              <div style={switchRowStyle}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                    Mantener sesión
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontSize: 10,
                      color: "rgba(255,255,255,0.6)",
                    }}
                  >
                    Dispositivos personales
                  </div>
                </div>

                <button
                  type="button"
                  aria-pressed={keepSession}
                  aria-label="Mantener sesión iniciada"
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
  Crear cuenta
</Link>

<Link href="/reset-password" style={forgotLinkStyle}>
  Olvidé mi contraseña
</Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  ...(loading ? secondaryButtonStyle : primaryButtonStyle),
                  marginTop: 2,
                  opacity: loading ? 0.84 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </form>

            {msg && (
              <div style={{ ...noticeStyle, marginTop: 10, marginBottom: 0 }}>
                {msg}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}