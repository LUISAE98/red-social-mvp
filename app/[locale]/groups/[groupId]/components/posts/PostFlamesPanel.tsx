"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { useTranslations } from "next-intl";
import ListSkeleton from "@/components/ui/ListSkeleton";

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

const DRAG_CLOSE_THRESHOLD = 130;

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "U";
  return parts.map((p) => p.charAt(0).toUpperCase()).join("");
}

function getProfileHref(user: PostFlameUser) {
  return user.username ? `/u/${user.username}` : `/u/${user.userId}`;
}

function FlameAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={name}
        width={42}
        height={42}
        style={{ borderRadius: "50%", objectFit: "cover", display: "block", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        width: 42, height: 42, borderRadius: "50%",
        display: "grid", placeItems: "center",
        background: "rgba(255,255,255,0.08)",
        color: "#fff", fontSize: 13, fontWeight: 700,
        letterSpacing: "-0.02em", flexShrink: 0,
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
  const tCommon = useTranslations("common");
  const tPosts = useTranslations("posts");
  const { toast: flameToast, showToast: showFlameToast } = useVibraToast();
  useEffect(() => { if (error) showFlameToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  // mounted gate — prevents portal on server
  const [mounted, setMounted] = useState(false);
  // closing animation state
  const [closing, setClosing] = useState(false);
  // visible = actually in the DOM (open OR still animating out)
  const [visible, setVisible] = useState(false);

  // Detect mobile on the CLIENT only (effect, not SSR state)
  const [isMobile, setIsMobile] = useState(false);

  // Drag state (mobile)
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);

  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRafRef = useRef<number | null>(null);

  // Mount + mobile detection
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Drive visible / closing from open prop
  useEffect(() => {
    if (!mounted) return;

    if (open) {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClosing(false);
      setVisible(true);
      // Mobile: start off-screen, then slide in
      if (window.matchMedia("(max-width: 639px)").matches) {
        setPanelOffsetY(window.innerHeight);
        if (openRafRef.current) cancelAnimationFrame(openRafRef.current);
        openRafRef.current = requestAnimationFrame(() => {
          openRafRef.current = requestAnimationFrame(() => {
            setPanelOffsetY(0);
            openRafRef.current = null;
          });
        });
      }
    } else if (visible) {
      setClosing(true);
      if (isMobile) setPanelOffsetY(window.innerHeight);
      const dur = isMobile ? 260 : 180;
      closeTimerRef.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
        setPanelOffsetY(0);
        closeTimerRef.current = null;
      }, dur);
    }
  }, [open, mounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Block body scroll while open
  useBodyScrollLock(visible);

  // Escape key
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (openRafRef.current) cancelAnimationFrame(openRafRef.current);
    };
  }, []);

  // Drag handlers (mobile)
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button, a")) return;
    dragStartYRef.current = e.clientY;
    dragStartOffsetRef.current = panelOffsetY;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) return;
    const delta = e.clientY - dragStartYRef.current;
    const raw = dragStartOffsetRef.current + delta;
    setPanelOffsetY(raw < 0 ? raw / 4 : raw);
  }
  function handlePointerUp() {
    if (!isDragging) return;
    setIsDragging(false);
    if (panelOffsetY >= DRAG_CLOSE_THRESHOLD) {
      onClose();
    } else {
      setPanelOffsetY(0);
    }
  }

  if (!mounted || !visible) return null;

  const titleEl = (
    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 500, lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
      {tPosts("flamesTitle")}
    </h2>
  );

  const closeBtn = (
    <button
      type="button"
      onClick={onClose}
      aria-label={tCommon("closeAriaLabel")}
      style={{ background: "none", border: "none", color: "rgba(255,255,255,0.86)", cursor: "pointer", fontSize: 32, fontWeight: 300, lineHeight: 1, padding: 0 }}
    >
      ×
    </button>
  );

  const bodyEl = (
    <div style={{ padding: "8px 14px calc(16px + var(--vb-safe-bottom, 0px))", overflowY: "auto", flex: 1, minHeight: 0 }}>
      {loading && <ListSkeleton rows={6} avatarSize={42} padding="0" />}

      <VibraToast toast={flameToast} />

      {!loading && !error && users.length === 0 && (
        <div style={emptyCardStyle}>
          <span style={{ fontSize: 28, lineHeight: 1 }}>🔥</span>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#fff" }}>
            {tPosts("beFirstFlame")}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,255,255,0.52)", lineHeight: 1.4 }}>
            {tPosts("noFlamesYet")}
          </p>
        </div>
      )}

      {!loading && !error && users.map((user) => (
        <Link
          key={user.userId}
          href={getProfileHref(user)}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 4px", color: "#fff", textDecoration: "none",
          }}
        >
          <FlameAvatar name={user.displayName} avatarUrl={user.avatarUrl} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.displayName}
            </div>
            {user.username && (
              <div style={{ marginTop: 3, fontSize: 12, color: "rgba(255,255,255,0.52)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                @{user.username}
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );

  return createPortal(
    <>
      <style>{`
        @keyframes vbFBdIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes vbFBdOut { from { opacity: 1; } to { opacity: 0; } }
        @keyframes vbFPanelIn  { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes vbFPanelOut { from { opacity: 1; transform: scale(1) translateY(0); } to { opacity: 0; transform: scale(0.94) translateY(10px); } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 2147483640,
          background: "rgba(0,0,0,0.52)",
          backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
          animation: closing ? "vbFBdOut 0.26s ease forwards" : "vbFBdIn 0.18s ease",
        }}
      />

      {isMobile ? (
        /* ── Mobile: pestaña deslizable ── */
        <>
        {/* Piso: mismo z-index que el backdrop pero aparece después en el DOM → queda encima
            del backdrop en la brecha, pero el panel (z+1) siempre lo cubre cuando está en posición */}
        <div
          aria-hidden
          style={{
            position: "fixed", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0,
            height: 120,
            background: "rgba(8,9,11,0.96)",
            zIndex: 2147483640,
            pointerEvents: "none",
            transform: `translateY(${Math.max(0, panelOffsetY)}px)`,
            transition: isDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
        <div
          style={{
            position: "fixed", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0,
            zIndex: 2147483641,
            maxHeight: "calc(100dvh - 72px)",
            borderRadius: "22px 22px 0 0",
            border: "1px solid transparent",
            background: "rgba(8,9,11,0.96)",
            boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
            color: "#fff", overflow: "hidden",
            display: "flex", flexDirection: "column",
            transform: `translateY(${panelOffsetY}px)`,
            transition: isDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        >
          {/* Drag zone: pill + header */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: "none", userSelect: "none", flexShrink: 0 }}
          >
            <div style={{ padding: "12px 0 4px", cursor: "grab" }}>
              <div style={{ width: 38, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.18)", margin: "0 auto" }} />
            </div>
            <div style={{ height: 56, display: "grid", gridTemplateColumns: "48px 1fr 48px", alignItems: "center", padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div />
              {titleEl}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{closeBtn}</div>
            </div>
          </div>
          {bodyEl}
        </div>
        </>
      ) : (
        /* ── Desktop: panel centrado con animación scale ── */
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 2147483641,
            display: "grid", placeItems: "center",
            padding: 14, pointerEvents: "none",
          }}
        >
          <section
            onClick={(e) => e.stopPropagation()}
            style={{
              pointerEvents: "auto",
              width: "min(520px, calc(100vw - 28px))",
              maxHeight: "calc(100dvh - 28px)",
              overflow: "hidden",
              display: "flex", flexDirection: "column",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(8,9,11,0.985)",
              boxShadow: "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
              color: "#fff",
              animation: closing ? "vbFPanelOut 0.18s ease-in forwards" : "vbFPanelIn 0.18s ease-out",
            }}
          >
            <header style={{ height: 56, display: "grid", gridTemplateColumns: "48px 1fr 48px", alignItems: "center", padding: "0 12px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
              <div />
              {titleEl}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>{closeBtn}</div>
            </header>
            {bodyEl}
          </section>
        </div>
      )}
    </>,
    document.body
  );
}

const emptyCardStyle: CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center",
  gap: 10, padding: "32px 20px", textAlign: "center",
};
