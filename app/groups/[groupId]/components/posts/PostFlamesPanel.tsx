"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type PostFlameUser = {
  userId: string;
  displayName: string;
  username?: string | null;
  avatarUrl?: string | null;
};

type PostFlamesPanelProps = {
  open: boolean;
  loading?: boolean;
  error?: string | null;
  users: PostFlameUser[];
  onClose: () => void;
};

const fontStack =
  'inherit';

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

function getProfileHref(user: PostFlameUser) {
  return user.username ? `/u/${user.username}` : `/u/${user.userId}`;
}

function FlameAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl?: string | null;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={38} height={38}
        style={{
          borderRadius: "50%",
          objectFit: "cover",
          display: "block",
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.04)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        width: 38,
        height: 38,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.08)",
        color: "#fff",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        flexShrink: 0,
      }}
    >
      {getInitials(name)}
    </div>
  );
}

export default function PostFlamesPanel({
  open,
  loading = false,
  error = null,
  users,
  onClose,
}: PostFlamesPanelProps) {
  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 640px)").matches;
  }, []);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const backdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    background: "rgba(0,0,0,0.64)",
    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",
    padding: isMobile ? 0 : 16,
    boxSizing: "border-box",
  };

  const panelStyle: CSSProperties = {
    width: isMobile ? "100%" : "min(420px, calc(100vw - 32px))",
    maxHeight: isMobile ? "78vh" : "min(560px, calc(100vh - 48px))",
    borderRadius: isMobile ? "18px 18px 0 0" : 18,
    border: isMobile ? "1px solid rgba(255,255,255,0.10)" : "1px solid rgba(255,255,255,0.12)",
    borderBottom: isMobile ? "none" : "1px solid rgba(255,255,255,0.12)",
    background: "rgba(10,10,10,0.98)",
    boxShadow: isMobile
      ? "0 -18px 50px rgba(0,0,0,0.46)"
      : "0 24px 80px rgba(0,0,0,0.56)",
    backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
    color: "#fff",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    overflow: "hidden",
    fontFamily: fontStack,
  };

  const headerStyle: CSSProperties = {
    minHeight: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 16px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    boxSizing: "border-box",
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
  };

  const closeButtonStyle: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 999,
    border: "none",
    background: "rgba(255,255,255,0.07)",
    color: "#fff",
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
    fontSize: 18,
    lineHeight: 1,
    padding: 0,
    flexShrink: 0,
    WebkitTapHighlightColor: "transparent",
  };

  const contentStyle: CSSProperties = {
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    padding: 8,
    display: "grid",
    gap: 2,
  };

  const stateStyle: CSSProperties = {
    padding: "18px 12px",
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    lineHeight: 1.45,
    textAlign: "center",
  };

  const rowStyle: CSSProperties = {
    minHeight: 54,
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 12,
    textDecoration: "none",
    color: "#fff",
    boxSizing: "border-box",
  };

  const nameStyle: CSSProperties = {
    display: "block",
    color: "#fff",
    fontSize: 13,
    fontWeight: 650,
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const usernameStyle: CSSProperties = {
    display: "block",
    marginTop: 3,
    color: "rgba(255,255,255,0.52)",
    fontSize: 11.5,
    fontWeight: 400,
    lineHeight: 1.15,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return createPortal(
    <div
      style={backdropStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Usuarios que dieron flamita"
      onClick={onClose}
    >
      <div style={panelStyle} onClick={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>Flamitas</h3>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={closeButtonStyle}
          >
            ×
          </button>
        </div>

        <div style={contentStyle}>
          {loading && <div style={stateStyle}>Cargando usuarios...</div>}

          {!loading && error && <div style={stateStyle}>{error}</div>}

          {!loading && !error && users.length === 0 && (
            <div style={stateStyle}>Todavía no hay flamitas.</div>
          )}

          {!loading &&
            !error &&
            users.map((user) => (
              <Link key={user.userId} href={getProfileHref(user)} style={rowStyle}>
                <FlameAvatar
                  name={user.displayName}
                  avatarUrl={user.avatarUrl}
                />

                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={nameStyle}>{user.displayName}</span>
                  {user.username && (
                    <span style={usernameStyle}>@{user.username}</span>
                  )}
                </div>
              </Link>
            ))}
        </div>
      </div>
    </div>,
    document.body
  );
}