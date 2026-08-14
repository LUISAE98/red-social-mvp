"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";
import { clearClientSession } from "@/lib/auth/clearClientSession";

type LogoutButtonVariant = "icon" | "settings" | "headerIcon";

type LogoutButtonProps = {
  variant?: LogoutButtonVariant;
  className?: string;
  style?: React.CSSProperties;
};

export default function LogoutButton({
  variant = "icon",
  className,
  style,
}: LogoutButtonProps) {
const tCommon = useTranslations("common");
const [loading, setLoading] = useState(false);
const { startAuthTransition } = useAuth();

async function handleLogout() {
  if (loading) return;
  setLoading(true);
  startAuthTransition("exiting");

  // Petición de limpieza de sesión del servidor SIN await, con keepalive para
  // que se complete aunque la página ya esté navegando. Así navegamos de
  // inmediato tras signOut y no dejamos una ventana donde reaparezca la sesión
  // (evita el parpadeo al cerrar sesión).
  try {
    void fetch("/api/auth/logout", {
      method: "POST",
      cache: "no-store",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignorar
  }

  // Cerrar sesión en Firebase, pero NUNCA dejar que esto bloquee la redirección.
  // En páginas con muchos listeners de Firestore (ej. un perfil), signOut puede
  // tardar o colgarse mientras esos listeners se caen; si esperáramos sin límite,
  // la línea de navegación no se ejecutaría y el usuario quedaría en la página
  // actual ya sin sesión. Con este race garantizamos que siempre redirigimos.
  try {
    await Promise.race([
      signOut(auth),
      new Promise((resolve) => setTimeout(resolve, 1200)),
    ]);
  } catch (error) {
    console.error("Error cerrando sesión en Firebase:", error);
  }

  // Limpiar TODO el rastro local: localStorage de sesión, id de sesión y la
  // caché de Firestore en IndexedDB, que guardaba los documentos que la persona
  // miró (DMs, notificaciones, wallet) y sobrevivía al cierre de sesión.
  // DESPUÉS de signOut y justo antes de redirigir: terminar Firestore mientras
  // los listeners siguen vivos los deja apuntando a una instancia muerta.
  await clearClientSession();

  // Redirección dura y definitiva a login. Usamos replace para que el botón
  // "atrás" no regrese a la página anterior (ya sin sesión).
  window.location.replace("/login");
}

// Black overlay rendered via portal — covers the entire screen immediately
// when the user clicks logout, preventing any flash of unauthenticated content.
const overlay =
  loading && typeof document !== "undefined"
    ? createPortal(
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000",
            zIndex: 999999,
            pointerEvents: "none",
          }}
        />,
        document.body
      )
    : null;

  if (variant === "headerIcon") {
    // Solo el icono (puerta abierta + flecha hacia afuera), en blanco, para el
    // header de escritorio. Misma lógica de cierre de sesión que las demás.
    return (
      <>
        {overlay}
        <button
          onClick={handleLogout}
          disabled={loading}
          aria-label={loading ? tCommon("loggingOut") : tCommon("logout")}
          title={loading ? tCommon("loggingOut") : tCommon("logout")}
          className={className}
          type="button"
          style={{
            border: "none",
            color: "#ffffff",
            cursor: loading ? "not-allowed" : "pointer",
            padding: 6,
            borderRadius: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: loading ? 0.6 : 1,
            WebkitTapHighlightColor: "transparent",
            ...style,
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </>
    );
  }

  if (variant === "settings") {
    return (
      <>
        {overlay}
        <button
          onClick={handleLogout}
          disabled={loading}
          aria-label={loading ? tCommon("loggingOut") : tCommon("logout")}
          title={loading ? tCommon("loggingOut") : tCommon("logout")}
          className={className}
          style={{
width: "100%",
height: 40,
minHeight: 40,
padding: "8px 14px",
            borderRadius: 10,
            border: "none",
            background: "rgba(90, 41, 174, 0.4)",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            fontFamily:
              'inherit',
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 10px 28px rgba(168,85,255,0.22)",
            overflow: "hidden",
            opacity: loading ? 0.84 : 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            ...style,
          }}
          type="button"
        >
         {tCommon("logout")}
        </button>
      </>
    );
  }

  return (
    <>
      {overlay}
      <button
        onClick={handleLogout}
        disabled={loading}
        aria-label={loading ? tCommon("loggingOut") : tCommon("logout")}
        title={loading ? tCommon("loggingOut") : tCommon("logout")}
        style={{
          width: "100%",
          height: 40,
          minHeight: 40,
          padding: "8px 14px",
          boxSizing: "border-box",
          borderRadius: 10,
          border: "none",
          background: "rgba(90, 41, 174, 0.4)",
          color: "#fff",
          fontWeight: 600,
          fontSize: 14,
          letterSpacing: "-0.01em",
          cursor: loading ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "opacity 150ms ease",
          WebkitTapHighlightColor: "transparent",
          opacity: loading ? 0.7 : 1,
        }}
        type="button"
      >
<span
  aria-hidden="true"
  style={{
    fontSize: 13,
    lineHeight: 1,
    fontWeight: 700,
    fontFamily:
      'inherit',
  }}
>
  {tCommon("logout")}
</span>
      </button>
    </>
  );
}
