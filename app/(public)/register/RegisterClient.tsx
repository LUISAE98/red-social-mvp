"use client";

import { useMemo, useState } from "react";
import { createUserWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Sex = "male" | "female" | "other" | "prefer_not_say";

const MONTHS = [
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

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

function friendlyAuthError(err: any) {
  const code = err?.code as string | undefined;

  if (code === "auth/email-already-in-use") return "Este correo ya está registrado.";
  if (code === "auth/invalid-email") return "El correo no es válido.";
  if (code === "auth/weak-password") return "La contraseña debe tener al menos 6 caracteres.";
  if (code === "auth/network-request-failed") {
    return "Error de red. Revisa tu conexión e intenta de nuevo.";
  }

  return "Error inesperado. Intenta nuevamente.";
}

function friendlyProfileError(err: any) {
  const code = err?.code as string | undefined;
  const msg = String(err?.message || "");

  if (code === "permission-denied") return "Permiso denegado. Revisa reglas de Firestore.";
  if (msg.includes("HANDLE_TAKEN")) return "Ese nombre de usuario ya está ocupado.";

  return "No se pudo completar el registro. Intenta nuevamente.";
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

function getYearOptions() {
  const currentYear = new Date().getFullYear();
  const maxYear = currentYear - 18;
  const minYear = currentYear - 120;
  const years: number[] = [];

  for (let y = maxYear; y >= minYear; y -= 1) {
    years.push(y);
  }

  return years;
}

export default function RegisterClient() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [handleRaw, setHandleRaw] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [sex, setSex] = useState<Sex>("prefer_not_say");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const handle = useMemo(() => normalizeHandle(handleRaw), [handleRaw]);

  const passwordsMatch = useMemo(() => {
    if (!password || !password2) return true;
    return password === password2;
  }, [password, password2]);

  const years = useMemo(() => getYearOptions(), []);
  const days = useMemo(() => {
    const y = Number(birthYear);
    const m = Number(birthMonth);
    const total = getDaysInMonth(y, m);
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [birthYear, birthMonth]);

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
      setMsg("Nombre inválido (1–40 caracteres).");
      return;
    }

    if (!isValidName(ln)) {
      setMsg("Apellido inválido (1–40 caracteres).");
      return;
    }

    if (!isValidHandle(handle)) {
      setMsg("El username debe tener 3–20 caracteres y solo usar letras, números o _. Ej: luisae98");
      return;
    }

    if (!birthYear || !birthMonth || !birthDay || !birthDate) {
      setMsg("Completa tu fecha de nacimiento.");
      return;
    }

    if (!Number.isFinite(calculatedAge) || calculatedAge < 18) {
      setMsg("Debes tener al menos 18 años para crear una cuenta.");
      return;
    }

    if (password !== password2) {
      setMsg("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);

    try {
      const handleRef = doc(db, "handles", handle);
      const handleSnap = await getDoc(handleRef);

      if (handleSnap.exists()) {
        setMsg("Ese username ya está ocupado.");
        setLoading(false);
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;

      const userRef = doc(db, "users", uid);
      const displayName = `${fn} ${ln}`.trim();

      await runTransaction(db, async (tx) => {
        const existing = await tx.get(handleRef);
        if (existing.exists()) throw new Error("HANDLE_TAKEN");

        tx.set(handleRef, {
          uid,
          createdAt: serverTimestamp(),
        });

        tx.set(userRef, {
          uid,
          handle,
          displayName,
          firstName: fn,
          lastName: ln,
          birthDate,
          sex,
          photoURL: null,
          createdAt: serverTimestamp(),
        });
      });

      await sendEmailVerification(cred.user);
      router.replace("/login?registered=1");
    } catch (err: any) {
      if (err?.code?.startsWith?.("auth/")) {
        setMsg(friendlyAuthError(err));
      } else {
        setMsg(friendlyProfileError(err));
      }
    } finally {
      setLoading(false);
    }
  }

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageStyle: React.CSSProperties = {
    minHeight: "100dvh",
    background:
      "radial-gradient(circle at top, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.018) 18%, #000 52%)",
    color: "#fff",
    fontFamily: fontStack,
    padding: "clamp(12px, 2.2vw, 18px) clamp(12px, 2.2vw, 18px) clamp(44px, 6vw, 72px)",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 332,
  };

  const innerPanelStyle: React.CSSProperties = {
    marginTop: 12,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.022)",
    padding: 10,
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
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    height: 40,
    padding: "0 11px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    outline: "none",
    fontSize: 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
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

  const linkStyle: React.CSSProperties = {
    color: "rgba(255,255,255,0.82)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    fontSize: 10.5,
    fontWeight: 400,
  };

  const secondaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.08)",
    color: "#fff",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const primaryButtonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const messageStyle: React.CSSProperties = {
    marginTop: 10,
    borderRadius: 9,
    border: msg?.includes("18 años")
      ? "1px solid rgba(255,110,110,0.40)"
      : "1px solid rgba(255,255,255,0.08)",
    background: msg?.includes("18 años")
      ? "rgba(255,80,80,0.08)"
      : "rgba(255,255,255,0.035)",
    padding: "7px 9px",
    fontSize: 10.5,
    fontWeight: 400,
    color: msg?.includes("18 años")
      ? "rgba(255,155,155,0.96)"
      : "rgba(255,255,255,0.90)",
    lineHeight: 1.35,
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <style jsx>{`
          select option {
            background: #111;
            color: #fff;
          }

          .register-two-col {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }

          .birthdate-grid {
            display: grid;
            grid-template-columns: 1fr 1.2fr 1fr;
            gap: 8px;
          }

          @media (max-width: 640px) {
            .register-two-col {
              grid-template-columns: 1fr;
            }

            .birthdate-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>

        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(18px, 2vw, 20px)",
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
            }}
          >
            Crear cuenta
          </h1>

          <p
            style={{
              margin: "5px 0 0 0",
              fontSize: 12,
              fontWeight: 400,
              color: "rgba(255,255,255,0.66)",
              lineHeight: 1.35,
            }}
          >
            Elige tu username y completa tu perfil básico.
          </p>
        </div>

        <div style={innerPanelStyle}>
          <form onSubmit={handleRegister} style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Correo</span>
              <input
                type="email"
                required
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
                placeholder="tucorreo@ejemplo.com"
              />
            </label>

            <div className="register-two-col">
              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Nombre</span>
                <input
                  type="text"
                  required
                  value={firstName}
                  autoComplete="given-name"
                  onChange={(e) => setFirstName(e.target.value)}
                  style={inputStyle}
                  placeholder="Tu nombre"
                />
              </label>

              <label style={{ display: "grid", gap: 4 }}>
                <span style={labelTextStyle}>Apellido</span>
                <input
                  type="text"
                  required
                  value={lastName}
                  autoComplete="family-name"
                  onChange={(e) => setLastName(e.target.value)}
                  style={inputStyle}
                  placeholder="Tu apellido"
                />
              </label>
            </div>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Username</span>
              <input
                type="text"
                required
                value={handleRaw}
                onChange={(e) => setHandleRaw(e.target.value)}
                style={inputStyle}
                placeholder="ej: luisae98"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              <span style={helperTextStyle}>
                3–20 caracteres, solo letras, números o guion bajo.
              </span>
            </label>

            <div style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Fecha de nacimiento</span>

              <div className="birthdate-grid">
                <select
                  value={birthDay}
                  onChange={(e) => setBirthDay(e.target.value)}
                  style={{
                    ...selectStyle,
                    border: isUnder18
                      ? "1px solid rgba(255,107,107,0.72)"
                      : "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <option value="">Día</option>
                  {days.map((day) => (
                    <option key={day} value={String(day)}>
                      {day}
                    </option>
                  ))}
                </select>

                <select
                  value={birthMonth}
                  onChange={(e) => {
                    const nextMonth = e.target.value;
                    setBirthMonth(nextMonth);

                    const y = Number(birthYear);
                    const m = Number(nextMonth);
                    const d = Number(birthDay);

                    if (d && y && m) {
                      const maxDay = getDaysInMonth(y, m);
                      if (d > maxDay) {
                        setBirthDay("");
                      }
                    }
                  }}
                  style={{
                    ...selectStyle,
                    border: isUnder18
                      ? "1px solid rgba(255,107,107,0.72)"
                      : "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <option value="">Mes</option>
                  {MONTHS.map((month) => (
                    <option key={month.value} value={String(month.value)}>
                      {month.label}
                    </option>
                  ))}
                </select>

                <select
                  value={birthYear}
                  onChange={(e) => {
                    const nextYear = e.target.value;
                    setBirthYear(nextYear);

                    const y = Number(nextYear);
                    const m = Number(birthMonth);
                    const d = Number(birthDay);

                    if (d && y && m) {
                      const maxDay = getDaysInMonth(y, m);
                      if (d > maxDay) {
                        setBirthDay("");
                      }
                    }
                  }}
                  style={{
                    ...selectStyle,
                    border: isUnder18
                      ? "1px solid rgba(255,107,107,0.72)"
                      : "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  <option value="">Año</option>
                  {years.map((year) => (
                    <option key={year} value={String(year)}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              {isUnder18 ? (
                <span style={errorTextStyle}>
                  Debes tener al menos 18 años para crear una cuenta.
                </span>
              ) : null}
            </div>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Sexo</span>
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as Sex)}
                style={selectStyle}
              >
                <option value="prefer_not_say">Prefiero no decir</option>
                <option value="male">Hombre</option>
                <option value="female">Mujer</option>
                <option value="other">Otro</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Contraseña</span>
              <input
                type="password"
                required
                value={password}
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                style={inputStyle}
                placeholder="Mínimo 6 caracteres"
              />
            </label>

            <label style={{ display: "grid", gap: 4 }}>
              <span style={labelTextStyle}>Confirmar contraseña</span>
              <input
                type="password"
                required
                value={password2}
                autoComplete="new-password"
                onChange={(e) => setPassword2(e.target.value)}
                style={{
                  ...inputStyle,
                  border: passwordsMatch
                    ? "1px solid rgba(255,255,255,0.12)"
                    : "1px solid rgba(255,107,107,0.72)",
                }}
                placeholder="Repite tu contraseña"
              />
              {!passwordsMatch && password2 ? (
                <span style={errorTextStyle}>
                  Las contraseñas no coinciden.
                </span>
              ) : null}
            </label>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                marginTop: 1,
                flexWrap: "wrap",
              }}
            >
              <Link href="/login" style={linkStyle}>
                Ya tengo cuenta
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading || isUnder18}
              style={{
                ...(loading ? secondaryButtonStyle : primaryButtonStyle),
                marginTop: 2,
                opacity: loading || isUnder18 ? 0.82 : 1,
                cursor: loading || isUnder18 ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Creando..." : "Crear cuenta"}
            </button>
          </form>
        </div>

        {msg ? <div style={messageStyle}>{msg}</div> : null}
      </div>
    </main>
  );
}