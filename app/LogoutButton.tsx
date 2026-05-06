"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useState } from "react";

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

async function handleLogout() {
  setLoading(true);

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

  window.location.replace("/login");
}

  if (variant === "settings") {
    return (
      <button
        onClick={handleLogout}
        disabled={loading}
        aria-label={loading ? "Cerrando sesión" : "Cerrar sesión"}
        title={loading ? "Cerrando sesión..." : "Cerrar sesión"}
className={className}
style={style}
type="button"
      >
        {loading ? "Cerrando sesión..." : "Cerrar sesión"}
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      aria-label={loading ? "Cerrando sesión" : "Cerrar sesión"}
      title={loading ? "Cerrando sesión..." : "Cerrar sesión"}
      style={{
        width: 40,
        height: 40,
        padding: 0,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.18)",
        background: "rgba(0,0,0,0.45)",
        color: "#fff",
        cursor: loading ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(8px)",
        transition: "all 0.15s ease",
        opacity: loading ? 0.7 : 1,
      }}
      type="button"
    >
      {loading ? (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif',
          }}
        >
          ...
        </span>
      ) : (
        <span
          aria-hidden="true"
          style={{
            fontSize: 18,
            lineHeight: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          🚪
        </span>
      )}
    </button>
  );
}