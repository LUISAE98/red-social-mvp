"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type DonationInfo = {
  mode?: "general" | "wedding" | "none" | null;
  playbackId?: string | null;
  videoUrl?: string | null;
  suggestedAmounts?: number[] | null;
  currency?: string | null;
  goalLabel?: string | null;
} | null;

type Props = {
  open: boolean;
  donation: DonationInfo;
  profileName?: string | null;
  onClose: () => void;
  onDonate: () => void;
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

export default function DonationViewer({ open, donation, profileName, onClose, onDonate }: Props) {
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [muted, setMuted] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("vibra_stories_muted") === "1"
  );
  const [dragY, setDragY] = useState(0);
  const [progress, setProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    function check() { setIsDesktop(window.innerWidth >= 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setDragY(0);
      setProgress(0);
      return;
    }
    const el = videoRef.current;
    if (el) {
      el.muted = muted;
      el.play().catch(() => {});
    }
  }, [open, muted]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Progress bar via rAF
  useEffect(() => {
    if (!open) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tick = () => {
      const v = videoRef.current;
      if (v && v.duration > 0) setProgress(v.currentTime / v.duration);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [open]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const dy = (e.touches[0]?.clientY ?? touchStartYRef.current) - touchStartYRef.current;
    if (dy > 0) setDragY(dy);
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    const endY = e.changedTouches[0]?.clientY ?? startY ?? 0;
    const dy = endY - (startY ?? endY);
    if (dy > 80) {
      setDragY(0);
      onClose();
      return;
    }
    setDragY(0);
  }, [onClose]);

  if (!mounted || !open) return null;

  const hlsUrl = donation?.playbackId
    ? `https://stream.mux.com/${donation.playbackId}.m3u8`
    : (typeof donation?.videoUrl === "string" && donation.videoUrl.startsWith("https://")
      ? donation.videoUrl
      : null);

  const isVideoProcessing =
    !donation?.playbackId &&
    typeof donation?.videoUrl === "string" &&
    donation.videoUrl.startsWith("mux://");

  const minAmount = Array.isArray(donation?.suggestedAmounts) && donation.suggestedAmounts.length > 0
    ? donation.suggestedAmounts[0]
    : null;

  const currency = donation?.currency ?? "MXN";

  const donateLabel =
    donation?.mode === "wedding"
      ? (donation?.goalLabel?.trim() || "Sumarte a nuestro gran día 💍")
      : "Donar";

  // ── Mute SVG (same as StoryViewer) ───────────────────────────────────────────
  const muteBtn = (
    <button
      type="button"
      aria-label={muted ? "Activar sonido" : "Silenciar"}
      onClick={(e) => {
        e.stopPropagation();
        setMuted((m) => {
          const next = !m;
          localStorage.setItem("vibra_stories_muted", next ? "1" : "0");
          return next;
        });
      }}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "rgba(255,255,255,0.9)", padding: "0 5px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {muted ? (
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      ) : (
        <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      )}
    </button>
  );

  // ── Close SVG ─────────────────────────────────────────────────────────────────
  const closeBtn = (
    <button
      type="button"
      aria-label="Cerrar"
      onClick={onClose}
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: "rgba(255,255,255,0.9)", padding: "0 5px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  );

  // ── Desktop layout ────────────────────────────────────────────────────────────
  if (isDesktop) {
    return createPortal(
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 9999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.80)", padding: 16, fontFamily: FONT,
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            display: "flex",
            width: "min(900px, 95vw)",
            maxHeight: "90vh",
            borderRadius: 20,
            overflow: "hidden",
            background: "#111",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 32px 80px rgba(0,0,0,0.6)",
          }}
        >
          {/* Video panel */}
          <div style={{ flex: "0 0 55%", background: "#000", position: "relative", minHeight: 400 }}>
            {hlsUrl ? (
              <video
                ref={videoRef}
                src={hlsUrl}
                autoPlay
                playsInline
                controls
                muted={muted}
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            ) : (
              <div style={{
                width: "100%", height: "100%", display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.3)", fontSize: 14, textAlign: "center", padding: 24,
              }}>
                {isVideoProcessing ? "⏳ Video procesando…" : "Sin video de presentación"}
              </div>
            )}
          </div>

          {/* Payment panel */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            padding: "28px 24px", gap: 20, overflowY: "auto",
          }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                alignSelf: "flex-end", background: "none", border: "none",
                color: "rgba(255,255,255,0.5)", fontSize: 24, cursor: "pointer",
                padding: 0, lineHeight: 1,
              }}
            >×</button>

            <div>
              <h2 style={{ margin: 0, color: "#fff", fontSize: 22, fontWeight: 800 }}>
                {donation?.mode === "wedding" ? "💍 Apoyo para boda" : "🎁 Enviar apoyo"}
              </h2>
              {profileName && (
                <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.5)", fontSize: 14 }}>
                  a {profileName}
                </p>
              )}
            </div>

            {minAmount && (
              <div style={{
                padding: "14px 16px", borderRadius: 14,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginBottom: 4 }}>
                  Apoyo mínimo
                </div>
                <div style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>
                  {minAmount} {currency}
                </div>
              </div>
            )}

            <div style={{
              flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              gap: 16, padding: "20px 0",
            }}>
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, textAlign: "center", lineHeight: 1.5 }}>
                Panel de pago disponible próximamente
              </div>
              <button
                type="button"
                onClick={onDonate}
                style={{
                  width: "100%", padding: "11px 10px", borderRadius: 10,
                  border: "none", background: "#60a5fa", color: "#fff",
                  fontSize: 14, fontWeight: 600, cursor: "pointer",
                  fontFamily: FONT, letterSpacing: "-0.01em",
                  transition: "background 0.15s",
                }}
              >
                {donateLabel}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ── Mobile layout ─────────────────────────────────────────────────────────────
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#000", fontFamily: FONT,
        touchAction: "none", userSelect: "none",
        transform: `translateY(${dragY}px)`,
        transition: dragY > 0 ? "none" : "transform 0.3s ease",
        opacity: 1 - Math.min(1, dragY / 300),
      } as React.CSSProperties}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Video — fills entire screen including safe areas */}
      {hlsUrl ? (
        <video
          ref={videoRef}
          src={hlsUrl}
          autoPlay
          loop
          playsInline
          controls={false}
          muted={muted}
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            objectFit: "contain",
          }}
        />
      ) : (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "rgba(255,255,255,0.3)", fontSize: 14,
        }}>
          {isVideoProcessing ? "⏳ Video procesando…" : "Sin video de presentación"}
        </div>
      )}

      {/* Progress bar — respects safe-area-inset-top */}
      <div style={{
        position: "absolute",
        top: "max(12px, env(safe-area-inset-top))",
        left: 10, right: 10,
        zIndex: 10,
        height: 3, borderRadius: 2,
        background: "rgba(255,255,255,0.3)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%", borderRadius: 2,
          background: "#fff",
          width: `${Math.round(progress * 100)}%`,
          transition: "none",
        }} />
      </div>

      {/* Top-right controls: mute + close */}
      <div style={{
        position: "absolute",
        top: "max(28px, calc(env(safe-area-inset-top) + 16px))",
        right: 10,
        display: "flex", alignItems: "center", gap: 4,
        zIndex: 11,
      }}>
        {muteBtn}
        {closeBtn}
      </div>

      {/* Bottom gradient */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        height: "40%",
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
        pointerEvents: "none",
      }} />

      {/* Bottom: Donar button */}
      <div style={{
        position: "absolute",
        bottom: 0, left: 0, right: 0,
        padding: `0 14px`,
        paddingBottom: "max(8px, env(safe-area-inset-bottom))",
        display: "flex", flexDirection: "column",
        zIndex: 10,
      }}>
        <button
          type="button"
          onTouchStart={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDonate(); }}
          style={{
            width: "100%",
            padding: "11px 10px",
            borderRadius: 10,
            border: "none",
            background: "#60a5fa",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT,
            letterSpacing: "-0.01em",
            transition: "background 0.15s",
          }}
        >
          {donateLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
