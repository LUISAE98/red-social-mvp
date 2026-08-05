"use client";

// Tipos, helpers y sub-componentes de LiveViewerModal (aislados).

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import Hls from "hls.js";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import type { Post, PostLiveData, PostPlayback } from "@/lib/posts/types";
import { togglePostFlame } from "@/lib/posts/post-service";
import VibraFlameIcon from "@/app/components/VibraServiceIcons/VibraFlameIcon";
import LiveChatViewer from "@/app/components/LiveChat/LiveChatViewer";
import { checkLiveAccess, grantSimulatedLiveAccess } from "@/lib/liveAccess/live-access-service";
import { joinLivePresence, leaveLivePresence, subscribeToViewerCount, registerUniqueViewer, addWatchTime, recordVodView } from "@/lib/liveKit/liveViewers";
import type { ActiveSuperComment } from "@/lib/posts/types";
import { TTS_MIN_DURATION_SECS } from "@/lib/tts/edge-tts-client";
import type { EdgeTTSHandle } from "@/lib/tts/edge-tts-client";
import {
  VideoPlayIcon, VideoPauseIcon, VideoSkipBackIcon, VideoSkipForwardIcon,
} from "@/app/components/VibraServiceIcons/VibraVideoIcons";
import { getOrCreateGuestId, getSavedGuestNickname, saveGuestNickname } from "@/lib/guest-id";
import { submitSuperComment, submitSuperCommentAsGuest } from "@/lib/liveChat/super-comment-service";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";
import { useReport } from "@/lib/moderation/useReport";
import ReportModal from "@/app/components/ReportModal/ReportModal";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import TaxNote from "@/components/payments/TaxNote";

export const FONT =
  'inherit';


export type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
  onManage?: () => void;
  initialPortrait?: boolean;
  initialStream?: MediaStream | null;
};

// Igual que StoryViewer.desktopPanelSize()
export function desktopStorySize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 405, height: 720 };
  const h = Math.min(Math.round(window.innerHeight * 0.86), 720);
  return { width: Math.round((h * 9) / 16), height: h };
}

// Video horizontal: deja espacio para el chat flotante separado
export function desktopHorizontalSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 800, height: 450 };
  const w = Math.min(Math.round(window.innerWidth * 0.62), 800);
  const h = Math.round((w * 9) / 16);
  return { width: w, height: Math.min(h, Math.round(window.innerHeight * 0.80)) };
}

export const CHAT_FLOAT_W = 300;

// ── DonationPanel ────────────────────────────────────────────────────────────
export const DONATE_BLUE = "#3b82f6";
export const DONATE_PRESETS = [50, 130, 250, 510];

export type DonationPanelProps = {
  onClose: () => void;
  postId: string;
  authorId?: string | null;
  /** undefined = modo invitado */
  userId?: string;
  username?: string;
  avatarUrl?: string | null;
  guestId?: string;
};

export function DonationPanel({ onClose, postId, authorId, userId, username, avatarUrl, guestId }: DonationPanelProps) {
  const { format: formatMoney } = usePriceFormat();
  const isGuest = !userId;
  const [step, setStep] = useState<"nickname" | "amount">("amount");
  const [guestNickname, setGuestNickname] = useState("");
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [paying, setPaying] = useState(false);
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(avatarUrl ?? null);
  const [resolvedUsername, setResolvedUsername] = useState(username ?? "");

  // Para invitados: cargar apodo guardado
  useEffect(() => {
    if (isGuest) {
      const saved = getSavedGuestNickname();
      setGuestNickname(saved);
      setStep(saved.length >= 2 ? "amount" : "nickname");
    }
  }, [isGuest]);

  // Para usuarios logueados: cargar datos de Firestore
  useEffect(() => {
    if (!userId) return;
    getDoc(doc(db, "users", userId)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d?.photoURL) setResolvedAvatar(d.photoURL as string);
      if (d?.displayName ?? d?.handle) setResolvedUsername((d.displayName ?? d.handle) as string);
    }).catch(() => {});
  }, [userId]);

  const finalAmount = amount ?? (custom ? parseFloat(custom) || null : null);
  const valid = !!finalAmount && finalAmount >= 10;
  const nicknameOk = guestNickname.trim().length >= 2;

  function handleNicknameContinue() {
    const trimmed = guestNickname.trim();
    if (trimmed.length < 2) return;
    saveGuestNickname(trimmed);
    setGuestNickname(trimmed);
    setStep("amount");
  }

  async function handlePay() {
    if (!valid || paying) return;
    setPaying(true);
    try {
      const tier = {
        id: "donation",
        name: "Donación",
        maxChars: 0,
        price: finalAmount!,
        color: DONATE_BLUE,
        displaySeconds: 15,
      };
      if (isGuest && guestId) {
        await submitSuperCommentAsGuest({
          postId,
          guestId,
          username: guestNickname.trim(),
          text: "",
          tier,
        });
      } else if (userId) {
        await submitSuperComment({
          postId,
          userId,
          username: resolvedUsername,
          avatarUrl: resolvedAvatar,
          text: "",
          tier,
        });
      }
      registrarCompraGeo({
        creatorId: authorId,
        serviceType: "live_donation",
        grossAmount: finalAmount ?? undefined,
      });
    } finally {
      setPaying(false);
      onClose();
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 10200,
        background: "rgba(0,0,0,0.65)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#111827",
          borderRadius: "20px 20px 0 0",
          padding: "24px 20px",
          paddingBottom: "calc(24px + var(--vb-safe-bottom, 0px))",
          width: "100%", maxWidth: 480,
          boxShadow: "0 -20px 60px rgba(0,0,0,0.8)",
          animation: "dpIn 0.25s ease",
        }}
      >
        <style>{`@keyframes dpIn{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#fff", fontFamily: FONT }}>Donar</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        {/* ── Paso apodo (solo invitados sin apodo guardado) ── */}
        {isGuest && step === "nickname" ? (
          <>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", fontFamily: FONT, marginBottom: 12 }}>
              Tu apodo aparecerá en la donación
            </p>
            <input
              autoFocus
              type="text"
              maxLength={30}
              placeholder="Tu apodo (mín. 2 caracteres)"
              value={guestNickname}
              onChange={(e) => setGuestNickname(e.target.value.slice(0, 30))}
              onKeyDown={(e) => { if (e.key === "Enter") handleNicknameContinue(); }}
              style={{
                display: "block", width: "100%",
                background: "rgba(255,255,255,0.08)",
                border: `1px solid ${nicknameOk ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.1)"}`,
                borderRadius: 12, padding: "10px 14px",
                color: "#fff", fontSize: 14, fontFamily: FONT, outline: "none",
                marginBottom: 16, boxSizing: "border-box",
              }}
            />
            <button
              onClick={handleNicknameContinue}
              disabled={!nicknameOk}
              style={{
                display: "block", width: "100%", padding: "13px 0",
                borderRadius: 14, border: "none",
                background: nicknameOk ? DONATE_BLUE : "rgba(255,255,255,0.07)",
                color: nicknameOk ? "#fff" : "rgba(255,255,255,0.25)",
                fontSize: 15, fontWeight: 700, fontFamily: FONT,
                cursor: nicknameOk ? "pointer" : "not-allowed",
                transition: "all 0.2s",
              }}
            >
              Continuar
            </button>
          </>
        ) : (
          <>
            {/* Badge apodo invitado */}
            {isGuest && (
              <div style={{ marginBottom: 14, fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: FONT }}>
                Donando como <strong style={{ color: "#fff" }}>{guestNickname}</strong>
                <button
                  onClick={() => setStep("nickname")}
                  style={{ marginLeft: 8, background: "none", border: "none", color: DONATE_BLUE, fontSize: 12, cursor: "pointer", padding: 0, fontFamily: FONT }}
                >
                  Cambiar
                </button>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {DONATE_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => { setAmount(p); setCustom(""); }}
                  style={{
                    padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer",
                    background: amount === p ? DONATE_BLUE : "rgba(255,255,255,0.1)",
                    color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: FONT,
                    transition: "background 0.15s",
                  }}
                >
                  ${p}
                </button>
              ))}
            </div>

            <input
              type="number"
              min={10}
              placeholder="Otro monto (mínimo $10)..."
              value={custom}
              onChange={(e) => { setCustom(e.target.value); setAmount(null); }}
              style={{
                display: "block", width: "100%",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12,
                padding: "10px 14px", color: "#fff", fontSize: 14,
                fontFamily: FONT, outline: "none", marginBottom: 16,
                boxSizing: "border-box",
              }}
            />

            <button
              onClick={handlePay}
              disabled={!valid || paying}
              style={{
                display: "block", width: "100%", padding: "13px 0",
                borderRadius: 14, border: "none",
                background: valid ? DONATE_BLUE : "rgba(255,255,255,0.08)",
                color: valid ? "#fff" : "rgba(255,255,255,0.25)",
                fontSize: 15, fontWeight: 700, fontFamily: FONT,
                cursor: valid && !paying ? "pointer" : "not-allowed",
                transition: "all 0.2s",
              }}
            >
              {paying ? "Procesando..." : valid ? `Donar ${formatMoney(finalAmount!, { code: true })}` : "Selecciona un monto"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export const VOD_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

