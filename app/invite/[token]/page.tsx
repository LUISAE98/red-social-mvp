"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getInviteLinkPreview,
  consumeInviteLink,
} from "@/lib/groups/inviteLinks";
import { useAuth } from "@/app/providers";

type InvitePreview = {
  success: boolean;
  token: string;
  group: {
    id: string;
    name: string;
    description: string;
    visibility: "private" | "hidden" | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    isActive: boolean;
  };
  invite: {
    isActive: boolean;
    isExpired: boolean;
    exhausted: boolean;
    revoked: boolean;
    usedCount: number;
    maxUses: number | null;
    expiresAt: string | null;
  };
};

function visibilityLabel(v: string | null | undefined) {
  if (v === "hidden") return "Comunidad privada por invitación";
  if (v === "private") return "Comunidad privada con aprobación";
  return "Invitación privada";
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consuming, setConsuming] = useState(false);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const ui = {
    pageMaxWidth: 1080,
    coverHeight: "clamp(190px, 35vw, 300px)",
    avatarSize: "clamp(112px, 22vw, 200px)",
    avatarOffsetTop: "clamp(-56px, -7vw, -72px)",
    cardRadius: 18,
    panelRadius: 14,
    buttonRadius: 12,
    buttonPadding: "11px 16px",
    title: 18,
    body: 14,
    micro: 12,
    shadow: "0 18px 48px rgba(0,0,0,0.55)",
    borderSoft: "1px solid rgba(255,255,255,0.16)",
    borderFaint: "1px solid rgba(255,255,255,0.10)",
    cardBg: "rgba(12,12,12,0.92)",
    panelBg: "rgba(255,255,255,0.03)",
  };

  const pageWrap: React.CSSProperties = {
    minHeight: "calc(100dvh - 70px)",
    padding: "12px 0 calc(120px + env(safe-area-inset-bottom))",
    background: "#000",
    color: "#fff",
    fontFamily: fontStack,
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textRendering: "optimizeLegibility",
  };

  const container: React.CSSProperties = {
    maxWidth: ui.pageMaxWidth,
    margin: "0 auto",
    width: "100%",
    padding: "0 12px",
    boxSizing: "border-box",
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: ui.cardRadius,
    overflow: "hidden",
    border: ui.borderSoft,
    background: ui.cardBg,
    boxShadow: ui.shadow,
    color: "#fff",
    backdropFilter: "blur(10px)",
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: ui.panelRadius,
    border: ui.borderFaint,
    background: ui.panelBg,
    padding: 14,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: ui.title,
    fontWeight: 600,
    lineHeight: 1.2,
    color: "#fff",
    letterSpacing: 0,
    maxWidth: 620,
    textAlign: "center",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
    padding: "0 16px",
    textShadow: "0 2px 14px rgba(0,0,0,0.45)",
    margin: 0,
  };

  const textStyle: React.CSSProperties = {
    fontSize: ui.body,
    fontWeight: 400,
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.82)",
  };

  const microText: React.CSSProperties = {
    fontSize: ui.micro,
    fontWeight: 400,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.70)",
  };

  const primaryButton: React.CSSProperties = {
    padding: ui.buttonPadding,
    borderRadius: ui.buttonRadius,
    border: "1px solid rgba(255,255,255,0.92)",
    background: "#fff",
    color: "#000",
    fontWeight: 700,
    fontSize: ui.body,
    lineHeight: 1.2,
    cursor: "pointer",
    fontFamily: fontStack,
    boxShadow: "0 10px 30px rgba(255,255,255,0.10)",
    minHeight: 42,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    transition: "all 160ms ease",
  };

  const secondaryButton: React.CSSProperties = {
    padding: ui.buttonPadding,
    borderRadius: ui.buttonRadius,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    fontWeight: 700,
    fontSize: ui.body,
    lineHeight: 1.2,
    cursor: "pointer",
    fontFamily: fontStack,
    backdropFilter: "blur(8px)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    minHeight: 42,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    transition: "all 160ms ease",
  };

  const messageBox: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    fontSize: ui.micro,
    fontWeight: 400,
    color: "rgba(255,255,255,0.92)",
    lineHeight: 1.45,
    textAlign: "center",
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const res = await getInviteLinkPreview(token);
        setData(res);
      } catch (e: any) {
        setError(e?.message ?? "Error cargando invitación");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [token]);

  async function handleJoin() {
    if (!user) {
      router.push(`/login?next=/invite/${token}`);
      return;
    }

    setConsuming(true);
    setError(null);

    try {
      const res = await consumeInviteLink(token);
      router.replace(`/groups/${res.groupId}`);
    } catch (e: any) {
      setError(e?.message ?? "Error al usar invitación");
    } finally {
      setConsuming(false);
    }
  }

  const disabled = useMemo(() => {
    if (!data) return true;

    return (
      !data.invite.isActive ||
      data.invite.isExpired ||
      data.invite.exhausted ||
      data.invite.revoked ||
      !data.group.isActive
    );
  }, [data]);

  const coverBg = useMemo(() => {
    if (!data?.group?.coverUrl || disabled) {
      return (
        "data:image/svg+xml;base64," +
        btoa(`
          <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="600">
            <defs>
              <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stop-color="#070707"/>
                <stop offset="0.5" stop-color="#101010"/>
                <stop offset="1" stop-color="#151515"/>
              </linearGradient>
            </defs>
            <rect width="1600" height="600" fill="url(#g)"/>
            <circle cx="1240" cy="180" r="170" fill="#171717" opacity="0.7"/>
            <circle cx="1360" cy="280" r="230" fill="#0f0f0f" opacity="0.9"/>
          </svg>
        `)
      );
    }

    return data.group.coverUrl;
  }, [data, disabled]);

  if (loading) {
    return (
      <main style={pageWrap}>
        <div style={container}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={textStyle}>Cargando invitación...</div>
          </div>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main style={pageWrap}>
        <div style={container}>
          <div style={{ ...cardStyle, padding: 18 }}>
            <div style={messageBox}>❌ {error}</div>
          </div>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const { group, invite } = data;
  const showGroupInfo = !disabled;
  const isHidden = group.visibility === "hidden";

  return (
    <main style={pageWrap}>
      <style jsx>{`
        .invite-shell {
          width: 100%;
        }

        .invite-card {
          overflow: hidden;
        }

        .invite-content {
          position: relative;
          padding: 0 18px 20px;
        }

        .invite-header-copy {
          padding-top: 92px;
          position: relative;
          z-index: 1;
          min-height: 110px;
        }

        .invite-meta {
          display: grid;
          place-items: center;
          text-align: center;
        }

        .invite-description {
          margin-top: 8px;
          max-width: 620px;
          padding: 0 14px;
          word-break: break-word;
          overflow-wrap: anywhere;
        }

        .invite-actions-wrap {
          margin-top: 18px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          padding-top: 14px;
          display: grid;
          gap: 12px;
        }

        .invite-actions-row {
          display: flex;
          justify-content: center;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .cta-card {
          max-width: 640px;
          margin: 0 auto;
        }

        @media (min-width: 700px) {
          .invite-header-copy {
            padding-top: 126px;
          }
        }

        @media (min-width: 1024px) {
          .invite-header-copy {
            padding-top: 150px;
          }
        }

        @media (max-width: 900px) {
          .invite-shell {
            max-width: none;
          }
        }

        @media (max-width: 640px) {
          .invite-content {
            padding: 0 12px 18px;
          }

          .invite-actions-row > button {
            width: 100%;
          }
        }
      `}</style>

      <div style={container} className="invite-shell">
        <section className="invite-card" style={cardStyle}>
          <div
            style={{
              position: "relative",
              height: ui.coverHeight,
              background: "#0b0b0b",
            }}
          >
            <img
              src={coverBg}
              alt="cover"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: 0.96,
                filter: showGroupInfo ? "none" : "blur(14px)",
                transform: showGroupInfo ? "none" : "scale(1.06)",
              }}
            />

            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.52) 58%, rgba(0,0,0,0.88) 100%)",
              }}
            />
          </div>

          <div className="invite-content">
            {showGroupInfo && (
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: ui.avatarOffsetTop,
                  transform: "translateX(-50%)",
                  zIndex: 20,
                }}
              >
                <div
                  style={{
                    width: ui.avatarSize,
                    height: ui.avatarSize,
                    borderRadius: "50%",
                    overflow: "hidden",
                    border: "4px solid rgba(0,0,0,0.96)",
                    boxShadow: ui.shadow,
                    display: "grid",
                    placeItems: "center",
                    background: "#0c0c0c",
                  }}
                >
                  {group.avatarUrl ? (
                    <img
                      src={group.avatarUrl}
                      alt="avatar"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: "clamp(24px, 5vw, 34px)",
                        fontWeight: 600,
                        color: "rgba(255,255,255,0.88)",
                        fontFamily: fontStack,
                      }}
                    >
                      {(group.name ?? "G").trim().slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="invite-header-copy">
              <div className="invite-meta">
                <h1 style={titleStyle}>
                  {showGroupInfo ? group.name ?? "" : "Enlace no disponible"}
                </h1>

                {showGroupInfo && !!group.description && (
                  <div className="invite-description" style={textStyle}>
                    {group.description}
                  </div>
                )}

                <div style={{ marginTop: 8, ...microText }}>
                  {showGroupInfo
                    ? visibilityLabel(group.visibility)
                    : "Este enlace ya no es válido."}
                </div>
              </div>
            </div>

            <div className="invite-actions-wrap">
              <div style={{ ...panelStyle }} className="cta-card">
                <div
                  style={{
                    ...microText,
                    color: "rgba(255,255,255,0.82)",
                    textAlign: "center",
                  }}
                >
                  {!showGroupInfo && "Este enlace expiró, fue revocado o ya no está disponible."}
                  {showGroupInfo &&
                    !error &&
                    (isHidden
                      ? "Esta invitación te permitirá entrar directamente a la comunidad."
                      : "Esta invitación te permitirá solicitar acceso a la comunidad.")}
                </div>

                {error && (
                  <div style={{ ...messageBox, marginTop: 12 }}>
                    {error}
                  </div>
                )}

                <div className="invite-actions-row" style={{ marginTop: 14 }}>
                  {!showGroupInfo ? (
                    <button
                      type="button"
                      onClick={() => router.push("/")}
                      style={secondaryButton}
                    >
                      Volver
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={handleJoin}
                        disabled={consuming}
                        style={{
                          ...primaryButton,
                          opacity: consuming ? 0.75 : 1,
                          cursor: consuming ? "not-allowed" : "pointer",
                        }}
                      >
                        {consuming ? "Procesando..." : "Entrar a la comunidad"}
                      </button>

                      {!user && (
                        <button
                          type="button"
                          onClick={() => router.push(`/login?next=/invite/${token}`)}
                          style={secondaryButton}
                        >
                          Iniciar sesión
                        </button>
                      )}
                    </>
                  )}
                </div>

                {showGroupInfo && invite.expiresAt && (
                  <div
                    style={{
                      marginTop: 12,
                      ...microText,
                      textAlign: "center",
                    }}
                  >
                    Vigente hasta:{" "}
                    {new Date(invite.expiresAt).toLocaleString("es-MX")}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}