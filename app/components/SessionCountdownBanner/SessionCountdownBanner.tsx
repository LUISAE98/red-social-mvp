"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useBuyerNextSession } from "@/lib/hooks/useBuyerNextSession";
import { setMeetGreetPreparing } from "@/lib/meetGreet/meetGreetRequests";
import { setExclusiveSessionPreparing } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import {
  requestMeetGreetReschedule,
  requestMeetGreetRefund,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  requestExclusiveSessionReschedule,
  requestExclusiveSessionRefund,
} from "@/lib/exclusiveSession/exclusiveSessionRequests";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function fmtScheduledAt(d: Date, locale: string): string {
  return d.toLocaleString(locale, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const BG_IMAGE: Record<string, string> = {
  meet_greet: "/encuentroenvivo.png",
  exclusive_session: "/sesionexclusiva.png",
};

const BTN_BG: Record<string, string> = {
  meet_greet: "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)",
  exclusive_session: "linear-gradient(135deg, #be185d 0%, #ec4899 100%)",
};

export default function SessionCountdownBanner({ uid }: { uid: string }) {
  const tServices = useTranslations("services");
  const tCommon = useTranslations("common");
  const tSessions = useTranslations("sessions");
  const locale = useLocale();

  const { session, loading } = useBuyerNextSession(uid);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);
  const [reschedReason, setReschedReason] = useState("");
  const lateTriggeredRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    lateTriggeredRef.current.clear();
    setReschedOpen(false);
    setReschedReason("");
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  // Re-open overlay every 5 minutes of delay
  useEffect(() => {
    if (!session) return;
    const msLate = now - session.scheduledAt.getTime();
    if (msLate <= 0) return;
    const bucket = Math.floor(msLate / (5 * 60 * 1000)) * 5;
    if (bucket <= 0 || lateTriggeredRef.current.has(bucket)) return;
    lateTriggeredRef.current.add(bucket);
    setPrepOpen(true);
  }, [now, session]);

  if (loading || !session) return null;

  const msLeft = session.scheduledAt.getTime() - now;
  const isPastStart = msLeft <= 0;
  const msLate = isPastStart ? Math.abs(msLeft) : 0;
  const toleranceExpired = isPastStart && msLate >= 15 * 60 * 1000;
  const canPrepare = msLeft <= 15 * 60 * 1000;

  const sessionLabel =
    session.serviceKind === "exclusive_session"
      ? tServices("sessionLabelExclusive")
      : tServices("sessionLabelLive");
  const creatorName = session.creatorDisplayName ?? tSessions("creatorFallback");
  const bgImage = BG_IMAGE[session.serviceKind];
  const btnBg = BTN_BG[session.serviceKind];

  const countdownLabel = isPastStart ? tServices("sessionLate") : tServices("sessionStartsIn");
  const countdownValue = isPastStart
    ? formatCountdown(Math.abs(msLeft))
    : formatCountdown(msLeft);

  const creatorConnected = !!session.preparingCreatorAt;
  const buyerConnected = !!session.preparingBuyerAt;

  async function handlePrepare() {
    if (!session || busy || !canPrepare) return;
    setBusy(true);
    try {
      if (session.serviceKind === "meet_greet") {
        await setMeetGreetPreparing({ requestId: session.id, role: "buyer" });
      } else {
        await setExclusiveSessionPreparing({ requestId: session.id, role: "buyer" });
      }
      setPrepOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleReschedule() {
    if (!session || busy) return;
    setBusy(true);
    try {
      if (session.serviceKind === "meet_greet") {
        await requestMeetGreetReschedule({ requestId: session.id, reason: reschedReason || null });
      } else {
        await requestExclusiveSessionReschedule({ requestId: session.id, reason: reschedReason || null });
      }
      setReschedOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefund() {
    if (!session || busy) return;
    setBusy(true);
    try {
      if (session.serviceKind === "meet_greet") {
        await requestMeetGreetRefund({ requestId: session.id, refundReason: null });
      } else {
        await requestExclusiveSessionRefund({ requestId: session.id, refundReason: null });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {isPastStart && (
        <style>{`
          @keyframes session-late-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.45; }
          }
        `}</style>
      )}

      <div
        style={{
          width: "100%",
          position: "relative",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 14,
          boxSizing: "border-box",
          backgroundImage: `url(${bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* dark overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(160deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.72) 100%)",
          }}
        />

        <div style={{ position: "relative", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Row 1: avatar+name on left, countdown on right */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Avatar */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "50%",
                overflow: "hidden",
                flexShrink: 0,
                background: "rgba(255,255,255,0.10)",
                border: "2px solid rgba(255,255,255,0.22)",
              }}
            >
              {session.creatorAvatarUrl ? (
                <Image
                  src={session.creatorAvatarUrl}
                  alt={creatorName}
                  width={52}
                  height={52}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 20,
                    fontWeight: 700,
                    color: "#fff",
                    textTransform: "uppercase",
                  }}
                >
                  {creatorName[0]}
                </div>
              )}
            </div>

            {/* Name block */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontWeight: 500, marginBottom: 3 }}>
                {sessionLabel}
              </div>
              <div style={{ fontSize: 17, color: "#fff", fontWeight: 700, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {creatorName}
              </div>
            </div>

            {/* Countdown */}
            <div style={{ flexShrink: 0, textAlign: "right", maxWidth: "45%" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  marginBottom: 2,
                  lineHeight: 1.3,
                  color: isPastStart ? "#fb923c" : "rgba(255,255,255,0.65)",
                }}
              >
                {countdownLabel}
              </div>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  fontVariantNumeric: "tabular-nums",
                  textShadow: "0 1px 8px rgba(0,0,0,0.5)",
                  color: isPastStart ? "#fb923c" : "#fff",
                  ...(isPastStart
                    ? { animation: "session-late-pulse 1.6s ease-in-out infinite" }
                    : {}),
                }}
              >
                {countdownValue}
              </div>
              {isPastStart && (
                <div style={{ fontSize: 10, color: "#fb923c", marginTop: 3, lineHeight: 1.3, opacity: 0.85 }}>
                  {tSessions("toleranceWarning")}
                </div>
              )}
            </div>
          </div>

          {/* Connection status notice */}
          {canPrepare && (creatorConnected || buyerConnected) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "7px 10px",
                borderRadius: 8,
                background: creatorConnected
                  ? "rgba(34,197,94,0.14)"
                  : "rgba(255,255,255,0.08)",
                border: creatorConnected
                  ? "1px solid rgba(34,197,94,0.28)"
                  : "1px solid rgba(255,255,255,0.12)",
              }}
            >
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: creatorConnected ? "#4ade80" : "rgba(255,255,255,0.45)",
                }}
              />
              <span style={{ fontSize: 12, color: "#fff", fontWeight: 500, lineHeight: 1.3 }}>
                {creatorConnected && !buyerConnected
                  ? tSessions("creatorReadyJoin")
                  : buyerConnected && !creatorConnected
                  ? tSessions("buyerWaitingCreator")
                  : tSessions("bothConnected")}
              </span>
            </div>
          )}

          {/* Row 2: notice + action area */}
          <div>
            {!toleranceExpired ? (
              <>
                {!canPrepare && (
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", marginBottom: 8, lineHeight: 1.4 }}>
                    {tServices("sessionWait15min")}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handlePrepare}
                  disabled={!canPrepare || busy}
                  style={{
                    width: "100%",
                    height: 40,
                    borderRadius: 8,
                    border: "none",
                    background: canPrepare && !busy ? btnBg : "rgba(255,255,255,0.14)",
                    color: canPrepare && !busy ? "#fff" : "rgba(255,255,255,0.35)",
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: canPrepare && !busy ? "pointer" : "not-allowed",
                    fontFamily: "inherit",
                    letterSpacing: "-0.02em",
                    transition: "background 0.2s",
                  }}
                >
                  {busy ? tCommon("processing") : tServices("prepareButton")}
                </button>
              </>
            ) : reschedOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={reschedReason}
                  onChange={(e) => setReschedReason(e.target.value)}
                  placeholder={tSessions("rescheduleReasonPlaceholder")}
                  rows={2}
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    borderRadius: 8,
                    color: "#fff",
                    fontSize: 13,
                    padding: "8px 10px",
                    resize: "none",
                    fontFamily: "inherit",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={handleReschedule}
                    disabled={busy}
                    style={{
                      flex: 1,
                      height: 38,
                      borderRadius: 8,
                      border: "none",
                      background: busy ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.16)",
                      color: busy ? "rgba(255,255,255,0.35)" : "#fff",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: busy ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {busy ? tCommon("processing") : tSessions("confirmRescheduleSession")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReschedOpen(false)}
                    disabled={busy}
                    style={{
                      height: 38,
                      paddingInline: 14,
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.18)",
                      background: "transparent",
                      color: "rgba(255,255,255,0.60)",
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.4, fontWeight: 500 }}>
                  {tSessions("toleranceExpiredChoose")}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setReschedOpen(true)}
                    disabled={busy}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.28)",
                      background: "rgba(255,255,255,0.10)",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: busy ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {tServices("reschedule")}
                  </button>
                  <button
                    type="button"
                    onClick={handleRefund}
                    disabled={busy}
                    style={{
                      flex: 1,
                      height: 40,
                      borderRadius: 8,
                      border: "none",
                      background: busy ? "rgba(255,255,255,0.10)" : "rgba(239,68,68,0.22)",
                      color: busy ? "rgba(255,255,255,0.35)" : "#fca5a5",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: busy ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {busy ? tCommon("processing") : tServices("requestRefund")}
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      <MeetGreetPreparationFullscreen
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        role="buyer"
        sessionId={session.id}
        sessionType={session.serviceKind}
        scheduledAtLabel={fmtScheduledAt(session.scheduledAt, locale)}
        durationMinutes={session.durationMinutes}
      />
    </>
  );
}
