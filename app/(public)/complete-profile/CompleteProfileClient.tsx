"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { useRouter, useSearchParams } from "next/navigation";
import { getNextFromSearchParams } from "@/lib/auth-redirect";
import {
  MONTHS,
  buildBirthDate,
  calculateAgeFromBirthDate,
  cleanName,
  completeGoogleProfile,
  getDaysInMonth,
  isValidHandle,
  normalizeHandle,
} from "@/lib/auth/profileOnboarding";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

export default function CompleteProfileClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const nextPath = getNextFromSearchParams(searchParams, "/");

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [handle, setHandle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [sex, setSex] = useState("");
  const [bio, setBio] = useState("");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("loginNoScroll");
    document.body.classList.add("loginNoScroll");

    return () => {
      document.documentElement.classList.remove("loginNoScroll");
      document.body.classList.remove("loginNoScroll");
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setCheckingAuth(false);

      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      const displayName = user.displayName?.trim() || "";
      const parts = displayName.split(/\s+/).filter(Boolean);

      if (parts[0]) setFirstName((prev) => prev || parts[0]);
      if (parts.length > 1) setLastName((prev) => prev || parts.slice(1).join(" "));

      const emailPrefix = user.email?.split("@")[0] || "";
      if (emailPrefix) setHandle((prev) => prev || normalizeHandle(emailPrefix));
    });

    return () => unsubscribe();
  }, [nextPath, router]);

  const availableDays = useMemo(() => {
    const monthNumber = Number(birthMonth);
    const yearNumber = Number(birthYear);
    const total = getDaysInMonth(monthNumber, yearNumber);

    return Array.from({ length: total }, (_, index) => String(index + 1));
  }, [birthMonth, birthYear]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!currentUser) {
      setMsg("Tu sesión expiró. Inicia sesión nuevamente.");
      return;
    }

    const normalizedHandle = normalizeHandle(handle);
    const cleanedFirstName = cleanName(firstName);
    const cleanedLastName = cleanName(lastName);
    const birthDate = buildBirthDate(birthYear, birthMonth, birthDay);
    const age = calculateAgeFromBirthDate(birthDate);

    if (!isValidHandle(normalizedHandle)) {
      setMsg("El username debe tener entre 3 y 20 caracteres: letras, números o guion bajo.");
      return;
    }

    if (!cleanedFirstName) {
      setMsg("Escribe tu nombre.");
      return;
    }

    if (!cleanedLastName) {
      setMsg("Escribe tu apellido.");
      return;
    }

    if (!birthDate) {
      setMsg("Selecciona una fecha de nacimiento válida.");
      return;
    }

    if (age < 13) {
      setMsg("Debes tener al menos 13 años para crear una cuenta.");
      return;
    }

    if (!sex) {
      setMsg("Selecciona una opción de sexo.");
      return;
    }

    setLoading(true);

    try {
      await completeGoogleProfile(db, {
        user: currentUser,
        handle: normalizedHandle,
        firstName: cleanedFirstName,
        lastName: cleanedLastName,
        birthDate,
        sex,
        bio,
      });

      router.replace(nextPath);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setMsg(err.message);
      } else {
        setMsg("No se pudo completar tu perfil. Intenta nuevamente.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    await signOut(auth);
    router.replace("/login");
  }

  const fontStack =
    'inherit';

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

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 420,
    padding: "28px 34px 34px",
    borderRadius: 18,
    border: "1px solid rgba(168, 85, 255, 0.58)",
    background: "rgba(10, 7, 28, 0.34)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 28px rgba(168,85,255,0.18)",
    backdropFilter: "blur(16px) saturate(120%)", WebkitBackdropFilter: "blur(16px) saturate(120%)",
    boxSizing: "border-box",
  };

  const logoStyle: React.CSSProperties = {
    width: 142,
    height: "auto",
    display: "block",
    margin: "-15px auto 1px auto",
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 21,
    fontWeight: 650,
    letterSpacing: "-0.03em",
    lineHeight: 1.1,
    textAlign: "center",
  };

  const subtitleStyle: React.CSSProperties = {
    margin: "7px 0 24px",
    fontSize: 12,
    color: "rgba(255,255,255,0.66)",
    lineHeight: 1.4,
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
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    colorScheme: "dark",
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
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle,
    background: "rgba(255,255,255,0.08)",
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

  if (checkingAuth) {
    return <main style={pageStyle} />;
  }

  return (
    <>
      <style jsx global>{`
        html.loginNoScroll,
        body.loginNoScroll {
          overflow: hidden !important;
          height: 100%;
          overscroll-behavior: none;
        }

        .completeProfileInput::placeholder {
          color: rgba(255, 255, 255, 0.36);
        }
      `}</style>

      <main style={pageStyle}>
        <div style={shellStyle}>
          <Image src="/logotipo.png" alt="Vibra" width={142} height={40} style={logoStyle} />

          <h1 style={titleStyle}>Completa tu perfil</h1>
          <p style={subtitleStyle}>
            Solo necesitamos estos datos para terminar de crear tu cuenta.
          </p>

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 13 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Username</span>
              <input
                className="completeProfileInput"
                value={handle}
                onChange={(e) => setHandle(normalizeHandle(e.target.value))}
                style={inputStyle}
                placeholder="tuusuario"
                autoComplete="username"
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Nombre</span>
                <input
                  className="completeProfileInput"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  style={inputStyle}
                  placeholder="Nombre"
                  autoComplete="given-name"
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Apellido</span>
                <input
                  className="completeProfileInput"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  style={inputStyle}
                  placeholder="Apellido"
                  autoComplete="family-name"
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Día</span>
                <select
                  value={birthDay}
                  onChange={(e) => setBirthDay(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Día</option>
                  {availableDays.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Mes</span>
                <select
                  value={birthMonth}
                  onChange={(e) => setBirthMonth(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Mes</option>
                  {MONTHS.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Año</span>
                <input
                  className="completeProfileInput"
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  style={inputStyle}
                  placeholder="1998"
                  inputMode="numeric"
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Sexo</span>
              <select value={sex} onChange={(e) => setSex(e.target.value)} style={selectStyle}>
                <option value="">Seleccionar</option>
                <option value="female">Mujer</option>
                <option value="male">Hombre</option>
                <option value="other">Otro</option>
                <option value="prefer_not_say">Prefiero no decirlo</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>
                Descripción del perfil{" "}
                <span style={{ color: "rgba(255,255,255,0.40)" }}>(opcional)</span>
              </span>
              <textarea
                className="completeProfileInput"
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 300))}
                placeholder="Cuéntale a tu audiencia quién eres..."
                rows={3}
                style={{
                  ...inputStyle,
                  height: "auto",
                  padding: "9px 11px",
                  resize: "vertical",
                }}
              />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", textAlign: "right" }}>
                {bio.length}/300
              </span>
            </label>

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
              {loading ? "Creando perfil..." : "Terminar registro"}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={handleCancel}
              style={{
                ...secondaryButtonStyle,
                opacity: loading ? 0.6 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              Cancelar
            </button>
          </form>

          {msg && <div style={noticeStyle}>{msg}</div>}
        </div>
      </main>
    </>
  );
}