"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";

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

const PANEL_CLOSE_THRESHOLD = 130;

export default function ProfileFollowersOverlay({
  open,
  currentUserId,
  profileUserId,
  onClose,
}: ProfileFollowersOverlayProps) {
  const tCommon = useTranslations("common");
  const tProfile = useTranslations("profile");
  const [followers, setFollowers] = useState<ProfileFollowerListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canViewFollowers = !!currentUserId && currentUserId === profileUserId;

  // --- Animation lifecycle ---
  const [shouldRender, setShouldRender] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const shouldRenderRef = useRef(false);

  // --- Mobile detection ---
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 639px)").matches
      : false
  );
  const isMobileRef = useRef(isMobile);

  // --- Mobile drag ---
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartOffsetRef = useRef(0);

  const closeAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openAnimRafRef = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      isMobileRef.current = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Sync shouldRenderRef
  useEffect(() => {
    shouldRenderRef.current = shouldRender;
  }, [shouldRender]);

  // Watch open prop → drive animation
  useEffect(() => {
    if (open) {
      if (closeAnimTimerRef.current) {
        clearTimeout(closeAnimTimerRef.current);
        closeAnimTimerRef.current = null;
      }
      if (isMobileRef.current) {
        setPanelOffsetY(window.innerHeight);
      }
      setIsClosing(false);
      setShouldRender(true);
    } else if (shouldRenderRef.current) {
      setIsClosing(true);
      if (isMobileRef.current) {
        setPanelOffsetY(window.innerHeight);
      }
      const duration = isMobileRef.current ? 260 : 180;
      closeAnimTimerRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        closeAnimTimerRef.current = null;
      }, duration);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mobile: animate panel in after mount
  useEffect(() => {
    if (!shouldRender || isClosing || !isMobile) return;
    if (openAnimRafRef.current) cancelAnimationFrame(openAnimRafRef.current);
    openAnimRafRef.current = requestAnimationFrame(() => {
      openAnimRafRef.current = requestAnimationFrame(() => {
        setPanelOffsetY(0);
        openAnimRafRef.current = null;
      });
    });
  }, [shouldRender]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (closeAnimTimerRef.current) clearTimeout(closeAnimTimerRef.current);
      if (openAnimRafRef.current) cancelAnimationFrame(openAnimRafRef.current);
    };
  }, []);

  // Bloquear scroll del body mientras el panel está abierto
  useEffect(() => {
    if (!shouldRender) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [shouldRender]);

  // Load followers
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
        if (!cancelled) setFollowers(result);
      } catch (e: unknown) {
        if (!cancelled) {
          setFollowers([]);
          setError(
            (e instanceof Error ? e.message : null) ??
              tProfile("followersLoadError")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFollowers();
    return () => { cancelled = true; };
  }, [open, currentUserId, profileUserId]);

  // Mobile drag handlers
  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // No capturar si el usuario toca un botón
    if ((e.target as HTMLElement).closest("button")) return;
    dragStartYRef.current = e.clientY;
    dragStartOffsetRef.current = panelOffsetY;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isDragging) return;
    const delta = e.clientY - dragStartYRef.current;
    const raw = dragStartOffsetRef.current + delta;
    // Hacia arriba: resistencia (divide entre 4), hacia abajo: libre
    setPanelOffsetY(raw < 0 ? raw / 4 : raw);
  }

  function handlePointerUp() {
    if (!isDragging) return;
    setIsDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      onClose();
    } else {
      setPanelOffsetY(0); // regresa al reposo con la transición spring
    }
  }

  if (!shouldRender || typeof document === "undefined") return null;

  const titleEl = (
    <h2
      style={{
        margin: 0,
        fontSize: 17,
        fontWeight: 500,
        lineHeight: 1.2,
        textAlign: "center",
        letterSpacing: "-0.02em",
      }}
    >
      {tProfile("followersTitle")}
    </h2>
  );

  const listEl = (
    <>
      {!canViewFollowers ? (
        <div style={emptyStyle}>{tProfile("cannotViewFollowers")}</div>
      ) : loading ? (
        <div style={emptyStyle}>{tProfile("loadingFollowers")}</div>
      ) : error ? (
        <div style={emptyStyle}>{error}</div>
      ) : followers.length === 0 ? (
        <div style={emptyStyle}>{tProfile("noFollowers")}</div>
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
                color: "#fff",
                textDecoration: "none",
              }}
              onClick={(e) => { if (!follower.handle) e.preventDefault(); }}
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
                  <Image
                    src={follower.avatarUrl}
                    alt=""
                    width={42}
                    height={42}
                    style={{ objectFit: "cover" }}
                  />
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.88)" }}>
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
    </>
  );

  return createPortal(
    <>
      <style>{`
        @keyframes vbFollowersIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @keyframes vbFollowersOut {
          from { opacity: 1; transform: scale(1)    translateY(0);    }
          to   { opacity: 0; transform: scale(0.94) translateY(10px); }
        }
        @keyframes vbFollowersBdIn  { from { opacity: 0; } to { opacity: 1; } }
        @keyframes vbFollowersBdOut { from { opacity: 1; } to { opacity: 0; } }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 99980,
          background: "rgba(0,0,0,0.52)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          animation: isClosing
            ? "vbFollowersBdOut 0.18s ease forwards"
            : "vbFollowersBdIn 0.18s ease",
        }}
      />

      {isMobile ? (
        /* ── Mobile: pestaña deslizable desde abajo ── */
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 99981,
            maxHeight: "calc(100vh - 72px)",
            borderRadius: "22px 22px 0 0",
            border: "1px solid transparent",
            background: "rgba(8,9,11,0.96)",
            boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
            color: "#fff",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            transform: `translateY(${panelOffsetY}px)`,
            transition: isDragging
              ? "none"
              : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        >
          {/* Zona de arrastre unificada: pill + header */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: "none", userSelect: "none", flexShrink: 0 }}
          >
            {/* Pill visual */}
            <div style={{ padding: "12px 0 4px", cursor: "grab" }}>
              <div
                style={{
                  width: 38,
                  height: 4,
                  borderRadius: 2,
                  background: "rgba(255,255,255,0.18)",
                  margin: "0 auto",
                }}
              />
            </div>

            {/* Header */}
            <div
              style={{
                height: 56,
                display: "grid",
                gridTemplateColumns: "48px 1fr 48px",
                alignItems: "center",
                padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: "none",
                    border: "none",
                    color: "rgba(255,255,255,0.86)",
                    cursor: "pointer",
                    fontSize: 32,
                    fontWeight: 300,
                    lineHeight: 1,
                    padding: 0,
                  }}
                  aria-label={tCommon("closeAriaLabel")}
                >
                  ×
                </button>
              </div>
              {titleEl}
              <div />
            </div>
          </div>

          <div style={{ padding: "14px 14px calc(14px + env(safe-area-inset-bottom))", overflowY: "auto", flex: 1, minHeight: 0 }}>
            {listEl}
          </div>
        </div>
      ) : (
        /* ── Desktop: panel centrado con animación scale ── */
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99981,
            display: "grid",
            placeItems: "center",
            paddingTop: "max(14px, env(safe-area-inset-top, 0px))",
            paddingBottom: 14,
            paddingLeft: 14,
            paddingRight: 14,
            pointerEvents: "none",
          }}
        >
          <section
            onClick={(e) => e.stopPropagation()}
            style={{
              pointerEvents: "auto",
              width: "min(520px, calc(100vw - 28px))",
              maxHeight: "calc(100dvh - 28px)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(8,9,11,0.985)",
              boxShadow:
                "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
              color: "#fff",
              animation: isClosing
                ? "vbFollowersOut 0.18s ease-in forwards"
                : "vbFollowersIn 0.18s ease-out",
            }}
          >
            <header
              style={{
                height: 56,
                display: "grid",
                gridTemplateColumns: "48px 1fr 48px",
                alignItems: "center",
                padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                flexShrink: 0,
              }}
            >
              <div />
              {titleEl}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: "none",
                    border: "none",
                    color: "rgba(255,255,255,0.86)",
                    cursor: "pointer",
                    fontSize: 32,
                    fontWeight: 300,
                    lineHeight: 1,
                    padding: 0,
                  }}
                  aria-label={tCommon("closeAriaLabel")}
                >
                  ×
                </button>
              </div>
            </header>

            <div style={{ padding: 14, maxHeight: 450, overflowY: "auto" }}>
              {listEl}
            </div>
          </section>
        </div>
      )}
    </>,
    document.body
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
