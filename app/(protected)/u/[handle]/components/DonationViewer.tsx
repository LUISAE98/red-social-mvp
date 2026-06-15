"use client";

import { useEffect, useRef, useState } from "react";
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
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    function check() { setIsDesktop(window.innerWidth >= 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Autoplay when opened
  useEffect(() => {
    if (!open) return;
    const el = videoRef.current;
    if (el) el.play().catch(() => {});
  }, [open]);

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

  const content = isDesktop ? (
    // ── Desktop: centred modal with video + payment side by side ──────────────
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.80)",
        padding: 16,
        fontFamily: FONT,
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
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "28px 24px",
          gap: 20,
          overflowY: "auto",
        }}>
          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            style={{
              alignSelf: "flex-end",
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.5)",
              fontSize: 24,
              cursor: "pointer",
              padding: 0,
              lineHeight: 1,
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
              padding: "14px 16px",
              borderRadius: 14,
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

          {/* Provisional payment area */}
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: "20px 0",
          }}>
            <div style={{
              color: "rgba(255,255,255,0.3)",
              fontSize: 13,
              textAlign: "center",
              lineHeight: 1.5,
            }}>
              Panel de pago disponible próximamente
            </div>

            <button
              type="button"
              onClick={onDonate}
              style={{
                width: "100%",
                padding: "14px 20px",
                borderRadius: 14,
                border: "none",
                background: "linear-gradient(135deg, #a855ff, #5cabf9)",
                color: "#fff",
                fontSize: 16,
                fontWeight: 800,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              {donateLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : (
    // ── Mobile: fullscreen video + Donar button ────────────────────────────────
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        fontFamily: FONT,
      }}
    >
      {/* Video */}
      {hlsUrl ? (
        <video
          ref={videoRef}
          src={hlsUrl}
          autoPlay
          playsInline
          controls={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.3)",
          fontSize: 14,
        }}>
          {isVideoProcessing ? "⏳ Video procesando…" : "Sin video de presentación"}
        </div>
      )}

      {/* Gradient overlay at bottom */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "40%",
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)",
        pointerEvents: "none",
      }} />

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        style={{
          position: "absolute",
          top: "max(16px, env(safe-area-inset-top))",
          right: 16,
          background: "rgba(0,0,0,0.45)",
          border: "none",
          borderRadius: "50%",
          width: 36,
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 20,
          cursor: "pointer",
        }}
      >×</button>

      {/* Bottom: name + Donar button */}
      <div style={{
        position: "absolute",
        bottom: "max(24px, env(safe-area-inset-bottom))",
        left: 16,
        right: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        {profileName && (
          <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 14, fontWeight: 600 }}>
            {donation?.mode === "wedding" ? "💍" : "🎁"} {profileName}
            {minAmount ? ` · Apoyo mínimo: ${minAmount} ${currency}` : ""}
          </div>
        )}

        <button
          type="button"
          onClick={onDonate}
          style={{
            width: "100%",
            padding: "15px 20px",
            borderRadius: 16,
            border: "none",
            background: "linear-gradient(135deg, #a855ff, #5cabf9)",
            color: "#fff",
            fontSize: 17,
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          {donateLabel}
        </button>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
