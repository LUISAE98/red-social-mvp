"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useBuyerNextSession } from "@/lib/hooks/useBuyerNextSession";
import { setMeetGreetPreparing } from "@/lib/meetGreet/meetGreetRequests";
import { setExclusiveSessionPreparing } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function fmtScheduledAt(d: Date): string {
  return d.toLocaleString("es-MX", {
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
  const { session, loading } = useBuyerNextSession(uid);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session]);

  if (loading || !session) return null;

  const msLeft = session.scheduledAt.getTime() - now;

  // Past start time: count up from 0 (elapsed since session started)
  const isPastStart = msLeft <= 0;

  const canPrepare = msLeft <= 15 * 60 * 1000;
  const serviceLabel =
    session.serviceKind === "exclusive_session" ? "exclusiva" : "en vivo";
  const creatorName = session.creatorDisplayName ?? "Creador";
  const bgImage = BG_IMAGE[session.serviceKind];
  const btnBg = BTN_BG[session.serviceKind];

  // Countdown label and value depending on phase
  const countdownLabel = isPastStart ? "La sesión ya inició, llevas de retraso" : "Inicia en";
  // Before start: count down. After start: count up (elapsed time since session started).
  const countdownValue = isPastStart
    ? formatCountdown(Math.abs(msLeft))
    : formatCountdown(msLeft);

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

  return (
    <>
      {/* keyframes for the late-pulse animation */}
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
                Sesión {serviceLabel} con
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
            </div>
          </div>

          {/* Row 2: notice + button */}
          <div>
            {!canPrepare && (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", marginBottom: 8, lineHeight: 1.4 }}>
                Faltando 15 minutos podrás prepararte para entrar a tu sesión
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
              {busy ? "Procesando..." : "Prepararse"}
            </button>
          </div>

        </div>
      </div>

      <MeetGreetPreparationFullscreen
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        role="buyer"
        sessionId={session.id}
        sessionType={session.serviceKind}
        scheduledAtLabel={fmtScheduledAt(session.scheduledAt)}
        durationMinutes={session.durationMinutes}
      />
    </>
  );
}
