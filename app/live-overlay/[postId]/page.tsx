"use client";

import { useEffect, useRef, useState } from "react";
import { onSnapshot, doc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ActiveSuperComment } from "@/lib/posts/types";
import { computeTtsRate, TTS_MIN_DURATION_SECS } from "@/lib/tts/ttsCalibration";

// ── OBS Browser Source overlay ────────────────────────────────────────────────
// URL: /live-overlay/{postId}
// OBS config: Width 1920 · Height 1080 · ✅ Allow transparency
// Custom CSS (OBS): body { background: transparent !important; margin: 0; }
// ─────────────────────────────────────────────────────────────────────────────

const FONT = 'inherit';

function ScAvatar({ url, name, ringColor }: { url: string | null; name: string; ringColor: string }) {
  const SIZE = 44;
  const RING = 2;
  const INSET = 3;
  return (
    <div style={{
      width: SIZE, height: SIZE, borderRadius: "50%", flexShrink: 0,
      background: ringColor, padding: RING, boxSizing: "border-box",
    }}>
      <div style={{
        width: "100%", height: "100%", borderRadius: "50%",
        background: "#111", overflow: "hidden",
        outline: `${INSET}px solid #111`, outlineOffset: `-${INSET}px`,
      }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{
            width: "100%", height: "100%", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 16, fontWeight: 700,
            color: "#fff", background: ringColor,
          }}>
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}

function SCCard({ sc, fadingOut }: { sc: ActiveSuperComment; fadingOut: boolean }) {
  return (
    <div style={{
      position: "absolute", left: 16, right: 16, bottom: 24,
      background: "rgba(10,10,10,0.92)",
      borderRadius: 16,
      borderLeft: `4px solid ${sc.color}`,
      padding: "14px 16px",
      display: "flex", flexDirection: "column", gap: 8,
      boxShadow: `0 0 0 1px rgba(255,255,255,0.07), 0 8px 32px rgba(0,0,0,0.6), 0 0 20px ${sc.color}22`,
      animation: fadingOut
        ? "obsScOut 0.6s ease forwards"
        : "obsScIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards",
      fontFamily: FONT,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <ScAvatar url={sc.avatarUrl} name={sc.username} ringColor={sc.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{sc.username}</span>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontWeight: 400 }}>donó</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#4ade80" }}>
              ${sc.amount.toFixed(2)} MXN
            </span>
          </div>
          <div style={{
            display: "inline-block", marginTop: 3,
            fontSize: 11, fontWeight: 600, color: sc.color,
            background: `${sc.color}22`, borderRadius: 6,
            padding: "1px 7px",
          }}>
            {sc.tierName}
          </div>
        </div>
      </div>
      {/* Message */}
      <p style={{
        margin: 0, fontSize: 15, fontWeight: 400,
        color: "rgba(255,255,255,0.92)", lineHeight: 1.5,
        wordBreak: "break-word",
      }}>
        {sc.text}
      </p>
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
  const ttsKeepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSCRef = useRef<ActiveSuperComment | null>(null);

  // Resolve async params (Next.js 15)
  useEffect(() => {
    params.then((p) => setPostId(p.postId));
  }, [params]);

  function triggerFadeOut() {
    if (overlayTimerRef.current !== null) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
    if (ttsKeepAliveRef.current !== null) { clearInterval(ttsKeepAliveRef.current); ttsKeepAliveRef.current = null; }
    if (fadeOutTimerRef.current !== null) return;
    setFadingOut(true);
    fadeOutTimerRef.current = setTimeout(() => {
      activeSCRef.current = null;
      setActiveSC(null);
      setFadingOut(false);
      fadeOutTimerRef.current = null;
    }, 600);
  }

  function playTTS(sc: ActiveSuperComment, durationSecs: number) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (durationSecs < TTS_MIN_DURATION_SECS) return;

    const fullText = `${sc.username} dijo: ${sc.text}`;
    const elapsed = sc.displaySeconds - durationSecs;
    const progressRatio = elapsed > 0 ? Math.min(elapsed / sc.displaySeconds, 0.95) : 0;
    const startChar = Math.floor(progressRatio * fullText.length);
    const ttsSlice = startChar > 0 ? fullText.slice(startChar) : fullText;

    const utterance = new SpeechSynthesisUtterance(ttsSlice);
    utterance.lang = "es-MX";
    utterance.rate = computeTtsRate(ttsSlice, durationSecs);
    utterance.volume = 1;
    utterance.onend = () => {
      if (ttsKeepAliveRef.current !== null) { clearInterval(ttsKeepAliveRef.current); ttsKeepAliveRef.current = null; }
      triggerFadeOut();
    };

    // Chrome puede pausar speechSynthesis silenciosamente en utterances largas
    ttsKeepAliveRef.current = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);

    const wasActive = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    window.speechSynthesis.cancel();
    if (wasActive) {
      setTimeout(() => window.speechSynthesis.speak(utterance), 80);
    } else {
      window.speechSynthesis.speak(utterance);
    }
  }

  function showOverlay(sc: ActiveSuperComment, durationSecs: number) {
    setFadingOut(false);
    if (fadeOutTimerRef.current !== null) { clearTimeout(fadeOutTimerRef.current); fadeOutTimerRef.current = null; }
    if (overlayTimerRef.current !== null) { clearTimeout(overlayTimerRef.current); overlayTimerRef.current = null; }
    if (ttsKeepAliveRef.current !== null) { clearInterval(ttsKeepAliveRef.current); ttsKeepAliveRef.current = null; }

    activeSCRef.current = sc;
    setActiveSC(sc);

    playTTS(sc, durationSecs);

    // Fallback: ocultar aunque TTS.onend no dispare
    overlayTimerRef.current = setTimeout(() => {
      overlayTimerRef.current = null;
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
      triggerFadeOut();
    }, durationSecs * 1000);
  }

  // Suscribir a Firestore
  useEffect(() => {
    if (!postId) return;
    const unsub = onSnapshot(
      doc(db, "posts", postId),
      (snap) => {
        if (!snap.exists()) return;
        const liveData = snap.data()?.liveData;
        const activeSuper: ActiveSuperComment | null = liveData?.activeSuper ?? null;

        const scKey = activeSuper?.id != null
          ? `${activeSuper.id}:${activeSuper.scheduledAt ?? 0}`
          : null;
        if (scKey === prevKeyRef.current) return;
        prevKeyRef.current = scKey;

        if (!activeSuper) {
          if (activeSCRef.current) {
            if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
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

  // Cleanup
  useEffect(() => {
    return () => {
      if (overlayTimerRef.current !== null) clearTimeout(overlayTimerRef.current);
      if (fadeOutTimerRef.current !== null) clearTimeout(fadeOutTimerRef.current);
      if (ttsKeepAliveRef.current !== null) clearInterval(ttsKeepAliveRef.current);
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
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
        @keyframes obsScIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes obsScOut {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(8px); }
        }
      `}</style>
      <div style={{
        position: "fixed", inset: 0,
        background: "transparent",
        pointerEvents: "none",
      }}>
        {activeSC && <SCCard sc={activeSC} fadingOut={fadingOut} />}
      </div>
    </>
  );
}
