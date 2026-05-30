"use client";

import { useEffect, useState } from "react";

import { getProfileFollowers } from "@/lib/social/social-service";
import type { ProfileFollowerListItem } from "@/types/social";

type ProfileFollowersOverlayProps = {
  open: boolean;
  currentUserId: string | null;
  profileUserId: string;
  onClose: () => void;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

export default function ProfileFollowersOverlay({
  open,
  currentUserId,
  profileUserId,
  onClose,
}: ProfileFollowersOverlayProps) {
  const [followers, setFollowers] = useState<ProfileFollowerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canViewFollowers = !!currentUserId && currentUserId === profileUserId;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadFollowers() {
      setLoading(true);
      setError(null);

      try {
        const result = await getProfileFollowers({
          currentUserId,
          profileUserId,
          limitCount: 50,
        });

        if (!cancelled) {
          setFollowers(result);
        }
      } catch (e: any) {
        if (!cancelled) {
          setFollowers([]);
          setError(e?.message ?? "No se pudo cargar la lista de seguidores.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadFollowers();

    return () => {
      cancelled = true;
    };
  }, [open, currentUserId, profileUserId]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Seguidores"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.72)",
        display: "grid",
        placeItems: "center",
        padding: 14,
      }}
    >
      <section
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(520px, calc(100vw - 28px))",
          maxHeight: "calc(100dvh - 28px)",
          overflow: "hidden",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.14)",
          background:
            "linear-gradient(180deg, rgba(18,18,18,0.98), rgba(8,8,8,0.98))",
          boxShadow: "0 24px 80px rgba(0,0,0,0.72)",
          color: "#fff",
        }}
      >
        <header
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 700,
                lineHeight: 1.2,
              }}
            >
              Seguidores
            </h2>

            <p
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: "rgba(255,255,255,0.62)",
                lineHeight: 1.35,
              }}
            >
              Solo tú puedes ver esta lista.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
            aria-label="Cerrar seguidores"
            title="Cerrar"
          >
            ×
          </button>
        </header>

        <div
          style={{
            padding: 14,
            maxHeight: "min(520px, calc(100dvh - 116px))",
            overflowY: "auto",
          }}
        >
          {!canViewFollowers ? (
            <div style={emptyStyle}>No puedes ver los seguidores de este perfil.</div>
          ) : loading ? (
            <div style={emptyStyle}>Cargando seguidores...</div>
          ) : error ? (
            <div style={emptyStyle}>{error}</div>
          ) : followers.length === 0 ? (
            <div style={emptyStyle}>Todavía no tienes seguidores.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {followers.map((follower) => (
                <a
                  key={follower.uid}
                  href={follower.handle ? `/u/${follower.handle}` : "#"}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 10,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#fff",
                    textDecoration: "none",
                  }}
                  onClick={(event) => {
                    if (!follower.handle) {
                      event.preventDefault();
                    }
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: "50%",
                      overflow: "hidden",
                      background: "rgba(255,255,255,0.08)",
                      display: "grid",
                      placeItems: "center",
                      flex: "0 0 auto",
                    }}
                  >
                    {follower.avatarUrl ? (
                      <img
                        src={follower.avatarUrl}
                        alt=""
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "rgba(255,255,255,0.88)",
                        }}
                      >
                        {initials(follower.displayName)}
                      </span>
                    )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        lineHeight: 1.2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {follower.displayName}
                    </div>

                    {follower.handle ? (
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 12,
                          color: "rgba(255,255,255,0.58)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        @{follower.handle}
                      </div>
                    ) : null}
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const emptyStyle = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.72)",
  padding: 14,
  fontSize: 13,
  lineHeight: 1.4,
  textAlign: "center" as const,
};