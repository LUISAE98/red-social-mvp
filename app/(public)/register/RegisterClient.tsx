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
          displayName,       // ✅ "Luis Aguirre"
          firstName: fn,
          lastName: ln,
          age,
          sex,
          photoURL: null,    // ✅ diferido al perfil
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

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 460, border: "1px solid #e5e5e5", borderRadius: 16, padding: 22, boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Crear cuenta</h1>
        <p style={{ marginTop: 8, marginBottom: 16, color: "#555" }}>
          Elige tu username y completa tu perfil básico.
        </p>

        <form onSubmit={handleRegister} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Correo</span>
            <input style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Nombre</span>
              <input style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }} type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Apellido</span>
              <input style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }} type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Username (para que te busquen)</span>
            <input style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }} type="text" required value={handleRaw} onChange={(e) => setHandleRaw(e.target.value)} placeholder="ej: luisae98" />
            <span style={{ fontSize: 12, color: "#666" }}>3–20 caracteres, solo letras/números/_</span>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Edad</span>
              <input style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }} type="number" required value={ageRaw} onChange={(e) => setAgeRaw(e.target.value)} min={13} max={120} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Sexo</span>
              <select style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }} value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                <option value="prefer_not_say">Prefiero no decir</option>
                <option value="male">Hombre</option>
                <option value="female">Mujer</option>
                <option value="other">Otro</option>
              </select>
            </label>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Contraseña</span>
            <input style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Confirmar contraseña</span>
            <input style={{ padding: 10, borderRadius: 10, border: passwordsMatch ? "1px solid #ddd" : "1px solid #ff4d4f" }} type="password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </label>

          <button type="submit" disabled={loading} style={{ padding: 10, borderRadius: 10, border: "1px solid #111", background: loading ? "#ddd" : "#111", color: loading ? "#333" : "#fff", cursor: loading ? "not-allowed" : "pointer", fontWeight: 700 }}>
            {loading ? "Creando..." : "Crear cuenta"}
          </button>
        </form>

        {msg && <p style={{ marginTop: 12, marginBottom: 0 }}>{msg}</p>}

        <div style={{ marginTop: 16, fontSize: 14 }}>
          <Link href="/login">Ya tengo cuenta</Link>
        </div>
      </div>
    </main>
  );
}