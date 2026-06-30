"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Props = {
  message?: string | null;
  playbackId?: string | null;
  creatorName?: string | null;
  profilePhoto?: string | null;
  paused?: boolean;
  onClick?: () => void;
};

type VideoDimensions = { w: number; h: number } | null;

const VIBRA_RING = "linear-gradient(135deg, #ec4899 0%, #9333ea 52%, #3b82f6 100%)";

export default function DonationFeedBanner({ message, playbackId, creatorName, profilePhoto, paused, onClick }: Props) {
  const [dims, setDims] = useState<VideoDimensions>(null);
  const [muted, setMuted] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const thumbnailUrl = playbackId
    ? `https://image.mux.com/${playbackId}/thumbnail.jpg?time=2`
    : null;

  const hlsUrl = playbackId
    ? `https://stream.mux.com/${playbackId}.m3u8`
    : null;

  useEffect(() => {
    if (!thumbnailUrl) return;
    const img = new window.Image();
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setDims({ w: img.naturalWidth, h: img.naturalHeight });
      }
    };
    img.src = thumbnailUrl;
  }, [thumbnailUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;
    setVideoReady(false);
    hlsRef.current?.destroy();
    hlsRef.current = null;
    video.muted = true;
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, startLevel: -1, maxBufferLength: 30 });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => setVideoReady(true));
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    } else {
      // Safari native HLS
      video.src = hlsUrl;
      const onMeta = () => setVideoReady(true);
      video.addEventListener("loadedmetadata", onMeta);
      return () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeAttribute("src");
        video.load();
      };
    }
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [hlsUrl]);

  // Autoplay when ≥50% visible — only after canplay fires
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl || !videoReady) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.intersectionRatio >= 0.5) {
          video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: [0, 0.5] }
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [hlsUrl, videoReady]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  // Pause when the donation viewer is open so both don't stream HLS simultaneously
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) {
      video.pause();
    } else if (videoReady) {
      video.play().catch(() => undefined);
    }
  }, [paused, videoReady]);

  const isPortrait = dims ? dims.h > dims.w : false;
  const aspectRatio = dims ? `${dims.w} / ${dims.h}` : isPortrait ? "9 / 16" : "16 / 9";
  const videoWidthInline = isPortrait ? "18%" : "36%";
  const orientation = isPortrait ? "portrait" : "landscape";

  return (
    <>
      <style>{`
        /* ── Video ─────────────────────────────────────────────────── */
        .dbv-video-wrap {
          position: absolute;
          z-index: 2;
          border-radius: 10px;
          overflow: hidden;
          background: #111;
        }
        .dbv-video-wrap.landscape { top: 6%;  right: 4%; }
        .dbv-video-wrap.portrait  { top: 2%; right: 12%; }
        @media (min-width: 560px) {
          .dbv-video-wrap.landscape { top: 14%; right: 4%; }
          .dbv-video-wrap.portrait  { top: 4%; bottom: 4%; right: 4%; width: auto !important; }
        }

        /* ── Actions: full-height, avatar+text centered in top zone, shield+btn at bottom */
        .dbv-actions {
          position: absolute;
          inset: 0;
          z-index: 1;
          padding: 0 18px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
        }
        /* Upper zone: fills space above shield+btn, centers avatar+text vertically */
        .dbv-upper {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          gap: 10px;
        }
        /* Lower zone: shield + button anchored to bottom */
        .dbv-lower {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding-bottom: 18px;
          width: 100%;
        }
        .dbv-text-block,
        .dbv-shield-row,
        .dbv-btn { width: 86%; }

        /* ── Small laptop (560–899px): scale fonts down ── */
        @media (min-width: 560px) and (max-width: 899px) {
          .dbv-avatar              { width: 60px !important; height: 60px !important; }
          .dbv-title               { font-size: 13px !important; }
          .dbv-upper               { gap: 5px; }
          .dbv-lower               { padding-bottom: 12px; gap: 5px; }
          .dbv-shield-row span     { font-size: 10px !important; }
          .dbv-btn                 { font-size: 12px !important; padding-top: 7px !important; padding-bottom: 7px !important; }
        }

        /* ── Large desktop (900px+) ─────────────────────────────────── */
        @media (min-width: 900px) {
          /* Portrait: left zone only (0 → 74%) */
          .dbv-actions.portrait {
            right: auto;
            width: 74%;
          }
          .dbv-actions.portrait .dbv-text-block,
          .dbv-actions.portrait .dbv-shield-row,
          .dbv-actions.portrait .dbv-btn { width: 70%; }
        }
      `}</style>

      <div
        className="dbv-container"
        onClick={onClick}
        style={{
          position: "relative",
          width: "100%",
          borderRadius: 16,
          overflow: "hidden",
          background: "#0a0a0a",
          cursor: onClick ? "pointer" : "default",
          aspectRatio: "16 / 8",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <Image
          src="/donacion.png"
          alt="Donación"
          fill
          sizes="(max-width: 720px) 100vw, 720px"
          style={{ objectFit: "cover", objectPosition: "center" }}
          priority
        />

        <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,10,0.68)" }} />


        {/* Video */}
        {hlsUrl && (
          <div
            className={`dbv-video-wrap ${orientation}`}
            style={{ width: videoWidthInline, aspectRatio }}
          >
            <video
              ref={videoRef}
              playsInline
              loop
              muted

              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
            <button
              type="button"
              aria-label={muted ? "Activar sonido" : "Silenciar"}
              onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
              style={{
                position: "absolute", bottom: 6, right: 6, zIndex: 3,
                background: "rgba(0,0,0,0.55)", border: "none", borderRadius: "50%",
                width: 26, height: 26, cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "rgba(255,255,255,0.9)", WebkitTapHighlightColor: "transparent",
              }}
            >
              {muted ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <line x1="23" y1="9" x2="17" y2="15"/>
                  <line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
              )}
            </button>
          </div>
        )}

        {/* All content in one container — upper zone centers avatar+text, lower anchors shield+btn */}
        <div className={`dbv-actions ${orientation}`}>

          {/* Upper: avatar + text centered vertically between top and shield */}
          <div className="dbv-upper">
            {profilePhoto && (
              <div className="dbv-avatar" style={{
                position: "relative", width: 100, height: 100,
                borderRadius: "50%", overflow: "hidden", flexShrink: 0,
                background: "rgba(255,255,255,0.1)",
              }}>
                <Image src={profilePhoto} alt="" fill sizes="100px" style={{ objectFit: "cover" }} />
              </div>
            )}
            {(creatorName || message) && (
              <div className="dbv-text-block" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                {creatorName && (
                  <p className="dbv-title" style={{
                    margin: 0, fontSize: 18, fontWeight: 400, color: "#fff", lineHeight: 1.2,
                    textAlign: "center", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                  }}>
                    Apoya a {creatorName}
                  </p>
                )}
                {message && (
                  <p className="dbv-desc" style={{
                    margin: 0, fontSize: 13, fontWeight: 400,
                    color: "rgba(255,255,255,0.80)", lineHeight: 1.45, textAlign: "center",
                    display: "-webkit-box", WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical", overflow: "hidden",
                    padding: 0, width: "110%", alignSelf: "center",
                  }}>
                    {message}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Lower: shield + button anchored at bottom */}
          {onClick && (
            <div className="dbv-lower">
              <div className="dbv-shield-row" style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ec4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
                <span style={{ fontSize: 11, color: "#ec4899", lineHeight: 1.3, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", minWidth: 0 }}>
                  Tu aportación es completamente voluntaria
                </span>
              </div>
              <button
                type="button"
                className="dbv-btn"
                onClick={(e) => { e.stopPropagation(); onClick(); }}
                style={{
                  padding: "10px 0",
                  justifyContent: "center", borderRadius: 10, border: "none",
                  background: "#ec4899", color: "#fff", fontSize: 14, fontWeight: 600,
                  letterSpacing: "-0.01em", cursor: "pointer", fontFamily: "inherit",
                  WebkitTapHighlightColor: "transparent", display: "flex",
                  alignItems: "center", gap: 7,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                </svg>
                Hacer una aportación
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
