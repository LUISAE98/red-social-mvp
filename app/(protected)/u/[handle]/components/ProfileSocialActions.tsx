"use client";

import { useEffect, useRef, useState } from "react";

import { useSocialRelationship } from "@/lib/social/useSocialRelationship";

type ProfileSocialActionsProps = {
  viewerUid: string | null | undefined;
  profileUid: string;
  profileRestricted: boolean;
};

export default function ProfileSocialActions({
  viewerUid,
  profileUid,
  profileRestricted,
}: ProfileSocialActionsProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const isOwnProfile = !!viewerUid && viewerUid === profileUid;

  const {
    relationship,
    loading,
    error,
    follow,
    unfollow,
    block,
    unblock,
  } = useSocialRelationship(viewerUid, profileUid);

  useEffect(() => {
    if (!menuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (!menuRef.current) return;

      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  if (!viewerUid || isOwnProfile) return null;

  if (relationship.isBlockedBy) return null;

  const showFollowButton =
    !profileRestricted &&
    !relationship.hasBlocked &&
    relationship.canFollow;

  async function handleFollowClick() {
    if (loading) return;

    if (relationship.isFollowing) {
      await unfollow();
      return;
    }

    await follow();
  }

  async function handleBlockClick() {
    if (loading) return;

    const confirmed = window.confirm(
      "¿Seguro que quieres bloquear a este usuario?"
    );

    if (!confirmed) return;

    setMenuOpen(false);
    await block();
  }

  async function handleUnblockClick() {
    if (loading) return;

    setMenuOpen(false);
    await unblock();
  }

  return (
    <div style={styles.root}>
      <div style={styles.actionsRow}>
        {showFollowButton && (
          <button
            type="button"
            onClick={handleFollowClick}
            disabled={loading}
            style={{
              ...styles.followButton,
              ...(relationship.isFollowing
                ? styles.followingButton
                : styles.primaryFollowButton),
              opacity: loading ? 0.65 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading
              ? "Procesando..."
              : relationship.isFollowing
                ? "Siguiendo"
                : "Seguir"}
          </button>
        )}

        <div ref={menuRef} style={styles.menuWrap}>
          <button
            type="button"
            aria-label="Opciones del perfil"
            title="Opciones"
            onClick={() => setMenuOpen((current) => !current)}
            disabled={loading}
            style={{
              ...styles.moreButton,
              opacity: loading ? 0.65 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            ⋯
          </button>

          {menuOpen && (
            <div style={styles.menu}>
              {relationship.hasBlocked ? (
                <button
                  type="button"
                  onClick={handleUnblockClick}
                  disabled={loading}
                  style={styles.menuItem}
                >
                  Desbloquear usuario
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBlockClick}
                  disabled={loading}
                  style={{
                    ...styles.menuItem,
                    ...styles.dangerMenuItem,
                  }}
                >
                  Bloquear usuario
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles = {
  root: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  } as const,

  actionsRow: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flexWrap: "nowrap",
  } as const,

  followButton: {
    minHeight: 34,
    borderRadius: 999,
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 800,
    border: "1px solid rgba(255,255,255,0.12)",
    transition: "opacity 160ms ease, transform 160ms ease",
  } as const,

  primaryFollowButton: {
    color: "#fff",
    background:
      "linear-gradient(135deg, rgba(168,85,247,0.98), rgba(126,34,206,0.94))",
    boxShadow:
      "0 10px 22px rgba(126,34,206,0.24), inset 0 1px 0 rgba(255,255,255,0.18)",
  } as const,

  followingButton: {
    color: "rgba(255,255,255,0.9)",
    background: "rgba(255,255,255,0.07)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
  } as const,

  menuWrap: {
    position: "relative",
    display: "inline-flex",
  } as const,

  moreButton: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.9)",
    background:
      "linear-gradient(135deg, rgb(3,3,6) 0%, rgb(8,5,13) 48%, rgb(0,0,0) 100%)",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.04), inset 0 0 14px rgba(168,85,255,0.1), 0 10px 20px rgba(0,0,0,0.35)",
    fontSize: 22,
    fontWeight: 900,
    lineHeight: "20px",
    padding: "0 0 6px",
  } as const,

  menu: {
    position: "absolute",
    top: 40,
    right: 0,
    zIndex: 80,
    minWidth: 190,
    padding: 6,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(10,10,14,0.96)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    boxShadow: "0 18px 38px rgba(0,0,0,0.45)",
  } as const,

  menuItem: {
    width: "100%",
    minHeight: 38,
    border: "none",
    borderRadius: 12,
    padding: "9px 11px",
    color: "rgba(255,255,255,0.9)",
    background: "transparent",
    fontSize: 13,
    fontWeight: 700,
    textAlign: "left",
    cursor: "pointer",
  } as const,

  dangerMenuItem: {
    color: "rgba(255,165,165,0.98)",
  } as const,

  error: {
    width: "100%",
    textAlign: "center",
    color: "rgba(255,150,150,0.95)",
    fontSize: 12,
    marginTop: 2,
  } as const,
};