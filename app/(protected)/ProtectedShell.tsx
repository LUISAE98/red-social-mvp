"use client";

import LogoutButton from "../LogoutButton";
import { useEffect, useState } from "react";
import { useAuth } from "../providers";
import { sendEmailVerification } from "firebase/auth";
import OwnerSidebar from "@/app/components/OwnerSidebar/OwnerSidebar";
import MobileBottomNav from "@/app/components/MobileBottomNav";
import GroupsSearchPanel from "@/app/components/SearchToolbar/GroupsSearchPanel";
import { useRouter } from "next/navigation";
import Link from "next/link";

const RESEND_COOLDOWN_SECONDS = 30;
const SHOW_EMAIL_VERIFICATION_BANNER = false;

function HeaderIconButton({
  onClick,
  href,
  title,
  ariaLabel,
  children,
}: {
  onClick?: () => void;
  href?: string;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const commonStyle: React.CSSProperties = {
    width: 40,
    height: 40,
    padding: 0,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(0,0,0,0.45)",
    color: "#fff",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    cursor: "pointer",
    textDecoration: "none",
    flexShrink: 0,
  };

  if (href) {
    return (
      <Link href={href} title={title} aria-label={ariaLabel} style={commonStyle}>
        {children}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      style={commonStyle}
    >
      {children}
    </button>
  );
}

export default function ProtectedShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const router = useRouter();

  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

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
          --shell-gutter: 24px;
          --sidebar-width: 300px;
          --main-max-width: 1120px;

          min-height: 100vh;
          min-height: 100dvh;
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
        }

        .header {
          position: sticky;
          top: 0;
          z-index: 60;
          padding-top: env(safe-area-inset-top);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.92);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }

        .headerInner {
  width: 100%;
  display: grid;
  grid-template-columns: var(--sidebar-width) minmax(0, 780px) auto;
  gap: 14px;
  align-items: center;
  min-height: 72px;

          padding-top: 12px;
          padding-bottom: 12px;
          padding-left: max(var(--shell-gutter), env(safe-area-inset-left));
          padding-right: max(var(--shell-gutter), env(safe-area-inset-right));
          box-sizing: border-box;
        }

        .brandCol {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .brand {
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
          white-space: nowrap;
        }

        .searchCol {
          min-width: 0;
          width: 100%;
        }

        .logoutCol {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          white-space: nowrap;
        }

        .mobileHeaderRow,
        .mobileSearchRow {
          display: none;
        }

        .mobileBrand {
          font-weight: 700;
          letter-spacing: -0.02em;
          line-height: 1.1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 0 1 auto;
          max-width: 34vw;
        }

        .mobileActions {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-left: auto;
          flex-shrink: 0;
        }

        .contentArea {
          width: 100%;
          display: grid;
          grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
          gap: 24px;
          flex: 1;
          padding-top: 24px;
          padding-bottom: calc(24px + env(safe-area-inset-bottom));
          padding-left: var(--shell-gutter);
          padding-right: var(--shell-gutter);
          box-sizing: border-box;
        }

        .sidebarCol {
          position: relative;
          min-width: 0;
        }

        .mainCol {
          min-width: 0;
          width: 100%;
          padding-bottom: 90px;
        }

        .mainInner {
          width: min(var(--main-max-width), 100%);
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
          .layout {
            --shell-gutter: 14px;
            --sidebar-width: 260px;
          }

          .headerInner {
            gap: 12px;
          }

          .contentArea {
            gap: 18px;
          }
        }

        @media (max-width: 900px) {
          .headerInner {
            display: block;
            min-height: unset;
            padding-top: 10px;
            padding-bottom: 10px;
            padding-left: max(14px, env(safe-area-inset-left));
            padding-right: max(14px, env(safe-area-inset-right));
          }

          .brandCol,
          .searchCol,
          .logoutCol {
            display: none;
          }

          .mobileHeaderRow {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
            width: 100%;
            min-height: 56px;
          }

          .mobileSearchRow {
            display: block;
            width: 100%;
          }

          .contentArea {
            grid-template-columns: 1fr;
            gap: 0;
            width: 100%;
            padding: 10px 0 calc(16px + env(safe-area-inset-bottom));
          }

          .sidebarCol {
            display: none;
          }

          .mainCol {
            width: 100%;
            min-width: 0;
            padding-bottom: calc(100px + env(safe-area-inset-bottom));
          }

          .mainInner {
            width: 100%;
          }

          .verifyBanner {
            padding: 10px 14px;
            font-size: 13px;
          }
        }

        @media (max-width: 520px) {
          .mobileHeaderRow {
            gap: 8px;
          }

          .mobileBrand {
            max-width: 28vw;
          }

          .mobileActions {
            gap: 6px;
          }
        }
      `}</style>

      <div className="layout">
        <header className="header">
          <div className="headerInner">
            <div className="brandCol">
              <strong className="brand">Red Social MVP</strong>
            </div>

            <div className="searchCol">
              <GroupsSearchPanel
                fontStack={fontStack}
                showCreateGroup={true}
                createGroupHref="/groups/new"
              />
            </div>

            <div className="logoutCol">
              <LogoutButton />
            </div>

            {!mobileSearchOpen ? (
              <div className="mobileHeaderRow">
                <strong className="mobileBrand">Red Social MVP</strong>

                <div className="mobileActions">
                  <HeaderIconButton
                    onClick={() => setMobileSearchOpen(true)}
                    title="Buscar comunidad"
                    ariaLabel="Buscar comunidad"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle
                        cx="11"
                        cy="11"
                        r="6.5"
                        stroke="currentColor"
                        strokeWidth="1.9"
                      />
                      <path
                        d="M16 16L21 21"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                    </svg>
                  </HeaderIconButton>

                  <HeaderIconButton
                    onClick={() => router.push("/groups/new")}
                    title="Crear comunidad"
                    ariaLabel="Crear comunidad"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 5V19"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                      <path
                        d="M5 12H19"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                      />
                    </svg>
                  </HeaderIconButton>

                  <LogoutButton />
                </div>
              </div>
            ) : (
              <div className="mobileSearchRow">
                <GroupsSearchPanel
                  fontStack={fontStack}
                  showCreateGroup={false}
                  createGroupHref="/groups/new"
                  showCloseSearch={true}
                  onCloseSearch={() => setMobileSearchOpen(false)}
                />
              </div>
            )}
          </div>
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

          <main className="mainCol">
            <div className="mainInner">{children}</div>
          </main>
        </div>

        <MobileBottomNav />
      </div>
    </>
  );
}