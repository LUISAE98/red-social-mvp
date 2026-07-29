"use client";

// Panel de creación de cuenta, reutilizable. Renderiza SOLO el contenido (título,
// subtítulo, formulario, mensaje) —el shell/tarjeta lo pone quien lo monta—, con
// los estilos de la tarjeta de login. Lo usan dos lugares:
//   - La tarjeta de login (swap in-place login ↔ recuperar ↔ crear cuenta).
//   - La página /register (envuelto en su propio shell).
// La lógica de creación de cuenta (validación + transacción Firestore que crea el
// usuario y reserva el handle) vive AQUÍ, en un solo lugar (sin duplicar).

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
} from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { buildProfileSearchIndex } from "@/lib/profile/profileSearchIndex";

const vibraPink = "#ff2fb3";
const vibraPurple = "#a855ff";
const vibraBlue = "#4f46ff";

type Sex = "male" | "female" | "other" | "prefer_not_say";

function getMonths(locale: string) {
  return Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, i, 1)),
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

function friendlyAuthErrorKey(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "auth/email-already-in-use") return "errEmailInUse";
  if (code === "auth/invalid-email") return "errInvalidEmail";
  if (code === "auth/weak-password") return "errWeakPassword";
  if (code === "auth/network-request-failed") return "errNetworkFailed";
  return "errUnexpected";
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
  const locale = useLocale();
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
      setMsg(t("errUnder18"));
      return;
    }

    if (password !== password2) {
      setMsg(t("errPasswordMismatch"));
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
          updatedAt: serverTimestamp(),
          search: buildProfileSearchIndex({
            handle,
            displayName,
            firstName: fn,
            lastName: ln,
            isActive: true,
            profileSearchable: true,
            updatedAt: serverTimestamp(),
          }),
        });
      });

      await sendEmailVerification(cred.user);
      await signOut(auth);
      onRegistered();
    } catch (err: unknown) {
      const errCode = (err as { code?: string } | null)?.code;
      if (typeof errCode === "string" && errCode.startsWith("auth/")) {
        setMsg(t(friendlyAuthErrorKey(err) as Parameters<typeof t>[0]));
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

  const registerLinkStyle: React.CSSProperties = {
    color: vibraPurple,
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 600,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontFamily: "inherit",
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

  const noticeStyle: React.CSSProperties = {
    marginTop: 10,
    marginBottom: 0,
    borderRadius: 9,
    border: "1px solid rgba(168,85,255,0.18)",
    background: "rgba(255,255,255,0.035)",
    padding: "7px 9px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  const birthBorder = isUnder18
    ? { border: "1px solid rgba(255,107,107,0.72)" }
    : {};

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
        @media (max-width: 640px) {
          .reg-two-col {
            grid-template-columns: 1fr;
          }
          .reg-birthdate-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div>
        <h1 style={titleStyle}>{t("title")}</h1>
        <p style={subtitleStyle}>{t("subtitle")}</p>
      </div>

      <form onSubmit={handleRegister} style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("emailLabel")}</span>
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
            <span style={labelTextStyle}>{t("firstNameLabel")}</span>
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
            <span style={labelTextStyle}>{t("lastNameLabel")}</span>
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
          <span style={labelTextStyle}>{t("usernameLabel")}</span>
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
          <span style={labelTextStyle}>{t("birthdateLabel")}</span>

          <div className="reg-birthdate-grid">
            <select
              value={birthDay}
              onChange={(e) => setBirthDay(e.target.value)}
              style={{ ...selectStyle, ...birthBorder }}
            >
              <option value="">{t("dayPlaceholder")}</option>
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
              style={{ ...selectStyle, ...birthBorder }}
            >
              <option value="">{t("monthPlaceholder")}</option>
              {getMonths(locale).map((month) => (
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
              style={{ ...selectStyle, ...birthBorder }}
            >
              <option value="">{t("yearPlaceholder")}</option>
              {years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          {isUnder18 ? (
            <span style={errorTextStyle}>{t("under18Error")}</span>
          ) : null}
        </div>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("sexLabel")}</span>
          <select
            value={sex}
            onChange={(e) => setSex(e.target.value as Sex)}
            style={selectStyle}
          >
            <option value="prefer_not_say">{t("sexPreferNotSay")}</option>
            <option value="male">{t("sexMale")}</option>
            <option value="female">{t("sexFemale")}</option>
            <option value="other">{t("sexOther")}</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={labelTextStyle}>{t("passwordLabel")}</span>
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
          <span style={labelTextStyle}>{t("confirmPasswordLabel")}</span>
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

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            marginTop: 1,
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={onSwitchToLogin} style={registerLinkStyle}>
            {t("haveAccount")}
          </button>
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

      {msg ? <div style={noticeStyle}>{msg}</div> : null}
    </>
  );
}
