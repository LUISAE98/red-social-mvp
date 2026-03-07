"use client";

import { useMemo, useState } from "react";
import { createUserWithEmailAndPassword, sendEmailVerification } from "firebase/auth";
import { doc, getDoc, runTransaction, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Sex = "male" | "female" | "other" | "prefer_not_say";

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

export default function RegisterClient() {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [handleRaw, setHandleRaw] = useState("");
  const [ageRaw, setAgeRaw] = useState("");
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

  const age = useMemo(() => {
    const n = Number(ageRaw);
    return Number.isFinite(n) ? n : NaN;
  }, [ageRaw]);

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

    if (!Number.isFinite(age) || age < 13 || age > 120) {
      setMsg("Edad inválida. Debe estar entre 13 y 120.");
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
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, email, password);
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
          age,
          sex,
          photoURL: null,
          createdAt: serverTimestamp(),
        });
      });

      await sendEmailVerification(cred.user);

      setMsg("Cuenta creada. Revisa tu correo para verificar tu cuenta.");
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
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 18%, #000 52%)",
    color: "#fff",
    fontFamily: fontStack,
    padding: "20px 14px 120px",
    display: "grid",
    placeItems: "center",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 860,
    display: "flex",
    justifyContent: "center",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 520,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(12,12,12,0.92)",
    boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
    overflow: "hidden",
    backdropFilter: "blur(10px)",
  };

  const innerPanelStyle: React.CSSProperties = {
    marginTop: 16,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
  };

  const labelTextStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 1.2,
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  const selectStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 13,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    MozAppearance: "none",
  };

  const helperTextStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 400,
    color: "rgba(255,255,255,0.60)",
    lineHeight: 1.4,
  };

  const linkStyle: React.CSSProperties = {
    color: "rgba(255,255,255,0.82)",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 400,
  };

  const secondaryButtonStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const primaryButtonStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "#fff",
    color: "#000",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: fontStack,
    cursor: "pointer",
  };

  const messageStyle: React.CSSProperties = {
    marginTop: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "10px 12px",
    fontSize: 12,
    fontWeight: 400,
    color: "rgba(255,255,255,0.90)",
    lineHeight: 1.45,
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <div style={cardStyle}>
          <div style={{ padding: 18 }}>
            <style jsx>{`
              input[type="number"]::-webkit-outer-spin-button,
              input[type="number"]::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
              }

              input[type="number"] {
                -moz-appearance: textfield;
                appearance: textfield;
              }

              select option {
                background: #111;
                color: #fff;
              }
            `}</style>

            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  letterSpacing: "-0.01em",
                }}
              >
                Crear cuenta
              </h1>

              <p
                style={{
                  margin: "6px 0 0 0",
                  fontSize: 13,
                  fontWeight: 400,
                  color: "rgba(255,255,255,0.68)",
                  lineHeight: 1.45,
                }}
              >
                Elige tu username y completa tu perfil básico.
              </p>
            </div>

            <div style={innerPanelStyle}>
              <form onSubmit={handleRegister} style={{ display: "grid", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
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

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <label style={{ display: "grid", gap: 6 }}>
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

                  <label style={{ display: "grid", gap: 6 }}>
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

                <label style={{ display: "grid", gap: 6 }}>
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

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={labelTextStyle}>Edad</span>
                    <input
                      type="number"
                      required
                      value={ageRaw}
                      onChange={(e) => setAgeRaw(e.target.value)}
                      min={13}
                      max={120}
                      style={inputStyle}
                      placeholder="18"
                    />
                  </label>

                  <label style={{ display: "grid", gap: 6 }}>
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
                </div>

                <label style={{ display: "grid", gap: 6 }}>
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

                <label style={{ display: "grid", gap: 6 }}>
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
                        ? "1px solid rgba(255,255,255,0.14)"
                        : "1px solid rgba(255,107,107,0.72)",
                    }}
                    placeholder="Repite tu contraseña"
                  />
                  {!passwordsMatch && password2 ? (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 400,
                        color: "rgba(255,140,140,0.92)",
                        lineHeight: 1.4,
                      }}
                    >
                      Las contraseñas no coinciden.
                    </span>
                  ) : null}
                </label>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    marginTop: 2,
                    flexWrap: "wrap",
                  }}
                >
                  <Link href="/login" style={linkStyle}>
                    Ya tengo cuenta
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    ...(loading ? secondaryButtonStyle : primaryButtonStyle),
                    marginTop: 4,
                    opacity: loading ? 0.82 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Creando..." : "Crear cuenta"}
                </button>
              </form>
            </div>

            {msg ? <div style={messageStyle}>{msg}</div> : null}
          </div>
        </div>
      </div>
    </main>
  );
}