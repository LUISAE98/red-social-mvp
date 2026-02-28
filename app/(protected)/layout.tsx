"use client";

import LogoutButton from "../LogoutButton";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "../providers";
import { sendEmailVerification } from "firebase/auth";

const RESEND_COOLDOWN_SECONDS = 30;

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // ✅ Guard: si no hay sesión, manda a login con next
  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
  }, [loading, user, router, pathname]);

  // ⏳ Countdown UI
  useEffect(() => {
    if (cooldown <= 0) return;

    const t = setInterval(() => {
      setCooldown((c) => (c <= 1 ? 0 : c - 1));
    }, 1000);

    return () => clearInterval(t);
  }, [cooldown]);

  async function handleResendVerification() {
    if (!user) return;

    setSending(true);
    setVerifyMsg(null);

    try {
      // refresca estado del user (por si ya verificó)
      await user.reload();

      if (user.emailVerified) {
        setVerifyMsg("✅ Tu correo ya está verificado.");
        return;
      }

      await sendEmailVerification(user);

      setVerifyMsg("✅ Correo de verificación reenviado. Revisa inbox o spam.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err: any) {
      const code = err?.code as string | undefined;

      if (code === "auth/too-many-requests") {
        setVerifyMsg("❌ Demasiados intentos. Espera un momento y vuelve a intentar.");
        setCooldown(RESEND_COOLDOWN_SECONDS);
      } else {
        setVerifyMsg("❌ No se pudo reenviar el correo. Intenta más tarde.");
      }
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Cargando sesión...</div>;
  }

  if (!user) {
    return null;
  }

  const resendDisabled = sending || cooldown > 0;

  return (
    <div>
      <header
        style={{
          padding: "12px 24px",
          borderBottom: "1px solid #ddd",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <strong>Red Social MVP</strong>
        <LogoutButton />
      </header>

      {/* 🔔 Banner si correo no verificado */}
      {!user.emailVerified && (
        <div
          style={{
            background: "#fff3cd",
            borderBottom: "1px solid #ffeeba",
            padding: "10px 24px",
            fontSize: 14,
          }}
        >
          <span>Tu correo no está verificado. Revisa tu bandeja o </span>

          <button
            onClick={handleResendVerification}
            disabled={resendDisabled}
            style={{
              background: "none",
              border: "none",
              color: resendDisabled ? "#999" : "#0070f3",
              cursor: resendDisabled ? "not-allowed" : "pointer",
              textDecoration: "underline",
              padding: 0,
              fontSize: 14,
            }}
          >
            {sending
              ? "Enviando..."
              : cooldown > 0
              ? `Reenviar en ${cooldown}s`
              : "reenviar verificación"}
          </button>

          {verifyMsg && <span style={{ marginLeft: 12 }}>{verifyMsg}</span>}
        </div>
      )}

      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}