"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DEV TEMPORAL — simulador del panel de onboarding de perfil REAL sin sesión.
//
// Monta el CompleteProfilePanel de producción con estado local (mock), para iterar
// su diseño sin entrar con Google. El submit/cancel NO hacen nada real. Una barra
// dev alterna estados: identidad (Google nuevo vs. email), foto de Google presente
// o no, toggle de notificaciones, "cargando" y un mensaje de error de muestra.
//
// ⚠️ BORRAR esta carpeta cuando terminemos de pulir. No es parte de producción.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import CompleteProfilePanel from "@/app/[locale]/(public)/complete-profile/CompleteProfilePanel";
import { normalizeHandle } from "@/lib/auth/profileOnboarding";

export default function CompleteProfilePreviewDevPage() {
  const [handle, setHandle] = useState("mariana_g");
  const [firstName, setFirstName] = useState("Mariana");
  const [lastName, setLastName] = useState("García");
  const [bio, setBio] = useState("");
  const [notifOn, setNotifOn] = useState(true);

  // Controles del simulador (no existen en el flujo real).
  const [showIdentity, setShowIdentity] = useState(true);
  const [hasGooglePhoto, setHasGooglePhoto] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showError, setShowError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // eslint-disable-next-line no-console
    console.log("[dev] submit simulado", { handle, firstName, lastName, bio, notifOn });
  }

  const chip: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(168,85,255,0.4)",
    background: "rgba(168,85,255,0.12)",
    color: "#e9d5ff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 12,
          left: 12,
          zIndex: 1000,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          padding: 10,
          borderRadius: 12,
          background: "rgba(8,5,20,0.85)",
          border: "1px solid rgba(255,255,255,0.1)",
          backdropFilter: "blur(8px)",
          maxWidth: "min(92vw, 640px)",
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
          DEV · onboarding perfil
        </span>
        <button type="button" style={chip} onClick={() => setShowIdentity((v) => !v)}>
          Identidad: {showIdentity ? "ON (Google nuevo)" : "OFF (email)"}
        </button>
        <button type="button" style={chip} onClick={() => setHasGooglePhoto((v) => !v)}>
          Foto Google: {hasGooglePhoto ? "SÍ" : "NO"}
        </button>
        <button type="button" style={chip} onClick={() => setPushSupported((v) => !v)}>
          Notificaciones: {pushSupported ? "ON" : "OFF"}
        </button>
        <button type="button" style={chip} onClick={() => setLoading((v) => !v)}>
          Cargando: {loading ? "ON" : "OFF"}
        </button>
        <button type="button" style={chip} onClick={() => setShowError((v) => !v)}>
          Mensaje error: {showError ? "ON" : "OFF"}
        </button>
      </div>

      <CompleteProfilePanel
        key={hasGooglePhoto ? "with-photo" : "no-photo"}
        showIdentity={showIdentity}
        handle={handle}
        firstName={firstName}
        lastName={lastName}
        onHandleChange={(v) => setHandle(normalizeHandle(v))}
        onFirstNameChange={setFirstName}
        onLastNameChange={setLastName}
        initialPhotoUrl={hasGooglePhoto ? "/logotipo.webp" : null}
        onAvatarBlobChange={() => {
          /* dev: se ignora */
        }}
        onCoverBlobChange={() => {
          /* dev: se ignora */
        }}
        bio={bio}
        onBioChange={setBio}
        notifOn={notifOn}
        onToggleNotif={() => setNotifOn((v) => !v)}
        pushSupported={pushSupported}
        loading={loading}
        msg={showError ? "Ese nombre de usuario ya está en uso. (mensaje de muestra)" : null}
        onSubmit={handleSubmit}
        onCancel={() => {
          /* dev: no-op */
        }}
      />
    </>
  );
}
