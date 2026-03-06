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
  if (code === "auth/network-request-failed") return "Error de red. Revisa tu conexión e intenta de nuevo.";
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

    if (!isValidName(fn)) return setMsg("❌ Nombre inválido (1–40 caracteres).");
    if (!isValidName(ln)) return setMsg("❌ Apellido inválido (1–40 caracteres).");

    if (!isValidHandle(handle)) {
      return setMsg("❌ El username debe tener 3–20 caracteres y solo usar letras, números o _. Ej: luisae98");
    }

    if (!Number.isFinite(age) || age < 13 || age > 120) {
      return setMsg("❌ Edad inválida. Debe estar entre 13 y 120.");
    }

    if (password !== password2) return setMsg("❌ Las contraseñas no coinciden.");

    setLoading(true);

    try {
      // ✅ Precheck: handle ya existe?
      const handleRef = doc(db, "handles", handle);
      const handleSnap = await getDoc(handleRef);
      if (handleSnap.exists()) {
        setMsg("❌ Ese username ya está ocupado.");
        return;
      }

      // 1) Auth
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const uid = cred.user.uid;

      // 2) Firestore: handle + user (sin foto)
      const userRef = doc(db, "users", uid);
      const displayName = `${fn} ${ln}`.trim();

      await runTransaction(db, async (tx) => {
        const existing = await tx.get(handleRef);
        if (existing.exists()) throw new Error("HANDLE_TAKEN");

        tx.set(handleRef, { uid, createdAt: serverTimestamp() });

        tx.set(userRef, {
          uid,
          handle,
          displayName, // ✅ "Luis Aguirre"
          firstName: fn,
          lastName: ln,
          age,
          sex,
          photoURL: null, // ✅ diferido al perfil
          createdAt: serverTimestamp(),
        });
      });

      // 3) Email verification
      await sendEmailVerification(cred.user);

      setMsg("✅ Cuenta creada. Revisa tu correo para verificar tu cuenta.");
      router.replace("/login?registered=1");
    } catch (err: any) {
      if (err?.code?.startsWith?.("auth/")) {
        setMsg(`❌ ${friendlyAuthError(err)}`);
      } else {
        setMsg(`❌ ${friendlyProfileError(err)}`);
      }
    } finally {
      setLoading(false);
    }
  }

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const cardBorder = "1px solid rgba(255,255,255,0.22)";
  const fieldBorder = "1px solid rgba(255,255,255,0.30)";
  const fieldBg = "rgba(0,0,0,0.32)";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "#000",
        color: "#fff",
        fontFamily: fontStack,
      }}
    >
      <div style={{ width: "100%", maxWidth: 460, boxSizing: "border-box" }}>
        <div
          style={{
            borderRadius: 16,
            border: cardBorder,
            background: "rgba(12,12,12,0.9)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ padding: 24 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Crear cuenta</h1>
            <p style={{ marginTop: 6, marginBottom: 20, color: "rgba(255,255,255,0.78)", fontWeight: 400, fontSize: 14 }}>
              Elige tu username y completa tu perfil básico.
            </p>

            <form onSubmit={handleRegister} style={{ display: "grid", gap: 14 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>Correo</span>
                <input
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: fieldBorder,
                    background: fieldBg,
                    color: "#fff",
                    outline: "none",
                    fontSize: 14,
                  }}
                  type="email"
                  required
                  value={email}
                  autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>Nombre</span>
                  <input
                    style={{
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: fieldBorder,
                      background: fieldBg,
                      color: "#fff",
                      outline: "none",
                      fontSize: 14,
                    }}
                    type="text"
                    required
                    value={firstName}
                    autoComplete="given-name"
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>Apellido</span>
                  <input
                    style={{
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: fieldBorder,
                      background: fieldBg,
                      color: "#fff",
                      outline: "none",
                      fontSize: 14,
                    }}
                    type="text"
                    required
                    value={lastName}
                    autoComplete="family-name"
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>
                  Username (para que te busquen)
                </span>
                <input
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: fieldBorder,
                    background: fieldBg,
                    color: "#fff",
                    outline: "none",
                    fontSize: 14,
                  }}
                  type="text"
                  required
                  value={handleRaw}
                  onChange={(e) => setHandleRaw(e.target.value)}
                  placeholder="ej: luisae98"
                />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.62)", fontWeight: 400 }}>
                  3–20 caracteres, solo letras/números/_
                </span>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>Edad</span>
                  <input
                    style={{
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: fieldBorder,
                      background: fieldBg,
                      color: "#fff",
                      outline: "none",
                      fontSize: 14,
                    }}
                    type="number"
                    required
                    value={ageRaw}
                    onChange={(e) => setAgeRaw(e.target.value)}
                    min={13}
                    max={120}
                  />
                </label>

                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>Sexo</span>
                  <select
                    style={{
                      padding: "11px 12px",
                      borderRadius: 10,
                      border: fieldBorder,
                      background: fieldBg,
                      color: "#fff",
                      outline: "none",
                      fontSize: 14,
                    }}
                    value={sex}
                    onChange={(e) => setSex(e.target.value as Sex)}
                  >
                    <option value="prefer_not_say">Prefiero no decir</option>
                    <option value="male">Hombre</option>
                    <option value="female">Mujer</option>
                    <option value="other">Otro</option>
                  </select>
                </label>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>Contraseña</span>
                <input
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: fieldBorder,
                    background: fieldBg,
                    color: "#fff",
                    outline: "none",
                    fontSize: 14,
                  }}
                  type="password"
                  required
                  value={password}
                  autoComplete="new-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.90)" }}>
                  Confirmar contraseña
                </span>
                <input
                  style={{
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: passwordsMatch ? fieldBorder : "1px solid rgba(255, 107, 107, 0.75)",
                    background: fieldBg,
                    color: "#fff",
                    outline: "none",
                    fontSize: 14,
                  }}
                  type="password"
                  required
                  value={password2}
                  autoComplete="new-password"
                  onChange={(e) => setPassword2(e.target.value)}
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 4,
                  padding: "11px",
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.28)",
                  background: loading ? "rgba(255,255,255,0.15)" : "#fff",
                  color: loading ? "#fff" : "#000",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {loading ? "Creando..." : "Crear cuenta"}
              </button>
            </form>

            {msg && (
              <div style={{ marginTop: 14, fontSize: 13, color: "rgba(255,255,255,0.92)" }}>
                {msg}
              </div>
            )}

            <div style={{ marginTop: 18, fontSize: 13 }}>
              <Link
                href="/login"
                style={{
                  color: "rgba(255,255,255,0.85)",
                  textDecoration: "none",
                }}
              >
                Ya tengo cuenta
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}