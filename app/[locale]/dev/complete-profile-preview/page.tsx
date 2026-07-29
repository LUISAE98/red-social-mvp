"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PÁGINA DEV TEMPORAL — simulador del panel "Completar perfil" REAL sin sesión.
//
// Monta el CompleteProfilePanel de producción con estado local (mock), para poder
// ITERAR su diseño sin necesidad de entrar con Google ni crear una cuenta nueva.
// El submit y el cancel NO hacen nada real (no tocan Firebase). Una barra de dev
// permite alternar los estados visuales: toggle de notificaciones (pushSupported),
// estado "cargando" y un mensaje de error de muestra.
//
// ⚠️ BORRAR esta carpeta (app/[locale]/dev/complete-profile-preview) cuando
//    terminemos de pulir el panel. No forma parte del flujo de producción.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import CompleteProfilePanel from "@/app/[locale]/(public)/complete-profile/CompleteProfilePanel";
import { normalizeHandle } from "@/lib/auth/profileOnboarding";

export default function CompleteProfilePreviewDevPage() {
  const [handle, setHandle] = useState("mariana_g");
  const [firstName, setFirstName] = useState("Mariana");
  const [lastName, setLastName] = useState("García");
  const [notifOn, setNotifOn] = useState(true);

  // Controles del simulador (no existen en el flujo real).
  const [pushSupported, setPushSupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showError, setShowError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Simulación sin backend: no crea ningún perfil.
    // eslint-disable-next-line no-console
    console.log("[dev] submit simulado", { handle, firstName, lastName, notifOn });
  }

  function handleCancel() {
    // eslint-disable-next-line no-console
    console.log("[dev] cancel simulado");
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
      {/* Barra de controles del simulador. */}
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
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>
          DEV · completar perfil
        </span>
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
        handle={handle}
        firstName={firstName}
        lastName={lastName}
        onHandleChange={(v) => setHandle(normalizeHandle(v))}
        onFirstNameChange={setFirstName}
        onLastNameChange={setLastName}
        notifOn={notifOn}
        onToggleNotif={() => setNotifOn((v) => !v)}
        pushSupported={pushSupported}
        loading={loading}
        msg={showError ? "Ese nombre de usuario ya está en uso. (mensaje de muestra)" : null}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </>
  );
}
