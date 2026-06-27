"use client";

import { useEffect, useRef, useState } from "react";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ActiveSuperComment } from "@/lib/posts/types";
import { playEdgeTTS, TTS_MIN_DURATION_SECS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";

// ── OBS Browser Source overlay ────────────────────────────────────────────────
// URL: /live-overlay/{postId}
// OBS config: Width 1920 · Height 1080 · ✅ Allow transparency · ✅ Control audio via OBS
// Custom CSS (OBS): body { background: transparent !important; margin: 0; }
// ─────────────────────────────────────────────────────────────────────────────

const FONT = 'inherit';

function SCCard({ sc, fadingOut }: { sc: ActiveSuperComment; fadingOut: boolean }) {
  // Widget autónomo — diseñado para un Browser Source de ~700×160 en OBS.
  // El creador lo posiciona libremente en su escena; no depende de un canvas 1920×1080.
  const SIZE = 56;
  const RING = 3;
  const INSET = 4;
  return (
    <div style={{
      width: "100%",
      padding: "0 12px 12px",
      pointerEvents: "none",
      animation: fadingOut
        ? "obsScOut 0.7s ease forwards"
        : "obsScIn 0.4s ease forwards",
    }}>
      <div style={{
        background: "#0a0a0a",
        borderRadius: 14,
        padding: "14px 18px",
        display: "flex", alignItems: "center", gap: 12,
        borderLeft: `4px solid ${sc.color}`,
        fontFamily: FONT,
      }}>
        {/* Avatar con aro de tier */}
        <div style={{ position: "relative", width: SIZE, height: SIZE, flexShrink: 0 }}>
          {sc.avatarUrl ? (
            <div style={{ position: "absolute", inset: INSET, borderRadius: "50%", overflow: "hidden" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sc.avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ) : (
            <div style={{ position: "absolute", inset: INSET, borderRadius: "50%", background: "rgba(168,85,247,0.5)", display: "grid", placeItems: "center" }}>
              <span style={{ fontSize: 22, color: "#fff", fontWeight: 700 }}>{sc.username.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: sc.color,
            WebkitMaskImage: `radial-gradient(farthest-side, transparent calc(100% - ${RING}px), white calc(100% - ${RING}px))`,
            maskImage: `radial-gradient(farthest-side, transparent calc(100% - ${RING}px), white calc(100% - ${RING}px))`,
          }} />
        </div>
        {/* Nombre + donó */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: FONT, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sc.username}
          </div>
          <div style={{ fontSize: 15, fontFamily: FONT }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 400 }}>donó </span>
            <span style={{ color: "#4ade80", fontWeight: 700 }}>${sc.amount.toFixed(2)} MXN</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LiveOverlayPage({ params }: { params: Promise<{ postId: string }> }) {
  const [postId, setPostId] = useState<string | null>(null);
  const [activeSC, setActiveSC] = useState<ActiveSuperComment | null>(null);
  const [fadingOut, setFadingOut] = useState(false);

  const prevKeyRef = useRef<string | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ttsHandleRef = useRef<EdgeTTSHandle | null>(null);
  const activeSCRef = useRef<ActiveSuperComment | null>(null);

  useEffect(() => {
    params.then((p) => setPostId(p.postId));
  }, [params]);

  function stopTTS() {
    if (ttsHandleRef.current) {
      ttsHandleRef.current.stop();
      ttsHandleRef.current = null;
    }
  }

  function triggerFadeOut() {
    if (overlayTimerRef.current !== null) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
    if (fadeOutTimerRef.current !== null) return;
    setFadingOut(true);
    fadeOutTimerRef.current = setTimeout(() => {
      activeSCRef.current = null;
      setActiveSC(null);
      setFadingOut(false);
      fadeOutTimerRef.current = null;
    }, 600);
  }

  function showOverlay(sc: ActiveSuperComment, durationSecs: number) {
    setFadingOut(false);
    if (fadeOutTimerRef.current !== null) { clearTimeout(fadeOutTimerRef.current); fadeOutTimerRef.current = null; }
    if (overlayTimerRef.current !== null) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
    stopTTS();

    activeSCRef.current = sc;
    setActiveSC(sc);

    if (durationSecs >= TTS_MIN_DURATION_SECS) {
      const ttsText = `${sc.username} dijo: ${sc.text}`;
      ttsHandleRef.current = playEdgeTTS(ttsText, { volume: 1 });
    }

    // Fallback: ocultar cuando termina el tiempo display aunque Firestore sea lento
    overlayTimerRef.current = setTimeout(() => {
      overlayTimerRef.current = null;
      stopTTS();
      triggerFadeOut();
    }, durationSecs * 1000);
  }

  // Suscribir a liveOverlays (legible sin auth, funciona en grupos privados)
  useEffect(() => {
    if (!postId) return;
    const unsub = onSnapshot(
      doc(db, "liveOverlays", postId),
      (snap) => {
        if (!snap.exists()) return;
        const activeSuper: ActiveSuperComment | null = snap.data()?.activeSuper ?? null;

        const scKey = activeSuper?.id != null
          ? `${activeSuper.id}:${activeSuper.scheduledAt ?? 0}`
          : null;
        if (scKey === prevKeyRef.current) return;
        prevKeyRef.current = scKey;

        if (!activeSuper) {
          if (activeSCRef.current) {
            stopTTS();
            triggerFadeOut();
          }
          return;
        }

        if (activeSuper.scheduledAt != null) {
          const delay = activeSuper.scheduledAt - Date.now();
          if (delay > 0) {
            setTimeout(() => showOverlay(activeSuper, activeSuper.displaySeconds), delay);
          } else {
            const remaining = activeSuper.displaySeconds + delay / 1000;
            if (remaining > 0.5) showOverlay(activeSuper, remaining);
          }
        } else {
          showOverlay(activeSuper, activeSuper.displaySeconds);
        }
      },
      (err) => console.warn("[LiveOverlay] Firestore error:", err),
    );
    return () => unsub();
  }, [postId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (overlayTimerRef.current !== null) clearTimeout(overlayTimerRef.current);
      if (fadeOutTimerRef.current !== null) clearTimeout(fadeOutTimerRef.current);
      stopTTS();
    };
  }, []);

  return (
    <>
      <style>{`
        html, body {
          background: transparent !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        @keyframes obsScIn  { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes obsScOut { from{opacity:1;transform:translateY(0)}     to{opacity:0;transform:translateY(6px)} }
      `}</style>

      <div style={{ background: "transparent", pointerEvents: "none" }}>
        {activeSC && <SCCard sc={activeSC} fadingOut={fadingOut} />}
      </div>
    </>
  );
}
