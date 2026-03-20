"use client";

import LogoutButton from "../LogoutButton";
import { useEffect, useState } from "react";
import { useAuth } from "../providers";
import { sendEmailVerification } from "firebase/auth";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";

const RESEND_COOLDOWN_SECONDS = 30;
const SHOW_EMAIL_VERIFICATION_BANNER = false;

export default function ProtectedShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();

  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

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

        .header {
          padding: 12px 24px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          background: #000;
          position: relative;
          z-index: 20;
        }

        .brand {
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }

        .contentArea {
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          gap: 24px;
          width: min(1280px, calc(100% - 40px));
          margin: 0 auto;
          flex: 1;
          padding-top: 24px;
          padding-bottom: 0;
          box-sizing: border-box;
        }

        .sidebarCol {
          position: relative;
          min-width: 0;
        }

        .mainCol {
          min-width: 0;
          width: 100%;
        }

        .verifyBanner {
          background: #fff3cd;
          border-bottom: 1px solid #ffeeba;
          padding: 10px 24px;
          font-size: 14px;
          color: #000;
          position: relative;
          z-index: 20;
        }

        @media (max-width: 1100px) {
          .contentArea {
            grid-template-columns: 260px minmax(0, 1fr);
            gap: 18px;
            width: min(1280px, calc(100% - 28px));
          }
        }

        @media (max-width: 900px) {
          .header {
            padding: 12px 14px;
          }

          .brand {
            font-size: 18px;
          }

          .contentArea {
            grid-template-columns: 1fr;
            width: 100%;
            gap: 0;
            padding-top: 10px;
          }

          .sidebarCol {
            display: none;
          }

          .mainCol {
            width: 100%;
            min-width: 0;
          }

          .verifyBanner {
            padding: 10px 14px;
            font-size: 13px;
          }
        }
      `}</style>

      <div className="layout">
        <header className="header">
          <strong className="brand">Red Social MVP</strong>
          <LogoutButton />
        </header>

        {SHOW_EMAIL_VERIFICATION_BANNER && user && !user.emailVerified && (
          <div className="verifyBanner">
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