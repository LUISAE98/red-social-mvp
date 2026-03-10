"use client";

import LogoutButton from "../LogoutButton";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "../providers";
import { sendEmailVerification } from "firebase/auth";
import OwnerSidebar from "@/app/components/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";

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

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
    }
  }, [loading, user, router, pathname]);

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
        setVerifyMsg(
          "❌ Demasiados intentos. Espera un momento y vuelve a intentar."
        );
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
    <>
      <style jsx>{`
        .layout {
          min-height: 100vh;
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
        }

        .contentArea {
          display: grid;
          grid-template-columns: 300px 1fr;
          gap: 24px;
          width: min(1280px, calc(100% - 48px));
          margin: 0 auto;
          flex: 1;
          padding-top: 24px;
        }

        .sidebarCol {
          position: relative;
        }

        .mainCol {
          min-width: 0;
        }

        @media (max-width: 1100px) {
          .contentArea {
            grid-template-columns: 260px 1fr;
            gap: 18px;
          }
        }

        @media (max-width: 900px) {
          .contentArea {
            grid-template-columns: 1fr;
          }

          .sidebarCol {
            display: none;
          }
        }
      `}</style>

      <div className="layout">
        <header
          style={{
            padding: "12px 24px",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#000",
            position: "relative",
            zIndex: 20,
          }}
        >
          <strong>Red Social MVP</strong>
          <LogoutButton />
        </header>

        {!user.emailVerified && (
          <div
            style={{
              background: "#fff3cd",
              borderBottom: "1px solid #ffeeba",
              padding: "10px 24px",
              fontSize: 14,
              color: "#000",
              position: "relative",
              zIndex: 20,
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

        <div className="contentArea">
          <div className="sidebarCol">
            <OwnerSidebar />
          </div>

          <main className="mainCol">{children}</main>
        </div>
        <MobileBottomNav />
      </div>
    </>
  );
}