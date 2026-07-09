"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useCreatorTodaySessions, type CreatorSession } from "@/lib/hooks/useCreatorTodaySessions";
import { setMeetGreetPreparing } from "@/lib/meetGreet/meetGreetRequests";
import { setExclusiveSessionPreparing } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import {
  rejectMeetGreetRequest,
  requestMeetGreetReschedule,
} from "@/lib/meetGreet/meetGreetRequests";
import {
  rejectExclusiveSessionRequest,
  requestExclusiveSessionReschedule,
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

function formatTime(d: Date): string {
  return d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtScheduledAt(d: Date): string {
  return d.toLocaleString("es-MX", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}



// Self-contained row for auto_rejected_no_show sessions in the "other sessions" list
function ActionSessionRow({ session }: { session: CreatorSession }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const buyerName = session.buyerDisplayName ?? "Comprador";

  async function handleReject() {
    if (busy) return;
    setBusy(true);
    try {
      if (session.serviceKind === "meet_greet") {
        await rejectMeetGreetRequest({ requestId: session.id, rejectionReason: null });
      } else {
        await rejectExclusiveSessionRequest({ requestId: session.id, rejectionReason: null });
      }
      setDone(true);
    } catch (e) { console.error(e); } finally { setBusy(false); }
  }

  async function handleReschedule() {
    if (busy) return;
    setBusy(true);
    try {
      if (session.serviceKind === "meet_greet") {
        await requestMeetGreetReschedule({ requestId: session.id, reason: null });
      } else {
        await requestExclusiveSessionReschedule({ requestId: session.id, reason: null });
      }
      setDone(true);
    } catch (e) { console.error(e); } finally { setBusy(false); }
  }

  if (done) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#fb923c", minWidth: 40, fontVariantNumeric: "tabular-nums" }}>
        {formatTime(session.scheduledAt)}
      </div>
      <div style={{ width: 24, height: 24, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(251,146,60,0.30)" }}>
        {session.buyerAvatarUrl ? (
          <Image src={session.buyerAvatarUrl} alt={buyerName} width={24} height={24} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>{buyerName[0]}</div>
        )}
      </div>
      <div style={{ flex: 1, fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.80)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {buyerName}
      </div>
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        <button type="button" onClick={handleReschedule} disabled={busy}
          style={{ height: 26, paddingInline: 8, borderRadius: 6, border: "1px solid rgba(255,255,255,0.22)", background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          Reagendar
        </button>
        <button type="button" onClick={handleReject} disabled={busy}
          style={{ height: 26, paddingInline: 8, borderRadius: 6, border: "none", background: busy ? "rgba(255,255,255,0.06)" : "rgba(239,68,68,0.18)", color: busy ? "rgba(255,255,255,0.30)" : "#fca5a5", fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          Rechazar
        </button>
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: CreatorSession }) {
  const buyerName = session.buyerDisplayName ?? "Comprador";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "3px 0",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#fff",
          minWidth: 40,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.01em",
        }}
      >
        {formatTime(session.scheduledAt)}
      </div>
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: "50%",
          overflow: "hidden",
          flexShrink: 0,
          background: "rgba(255,255,255,0.10)",
          border: "1.5px solid rgba(255,255,255,0.18)",
        }}
      >
        {session.buyerAvatarUrl ? (
          <Image
            src={session.buyerAvatarUrl}
            alt={buyerName}
            width={26}
            height={26}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "grid",
              placeItems: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "#fff",
              textTransform: "uppercase",
            }}
          >
            {buyerName[0]}
          </div>
        )}
      </div>
      <div
        style={{
          flex: 1,
          fontSize: 13,
          fontWeight: 500,
          color: "#fff",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {buyerName}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#fff",
          whiteSpace: "nowrap",
        }}
      >
        {session.durationMinutes != null ? `${session.durationMinutes} minutos` : "—"}
      </div>
    </div>
  );
}

export default function CreatorSessionCountdownBanner({ uid }: { uid: string }) {
  const { nextSession, todaySessions, loading } = useCreatorTodaySessions(uid);
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
  }, [nextSession?.id]);

  useEffect(() => {
    if (!nextSession) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextSession]);

  // Re-open overlay every 5 minutes of delay
  useEffect(() => {
    if (!nextSession) return;
    if (nextSession.status === "auto_rejected_no_show") return;
    const msLate = now - nextSession.scheduledAt.getTime();
    if (msLate <= 0) return;
    const bucket = Math.floor(msLate / (5 * 60 * 1000)) * 5;
    if (bucket <= 0 || lateTriggeredRef.current.has(bucket)) return;
    lateTriggeredRef.current.add(bucket);
    setPrepOpen(true);
  }, [now, nextSession]);

  const noShowSessions = todaySessions.filter((s) => s.status === "auto_rejected_no_show");
  if (loading || todaySessions.length === 0) return null;
  if (!nextSession && noShowSessions.length === 0) return null;

  // All sessions today are auto-rejected — show a simplified list panel
  if (!nextSession) {
    return (
      <div style={{ width: "100%", position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 2, boxSizing: "border-box" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${noShowSessions[0].serviceKind === "exclusive_session" ? "/sesionexclusiva.png" : "/encuentroenvivo.png"})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.82) 100%)" }} />
        <div style={{ position: "relative", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fb923c", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#fb923c", fontWeight: 600 }}>
              {noShowSessions.length === 1 ? "Sesión no realizada hoy" : `${noShowSessions.length} sesiones no realizadas hoy`}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {noShowSessions.map((s) => (
              <ActionSessionRow key={s.id} session={s} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const msLeft = nextSession.scheduledAt.getTime() - now;
  const isPastStart = msLeft <= 0;
  const msLate = isPastStart ? Math.abs(msLeft) : 0;
  const toleranceExpired = isPastStart && msLate >= 15 * 60 * 1000;
  const canPrepare = msLeft <= 15 * 60 * 1000;

  const serviceLabel = nextSession.serviceKind === "exclusive_session" ? "exclusiva" : "en vivo";
  const buyerName = nextSession.buyerDisplayName ?? "Comprador";
  const countdownLabel = isPastStart ? "La sesión ya inició, llevas de retraso" : "Próxima sesión en";
  const countdownValue = isPastStart ? formatCountdown(Math.abs(msLeft)) : formatCountdown(msLeft);
  const otherSessions = todaySessions.filter((s) => s.id !== nextSession.id);
  const sessionCountLabel =
    otherSessions.length === 0
      ? "No tienes más sesiones agendadas para hoy"
      : otherSessions.length === 1
      ? "1 sesión más agendada hoy"
      : `${otherSessions.length} sesiones más agendadas hoy`;

  const buyerConnected = !!nextSession.preparingBuyerAt;
  const creatorConnected = !!nextSession.preparingCreatorAt;

  async function handlePrepare() {
    if (!nextSession || busy || !canPrepare) return;
    setBusy(true);
    try {
      if (nextSession.serviceKind === "meet_greet") {
        await setMeetGreetPreparing({ requestId: nextSession.id, role: "creator" });
      } else {
        await setExclusiveSessionPreparing({ requestId: nextSession.id, role: "creator" });
      }
      setPrepOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleReschedule() {
    if (!nextSession || busy) return;
    setBusy(true);
    try {
      if (nextSession.serviceKind === "meet_greet") {
        await requestMeetGreetReschedule({ requestId: nextSession.id, reason: reschedReason || null });
      } else {
        await requestExclusiveSessionReschedule({ requestId: nextSession.id, reason: reschedReason || null });
      }
      setReschedOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!nextSession || busy) return;
    setBusy(true);
    try {
      if (nextSession.serviceKind === "meet_greet") {
        await rejectMeetGreetRequest({ requestId: nextSession.id, rejectionReason: null });
      } else {
        await rejectExclusiveSessionRequest({ requestId: nextSession.id, rejectionReason: null });
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
          @keyframes creator-late-pulse {
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
          marginBottom: 2,
          boxSizing: "border-box",
        }}
      >
        {/* Background image — meet_greet */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "url(/encuentroenvivo.png)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: nextSession.serviceKind === "meet_greet" ? 1 : 0,
            transition: "opacity 0.75s ease",
          }}
        />
        {/* Background image — exclusive_session */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: "url(/sesionexclusiva.png)",
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: nextSession.serviceKind === "exclusive_session" ? 1 : 0,
            transition: "opacity 0.75s ease",
          }}
        />
        {/* dark overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(160deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.72) 100%)",
          }}
        />

        <div
          style={{
            position: "relative",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Row 1: buyer avatar + name (left) + countdown (right) */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Buyer avatar */}
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
              {nextSession.buyerAvatarUrl ? (
                <Image
                  src={nextSession.buyerAvatarUrl}
                  alt={buyerName}
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
                  {buyerName[0]}
                </div>
              )}
            </div>

            {/* Buyer name block */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontWeight: 500, marginBottom: 3 }}>
                Sesión {serviceLabel} con
              </div>
              <div
                style={{
                  fontSize: 17,
                  color: "#fff",
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {buyerName}
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
                  ...(isPastStart ? { animation: "creator-late-pulse 1.6s ease-in-out infinite" } : {}),
                }}
              >
                {countdownValue}
              </div>
              {isPastStart && (
                <div style={{ fontSize: 10, color: "#fb923c", marginTop: 3, lineHeight: 1.3, opacity: 0.85 }}>
                  Solo tienes 15 min de tolerancia
                </div>
              )}
            </div>
          </div>

          {/* Connection status notice */}
          {canPrepare && (buyerConnected || creatorConnected) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                padding: "7px 10px",
                borderRadius: 8,
                background: buyerConnected
                  ? "rgba(34,197,94,0.14)"
                  : "rgba(255,255,255,0.08)",
                border: buyerConnected
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
                  background: buyerConnected ? "#4ade80" : "rgba(255,255,255,0.45)",
                }}
              />
              <span style={{ fontSize: 12, color: "#fff", fontWeight: 500, lineHeight: 1.3 }}>
                {buyerConnected && !creatorConnected
                  ? "Tu comprador ya está en la sala, ¡únete!"
                  : creatorConnected && !buyerConnected
                  ? "Ya estás en la sala, esperando a tu comprador"
                  : "Ambos conectados en la sala"}
              </span>
            </div>
          )}

          {/* Session count + list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 500, marginBottom: 2 }}>
              {sessionCountLabel}
            </div>
            {otherSessions.map((s) =>
              s.status === "auto_rejected_no_show" ? (
                <ActionSessionRow key={s.id} session={s} />
              ) : (
                <SessionRow key={s.id} session={s} />
              )
            )}
          </div>

          {/* Action area */}
          {!toleranceExpired ? (
            !canPrepare ? (
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", lineHeight: 1.4 }}>
                Faltando 15 minutos podrás prepararte para entrar a tu sesión
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePrepare}
                disabled={busy}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  width: "100%",
                  height: 40,
                  borderRadius: 8,
                  border: "none",
                  background: busy ? "rgba(255,255,255,0.14)" : "transparent",
                  color: busy ? "rgba(255,255,255,0.35)" : "#fff",
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: busy ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                  letterSpacing: "-0.02em",
                }}
              >
                {!busy && (
                  <>
                    <span style={{
                      position: "absolute", inset: 0, borderRadius: "inherit",
                      background: "linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)",
                      opacity: nextSession.serviceKind === "meet_greet" ? 1 : 0,
                      transition: "opacity 0.75s ease",
                    }} />
                    <span style={{
                      position: "absolute", inset: 0, borderRadius: "inherit",
                      background: "linear-gradient(135deg, #be185d 0%, #ec4899 100%)",
                      opacity: nextSession.serviceKind === "exclusive_session" ? 1 : 0,
                      transition: "opacity 0.75s ease",
                    }} />
                  </>
                )}
                <span style={{ position: "relative", zIndex: 1 }}>
                  {busy ? "Procesando..." : "Prepararse"}
                </span>
              </button>
            )
          ) : reschedOpen ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <textarea
                value={reschedReason}
                onChange={(e) => setReschedReason(e.target.value)}
                placeholder="Motivo del cambio de fecha (opcional)"
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
                  {busy ? "Procesando..." : "Confirmar reagenda"}
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
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.4, fontWeight: 500 }}>
                El tiempo de tolerancia venció. Elige una opción:
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
                  Reagendar
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={busy}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 8,
                    border: "none",
                    background: busy ? "rgba(255,255,255,0.10)" : "rgba(239,68,68,0.22)",
                    color: busy ? "rgba(255,255,255,0.35)" : "#fca5a5",
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: busy ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    letterSpacing: "-0.01em",
                  }}
                >
                  {busy ? "Procesando..." : "Rechazar"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <MeetGreetPreparationFullscreen
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        role="creator"
        sessionId={nextSession.id}
        sessionType={nextSession.serviceKind}
        scheduledAtLabel={fmtScheduledAt(nextSession.scheduledAt)}
        durationMinutes={nextSession.durationMinutes}
      />
    </>
  );
}
