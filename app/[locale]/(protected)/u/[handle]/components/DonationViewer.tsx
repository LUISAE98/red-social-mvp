"use client";

import Image from "next/image";
import { AvatarRing, medidaAroEnCaja } from "@/components/ui/AvatarRing";
import { IconButton } from "@/components/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import type HlsType from "hls.js";
import { getMutePreference, setMutePreference } from "@/lib/utils/mutePreference";

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
  profilePhoto?: string | null;
  profileHandle?: string | null;
  onClose: () => void;
  onDonate: () => void;
};

const FONT = "inherit";

function desktopPanelSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 380, height: 675 };
  const h = Math.min(Math.round(window.innerHeight * 0.86), 720);
  return { width: Math.round((h * 9) / 16), height: h };
}


export default function DonationViewer({ open, donation, profileName, profilePhoto, profileHandle, onClose, onDonate }: Props) {
  const tCommon = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [muted, setMuted] = useState(() =>
    typeof window !== "undefined" && getMutePreference()
  );
  const [dragY, setDragY] = useState(0);
  const [progress, setProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const rafRef = useRef<number | null>(null);
  const mutedRef = useRef(muted);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // Keep mutedRef in sync so async HLS callbacks always read the latest value
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const videoSrc = open && donation?.playbackId
    ? `https://stream.mux.com/${donation.playbackId}.m3u8`
    : open && typeof donation?.videoUrl === "string" && donation.videoUrl.startsWith("https://")
      ? donation.videoUrl
      : null;

  useEffect(() => { setMounted(true); }, []);

  // ── HLS lifecycle — runs when videoSrc changes (viewer open/close) ────────────
  useEffect(() => {
    // Cleanup any previous instance first
    hlsRef.current?.destroy();
    hlsRef.current = null;

    const video = videoRef.current;
    if (!videoSrc || !video) return;

    video.muted = mutedRef.current;

    // Safari / iOS — native HLS
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = videoSrc;
      video.load();
      video.play().catch(() => {});
      return () => {
        video.pause();
        video.removeAttribute("src");
        video.load();
      };
    }

    // Chrome / Firefox — hls.js (dynamic import for code splitting)
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !videoRef.current) return;
      const v = videoRef.current;

      if (!Hls.isSupported()) {
        v.src = videoSrc;
        v.load();
        v.play().catch(() => {});
        return;
      }

      const hls = new Hls({ maxBufferLength: 30, maxMaxBufferLength: 60, enableWorker: true });
      hlsRef.current = hls;
      hls.loadSource(videoSrc);
      hls.attachMedia(v);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const vid = videoRef.current;
        if (!vid) return;
        vid.muted = mutedRef.current;
        vid.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break;
            case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break;
            default: hls.destroy(); break;
          }
        }
      });
    });

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.removeAttribute("src");
      }
    };
  }, [videoSrc]);

  // Desktop detection via pointer media query
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  // Body scroll lock
  useBodyScrollLock(open);

  // Reset drag/progress when closed
  useEffect(() => {
    if (!open) {
      setDragY(0);
      setProgress(0);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    }
  }, [open]);

  // Muted sync — when user toggles, update video immediately
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
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchStartYRef.current === null) return;
    const dy = (e.touches[0]?.clientY ?? touchStartYRef.current) - touchStartYRef.current;
    if (dy > 0) setDragY(dy);
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const startX = touchStartXRef.current;
    const startY = touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    const endX = e.changedTouches[0]?.clientX ?? startX ?? 0;
    const endY = e.changedTouches[0]?.clientY ?? startY ?? 0;
    const dx = endX - (startX ?? endX);
    const dy = endY - (startY ?? endY);
    if (dy > 80 && dy > Math.abs(dx)) {
      setDragY(0);
      onClose();
      return;
    }
    setDragY(0);
  }, [onClose]);

  if (!mounted || !open) return null;

  const isVideoProcessing =
    !donation?.playbackId &&
    typeof donation?.videoUrl === "string" &&
    donation.videoUrl.startsWith("mux://");

  const donateLabel =
    donation?.mode === "wedding"
      ? (donation?.goalLabel?.trim() || "Sumarte a nuestro gran día 💍")
      : "Donar";

  // ── Shared: mute button ───────────────────────────────────────────────────────
  const muteBtn = (sz: number) => (
    <IconButton label={muted ? tCommon("unmuteLabel") : tCommon("muteLabel")} size="sm" tone="bare" shape="square" onClick={(e) => { e.stopPropagation(); setMuted((m) => { const next = !m; setMutePreference(next); return next; }); }}>
      {muted ? (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/>
          <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      ) : (
        <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
        </svg>
      )}
    </IconButton>
  );

  // ── Shared: close button ──────────────────────────────────────────────────────
  const closeBtn = (sz: number) => (
    <IconButton label={tCommon("closeAriaLabel")} size="sm" tone="bare" shape="square" onClick={onClose}>
      <svg width={sz} height={sz} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </IconButton>
  );

  // ── Shared panel content ──────────────────────────────────────────────────────
  const renderPanel = (safeTop: string | number, showClose: boolean, safeBottom: string | number, sz: number) => {
    const btnPadBottom = typeof safeBottom === "string" ? `max(8px, ${safeBottom})` : "8px";
    return (
      <>
        {/* Video — src managed imperatively by HLS effect */}
        {videoSrc ? (
          <video
            ref={videoRef}
            loop
            playsInline
            controls={false}
            muted={muted}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", zIndex: 1 }}
          />
        ) : (
          <div style={{
            position: "absolute", inset: 0, zIndex: 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(255,255,255,0.3)", fontSize: 14, textAlign: "center", padding: 24,
          }}>
            {isVideoProcessing ? "⏳ Video procesando…" : "Sin video de presentación"}
          </div>
        )}

        {/* Progress bar */}
        <div style={{
          position: "absolute",
          top: safeTop,
          insetInlineStart: 0, insetInlineEnd: 0,
          paddingTop: 12, paddingInlineStart: 10, paddingInlineEnd: 10,
          zIndex: 10,
        }}>
          <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: "#fff", width: `${Math.round(progress * 100)}%`, transition: "none" }} />
          </div>
        </div>

        {/* Creator header — avatar ring + name + "Donación" label */}
        {(() => {
          const avatarSz = sz === 20 ? 40 : 54;
          // El hueco de la foto ya no se pone a ojo: es lo que ocupa el aro.
          const avatarInset = medidaAroEnCaja(avatarSz).sobresale;
          const headerTop = typeof safeTop === "number" ? safeTop + 36 : `calc(${safeTop} + 36px)`;
          const avatarRing = (
            <div style={{ position: "relative", width: avatarSz, height: avatarSz, flexShrink: 0 }}>
              <div style={{ position: "absolute", inset: avatarInset, borderRadius: "50%", overflow: "hidden", background: "rgba(255,255,255,0.1)" }}>
                {profilePhoto
                  ? <Image src={profilePhoto} alt="" fill style={{ objectFit: "cover" }} />
                  : <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.15)" }} />
                }
              </div>
              <AvatarRing foto={medidaAroEnCaja(avatarSz).foto} />
            </div>
          );
          const inner = (
            <>
              {avatarRing}
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <span style={{ color: "#fff", fontSize: sz === 20 ? 13 : 17, fontWeight: 600, lineHeight: "1.2", fontFamily: FONT }}>{profileName ?? ""}</span>
                <span style={{ color: "rgba(255,255,255,0.75)", fontSize: sz === 20 ? 11 : 13, fontWeight: 500, lineHeight: "1.2", fontFamily: FONT }}>Donación</span>
              </div>
            </>
          );
          const headerStyle: React.CSSProperties = {
            position: "absolute",
            top: headerTop,
            insetInlineStart: 12,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            gap: sz === 20 ? 6 : 8,
            textDecoration: "none",
            WebkitTapHighlightColor: "transparent",
          };
          return profileHandle
            ? <a href={`/u/${profileHandle}`} onClick={(e) => e.stopPropagation()} style={{ ...headerStyle, cursor: "pointer" }}>{inner}</a>
            : <div style={headerStyle}>{inner}</div>;
        })()}

        {/* Top-right controls: mute + close */}
        {showClose && (
          <div style={{
            position: "absolute",
            top: typeof safeTop === "number" ? safeTop + 28 : `calc(${safeTop} + 28px)`,
            insetInlineEnd: 10,
            display: "flex", alignItems: "center", gap: 4,
            zIndex: 11,
          }}>
            {muteBtn(sz)}
            {closeBtn(sz)}
          </div>
        )}

        {/* Bottom gradient */}
        <div style={{
          position: "absolute", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0,
          height: "40%",
          background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
          pointerEvents: "none",
          zIndex: 8,
        }} />

        {/* Bottom: Donar button */}
        <div style={{
          position: "absolute", bottom: 0, insetInlineStart: 0, insetInlineEnd: 0,
          padding: "0 14px",
          paddingBottom: btnPadBottom,
          display: "flex", flexDirection: "column", gap: 10,
          zIndex: 10,
        }}>
          <button
            type="button"
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDonate(); }}
            style={{
              width: "100%",
              padding: sz === 20 ? "8px 10px" : "11px 10px",
              borderRadius: 10,
              border: "none",
              background: "#60a5fa",
              color: "#fff",
              fontSize: sz === 20 ? 12 : 14,
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
      </>
    );
  };

  // ── Desktop: 9:16 panel centered ─────────────────────────────────────────────
  if (isDesktop) {
    const { width: panelW, height: panelH } = desktopPanelSize();
    return createPortal(
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 99999,
          background: "rgba(0,0,0,0.85)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onClick={onClose}
      >
        <div
          style={{
            position: "relative",
            width: panelW, height: panelH,
            borderRadius: 18, overflow: "hidden",
            background: "#000", flexShrink: 0,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {renderPanel(12, true, 0, 20)}
        </div>
      </div>,
      document.body,
    );
  }

  // ── Mobile: fullscreen, swipe-down to close ───────────────────────────────────
  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        background: "#000",
        touchAction: "none", userSelect: "none",
        transform: `translateY(${dragY}px)`,
        transition: dragY > 0 ? "none" : "transform 0.3s ease",
        opacity: 1 - Math.min(1, dragY / 300),
      } as React.CSSProperties}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {renderPanel("env(safe-area-inset-top, 0px)", true, "var(--vb-safe-bottom, 0px)", 24)}
    </div>,
    document.body,
  );
}
