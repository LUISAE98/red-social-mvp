"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";
import { createPortal } from "react-dom";
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
const [loading, setLoading] = useState(false);
const { startAuthTransition } = useAuth();

async function handleLogout() {
  setLoading(true);
  startAuthTransition("exiting");

  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error cerrando sesión en Firebase:", error);
  }

  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      cache: "no-store",
    });
  } catch (error) {
    console.error("Error limpiando sesión del servidor:", error);
  }

  window.location.href = "/login";
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
          aria-label={loading ? "Cerrando sesión" : "Cerrar sesión"}
          title={loading ? "Cerrando sesión..." : "Cerrar sesión"}
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
         Cerrar sesión
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
        aria-label={loading ? "Cerrando sesión" : "Cerrar sesión"}
        title={loading ? "Cerrando sesión..." : "Cerrar sesión"}
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
  Salir
</span>
      </button>
    </>
  );
}
