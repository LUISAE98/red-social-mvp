"use client";

// El alta exprés, justo antes de cobrar.
//
// ⚠️ Va ANTES de crear el encargo, y no después, por una razón concreta: si el
// correo ya tiene cuenta hay que iniciar sesión con ella, y eso CAMBIA el uid.
// Un encargo creado antes habría quedado colgado del uid anónimo, pagado y sin
// dueño que pueda abrirlo.
//
// Por eso también se pregunta si el correo existe ANTES de pedir contraseña: no
// es un adorno, es lo que decide si se enlaza sobre la sesión de invitado o se
// entra a una cuenta que ya estaba.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { attachGuestAccount, emailHasAccount, MIN_PASSWORD_LENGTH } from "@/lib/guest/guestAccount";

type Props = {
  open: boolean;
  onClose: () => void;
  /** La identidad quedó lista. Aquí sigue el encargo y el cobro. */
  onReady: () => void;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function GuestAccountStep({ open, onClose, onReady }: Props) {
  const tReg = useTranslations("auth.register");
  const tShared = useTranslations("auth.shared");
  const tExpress = useTranslations("auth.express");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // null = todavía no se ha comprobado este correo.
  const [existing, setExisting] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  const emailOk = EMAIL_RE.test(email.trim());

  async function checkEmail() {
    if (!emailOk || checking) return;
    setChecking(true);
    setError(null);
    const res = await emailHasAccount(email);
    // `null` es "no se sabe": se trata como nuevo y, si falla el enlace, el
    // mensaje de abajo lo explica. Nunca se cobra sin haberlo intentado antes.
    setExisting(res);
    setChecking(false);
  }

  async function submit() {
    if (busy) return;
    setError(null);

    if (!emailOk) {
      setError(tShared("errInvalidEmail"));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(tReg("passwordPlaceholder"));
      return;
    }
    // La confirmación solo se pide al crear. Si la cuenta ya existe, la
    // contraseña la escribe de memoria y repetirla no aporta nada.
    if (!existing && password !== confirm) {
      setError(tReg("passwordMismatch"));
      return;
    }

    setBusy(true);
    const res = await attachGuestAccount(email, password, existing === true);
    setBusy(false);

    if (res.ok) {
      onReady();
      return;
    }
    if (res.reason === "wrong-password") setError(tExpress("wrongPassword"));
    else if (res.reason === "email-in-use") setError(tExpress("emailHasAccount"));
    else if (res.reason === "weak-password") setError(tReg("passwordPlaceholder"));
    else setError(tShared("errUnexpected"));
  }

  const input: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "11px 13px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "#fff",
    fontSize: 15,
    fontFamily: "inherit",
    outline: "none",
  };

  // ⚠️ Se monta en un PORTAL sobre `document.body`, y no es opcional.
  //
  // `position: fixed` deja de referirse a la pantalla en cuanto un ancestro
  // tiene `transform`. El carrusel de escritorio mueve sus paneles con uno, y
  // este paso vive dentro del slide de una historia: sin portal se pintaba
  // DENTRO del panel, recortado, y parecia que el boton no hacia nada. La
  // pasarela de pago ya se monta asi, por lo mismo.
  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        // ⚠️ Por encima del formulario que abre este paso, que se pinta casi
        // en el techo (2147483646). Con un numero menor el alta se abria
        // DETRAS y parecia que el boton no hacia nada.
        zIndex: 2147483647,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 380,
          borderRadius: 18,
          padding: 22,
          background: "linear-gradient(160deg, #14061f 0%, #0d0418 100%)",
          border: "1px solid rgba(255,255,255,0.10)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontFamily: "inherit",
        }}
      >
        <h2 style={{ margin: 0, color: "#fff", fontSize: 19, fontWeight: 700 }}>
          {tExpress("title")}
        </h2>
        <p style={{ margin: 0, color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 1.45 }}>
          {tExpress("subtitle")}
        </p>

        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder={tReg("emailPlaceholder")}
          aria-label={tReg("emailLabel")}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            // Cambió el correo: lo que se sabía del anterior ya no vale.
            setExisting(null);
          }}
          onBlur={checkEmail}
          style={input}
        />

        {existing === true && (
          <p style={{ margin: 0, color: "#facc15", fontSize: 12.5, lineHeight: 1.45 }}>
            {tExpress("emailHasAccount")}
          </p>
        )}

        <input
          type="password"
          autoComplete={existing ? "current-password" : "new-password"}
          placeholder={tReg("passwordPlaceholder")}
          aria-label={tReg("passwordLabel")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
        />

        {existing !== true && (
          <input
            type="password"
            autoComplete="new-password"
            placeholder={tReg("confirmPasswordPlaceholder")}
            aria-label={tReg("confirmPasswordLabel")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={input}
          />
        )}

        {error && (
          <p style={{ margin: 0, color: "#f87171", fontSize: 12.5, lineHeight: 1.45 }}>{error}</p>
        )}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || checking}
          style={{
            marginTop: 4,
            height: 46,
            borderRadius: 12,
            border: "none",
            background: "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)",
            color: "#fff",
            fontSize: 15,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: busy || checking ? "default" : "pointer",
            opacity: busy || checking ? 0.6 : 1,
          }}
        >
          {busy ? tReg("submitting") : tExpress("continue")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
