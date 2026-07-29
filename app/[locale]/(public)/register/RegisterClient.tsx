"use client";

// Página /register (acceso directo por URL). Es un wrapper delgado: pone el shell
// de la página y monta RegisterPanel (que tiene toda la lógica de creación de
// cuenta). El mismo RegisterPanel se reutiliza dentro de la tarjeta de login.

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  appendSafeNextParam,
  getNextFromSearchParams,
} from "@/lib/auth-redirect";
import RegisterPanel from "./RegisterPanel";

export default function RegisterClient() {
  const [email, setEmail] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = getNextFromSearchParams(searchParams, "/");
  const loginHref = appendSafeNextParam("/login", nextPath);

  const pageStyle: React.CSSProperties = {
    minHeight: "100dvh",
    position: "relative",
    zIndex: 1,
    background: "transparent",
    color: "#fff",
    fontFamily: "inherit",
    padding: "clamp(12px, 2.2vw, 18px) clamp(12px, 2.2vw, 18px) clamp(44px, 6vw, 72px)",
    display: "grid",
    placeItems: "center",
    boxSizing: "border-box",
  };

  const shellStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 380,
    padding: "24px 36px 34px",
    borderRadius: 18,
    border: "1px solid rgba(168, 85, 255, 0.58)",
    background: "rgba(10, 7, 28, 0.30)",
    boxShadow:
      "0 0 0 1px rgba(255,255,255,0.03) inset, 0 0 28px rgba(168,85,255,0.18)",
    backdropFilter: "blur(16px) saturate(120%)",
    WebkitBackdropFilter: "blur(16px) saturate(120%)",
    boxSizing: "border-box",
  };

  return (
    <main style={pageStyle}>
      <div style={shellStyle}>
        <RegisterPanel
          email={email}
          onEmailChange={setEmail}
          onSwitchToLogin={() => router.push(loginHref)}
          onRegistered={() =>
            router.replace(
              `/login?registered=1&next=${encodeURIComponent(nextPath)}`
            )
          }
        />
      </div>
    </main>
  );
}
