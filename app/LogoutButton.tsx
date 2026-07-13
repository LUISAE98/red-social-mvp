"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useAuth } from "@/app/providers";

type LogoutButtonVariant = "icon" | "settings";

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

  // Limpiar caché del cliente que es solo por sesión (no debe persistir para el
  // siguiente usuario en este navegador). Clave definida en GroupsSearchPanel.
  try {
    const SESSION_ONLY_STORAGE_KEYS = ["vibra_search_history"];
    for (const key of SESSION_ONLY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch (error) {
    console.error("Error limpiando caché local de sesión:", error);
  }

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
