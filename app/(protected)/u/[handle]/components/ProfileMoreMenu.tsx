"use client";

import { useEffect, useRef, useState } from "react";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";

type Props = {
  viewerUid: string | null | undefined;
  profileUid: string;
  onUnblockSuccess?: () => void;
  onUnblockError?: () => void;
};

export default function ProfileMoreMenu({ viewerUid, profileUid, onUnblockSuccess, onUnblockError }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const isOwnProfile = !!viewerUid && viewerUid === profileUid;

  const { relationship, loading, block, unblock } = useSocialRelationship(
    viewerUid,
    profileUid
  );

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  if (!viewerUid || isOwnProfile || relationship.isBlockedBy) return null;

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
    const success = await unblock();
    if (success) {
      onUnblockSuccess?.();
    } else {
      onUnblockError?.();
    }
  }

  return (
    <div ref={menuRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        aria-label="Opciones del perfil"
        title="Opciones"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={loading}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: "rgba(255,255,255,0.75)",
          fontSize: 20,
          fontWeight: 900,
          lineHeight: 1,
          opacity: loading ? 0.65 : 1,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        ⋮
      </button>

      {menuOpen && (
        <div
          style={{
            position: "absolute",
            top: 40,
            right: 0,
            zIndex: 80,
            minWidth: 190,
            padding: 6,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(10,10,14,0.96)",
            backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
            boxShadow: "0 18px 38px rgba(0,0,0,0.45)",
          }}
        >
          {relationship.hasBlocked ? (
            <button
              type="button"
              onClick={handleUnblockClick}
              disabled={loading}
              style={{
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
              }}
            >
              Desbloquear usuario
            </button>
          ) : (
            <button
              type="button"
              onClick={handleBlockClick}
              disabled={loading}
              style={{
                width: "100%",
                minHeight: 38,
                border: "none",
                borderRadius: 12,
                padding: "9px 11px",
                color: "rgba(255,165,165,0.98)",
                background: "transparent",
                fontSize: 13,
                fontWeight: 700,
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              Bloquear usuario
            </button>
          )}
        </div>
      )}
    </div>
  );
}
