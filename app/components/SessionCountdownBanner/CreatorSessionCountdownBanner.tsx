"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/i18n/locales";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCreatorTodaySessions, type CreatorSession } from "@/lib/hooks/useCreatorTodaySessions";
import { setMeetGreetPreparing } from "@/lib/meetGreet/meetGreetRequests";
import { setExclusiveSessionPreparing } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { rejectMeetGreetRequest } from "@/lib/meetGreet/meetGreetRequests";
import { rejectExclusiveSessionRequest } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import { OPEN_SESSION_SCHEDULE_EVENT } from "./GlobalSessionScheduleOverlay";
import MeetGreetPreparationFullscreen from "@/app/components/meetGreet/MeetGreetPreparationFullscreen";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";

// Abre el panel de reagenda global (mismo SessionRequestOverlay del sidebar).
// El host GlobalSessionScheduleOverlay escucha este evento, trae el doc y lo abre.
function openSessionScheduleOverlay(
  sessionId: string,
  serviceKind: "meet_greet" | "exclusive_session"
) {
  window.dispatchEvent(
    new CustomEvent(OPEN_SESSION_SCHEDULE_EVENT, { detail: { sessionId, serviceKind } })
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "00:00:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function formatTime(d: Date, locale: string): string {
  return d.toLocaleTimeString(intlLocale(locale), { hour: "2-digit", minute: "2-digit", hour12: false });
}




// Self-contained row for auto_rejected_no_show sessions in the "other sessions" list
function ActionSessionRow({ session }: { session: CreatorSession }) {
  const locale = useLocale();
  const tSessions = useTranslations("sessions");
  const tCommon = useTranslations("common");
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

  if (done) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#fb923c", minWidth: 40, fontVariantNumeric: "tabular-nums" }}>
        {formatTime(session.scheduledAt, locale)}
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
        <button type="button" onClick={() => openSessionScheduleOverlay(session.id, session.serviceKind)} disabled={busy}
          style={{ height: 26, paddingInline: 8, borderRadius: 6, border: "none", background: busy ? "rgba(255,255,255,0.08)" : session.serviceKind === "meet_greet" ? "#2563eb" : "#be185d", color: busy ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {tSessions("reschedule")}
        </button>
        <button type="button" onClick={handleReject} disabled={busy}
          style={{ height: 26, paddingInline: 8, borderRadius: 6, border: "1px solid rgba(255,255,255,0.18)", background: busy ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.10)", color: busy ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.70)", fontSize: 11, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
          {tCommon("reject")}
        </button>
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: CreatorSession }) {
  const locale = useLocale();
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
        {formatTime(session.scheduledAt, locale)}
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
  const tSessions = useTranslations("sessions");
  const tCommon = useTranslations("common");
  const { nextSession, todaySessions, completedSession, loading } = useCreatorTodaySessions(uid);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const lateTriggeredRef = useRef<Set<number>>(new Set());
  const [countdown321, setCountdown321] = useState<number | null>(null);
  const countdown321Triggered = useRef(false);
  // Ref updated every render after variable computation — lets pre-early-return effects read fresh values
  const preSessionCtxRef = useRef<{ secondsLeft: number | null; inProgress: boolean }>({ secondsLeft: null, inProgress: false });
  const [listCollapsed, setListCollapsed] = useState(() => {
    try { return localStorage.getItem("vibra:creator-list-collapsed") === "1"; } catch { return false; }
  });

  function toggleListCollapsed() {
    setListCollapsed(v => {
      const next = !v;
      try { localStorage.setItem("vibra:creator-list-collapsed", next ? "1" : "0"); } catch { /* */ }
      return next;
    });
  }

  // Descarte de la tarjeta de sesión completada (persistido por sesión).
  const [standaloneCompletedDismissed, setStandaloneCompletedDismissed] = useState(() => {
    if (!completedSession) return false;
    try { return localStorage.getItem(`dismissed_session_${completedSession.id}`) === "1"; } catch { return false; }
  });
  useEffect(() => {
    if (!completedSession) return;
    try {
      setStandaloneCompletedDismissed(localStorage.getItem(`dismissed_session_${completedSession.id}`) === "1");
    } catch { /* */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSession?.id]);

  useEffect(() => {
    lateTriggeredRef.current.clear();
    countdown321Triggered.current = false;
    setCountdown321(null);
  }, [nextSession?.id]);

  useEffect(() => {
    if (!nextSession) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextSession]);

  // Trigger 3-2-1 when pre-session countdown reaches 0 (reads ref so no TDZ issues)
  useEffect(() => {
    const { secondsLeft, inProgress } = preSessionCtxRef.current;
    if (secondsLeft !== 0 || countdown321Triggered.current || prepOpen || inProgress) return;
    countdown321Triggered.current = true;
    setCountdown321(3);
  }, [now, prepOpen]);

  // 3-2-1 countdown: 3→2→1→open prep room
  useEffect(() => {
    if (countdown321 === null) return;
    if (countdown321 === 0) {
      setCountdown321(null);
      setPrepOpen(true);
      return;
    }
    const t = setTimeout(() => setCountdown321((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [countdown321]);

  // El panel de la videollamada / descarga vive según el estado LOCAL (prepOpen)
  // de cada quien. Se renderiza en posición estable (primer hijo) en todos los
  // returns para que NO se desmonte cuando la sesión pasa a "completed" ni cuando
  // el otro participante cierra su panel. Usa la sesión activa o, tras completarse,
  // la completada (mismo id → sin remontaje). Cada quien lo cierra cuando quiera.
  const activeCallSession = nextSession ?? completedSession;
  const callFullscreen = prepOpen && activeCallSession ? (
    <MeetGreetPreparationFullscreen
      open
      onClose={() => setPrepOpen(false)}
      role="creator"
      sessionId={activeCallSession.id}
      sessionType={activeCallSession.serviceKind}
    />
  ) : null;

  return (
    <>
      {callFullscreen}
      {(() => {

  const noShowSessions = todaySessions.filter((s) => s.status === "auto_rejected_no_show");

  // Tarjeta de sesión completada (descarga + tache), cuando ya no hay activa.
  if (!loading && !nextSession && noShowSessions.length === 0 && completedSession && !standaloneCompletedDismissed) {
    const cs = completedSession;
    const daysLeft = Math.max(0, 30 - Math.floor((now - cs.scheduledAt.getTime()) / (1000 * 60 * 60 * 24)));
    const canDownload = daysLeft > 0;
    const buyerNm = cs.buyerDisplayName ?? "Comprador";
    const bg = cs.serviceKind === "exclusive_session" ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp";
    const accent = cs.serviceKind === "exclusive_session";
    async function handleDownloadCompleted() {
      try {
        const url = await callGetRecordingDownloadUrl({ sessionId: cs.id, sessionType: cs.serviceKind });
        window.location.href = url;
      } catch (e) { console.error(e); }
    }
    function dismissCompleted() {
      try { localStorage.setItem(`dismissed_session_${cs.id}`, "1"); } catch { /* */ }
      setStandaloneCompletedDismissed(true);
    }
    return (
      <div style={{ width: "100%", position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 2, boxSizing: "border-box" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${bg})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.80) 100%)" }} />
        <button type="button" onClick={dismissCompleted} style={{ position: "absolute", top: 10, insetInlineEnd: 10, border: "none", background: "none", color: "rgba(255,255,255,0.45)", fontSize: 16, cursor: "pointer", padding: "0 2px", zIndex: 2, fontFamily: "inherit", lineHeight: 1 }} aria-label={tCommon("close")}>✕</button>
        <div style={{ position: "relative", padding: "16px 40px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.10)", border: "2px solid rgba(34,197,94,0.50)" }}>
              {cs.buyerAvatarUrl
                ? <Image src={cs.buyerAvatarUrl} alt={buyerNm} width={44} height={44} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 18, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>{buyerNm[0]}</div>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", marginBottom: 2 }}>{tSessions("sessionWith")}</div>
              <div style={{ fontSize: 16, color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{buyerNm}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>{tSessions("sessionCompleted")}</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5, textAlign: "center" }}>
            {canDownload
              ? tSessions("downloadWindow", { days: daysLeft })
              : tSessions("downloadLinkExpired", { days: 30 })}
          </div>
          <button type="button" onClick={handleDownloadCompleted} disabled={!canDownload} style={{ width: "100%", height: 38, borderRadius: 8, border: "none", background: !canDownload ? "rgba(255,255,255,0.08)" : accent ? "rgba(236,72,153,0.22)" : "rgba(59,130,246,0.22)", color: !canDownload ? "rgba(255,255,255,0.30)" : accent ? "#f9a8d4" : "#93c5fd", fontSize: 14, fontWeight: 600, cursor: !canDownload ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "-0.01em" }}>
            {tSessions("downloadSession")}
          </button>
        </div>
      </div>
    );
  }

  if (loading || todaySessions.length === 0) return null;
  if (!nextSession && noShowSessions.length === 0) return null;

  // All sessions today are auto-rejected — show a simplified list panel
  if (!nextSession) {
    return (
      <div style={{ width: "100%", position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 2, boxSizing: "border-box" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${noShowSessions[0].serviceKind === "exclusive_session" ? "/sesionexclusiva.webp" : "/encuentroenvivo.webp"})`, backgroundSize: "cover", backgroundPosition: "center" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.82) 100%)" }} />
        <div style={{ position: "relative", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fb923c", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#fb923c", fontWeight: 600 }}>
              {tSessions("notHeldTodayCount", { count: noShowSessions.length })}
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
  const msLate = isPastStart ? Math.min(Math.abs(msLeft), 15 * 60 * 1000) : 0;

  // When startedAt is set, both joined LiveKit — switch to descending session timer
  const sessionInProgress = !!nextSession.startedAt;

  // La tolerancia (no-show) y la preparación sólo aplican ANTES de arrancar.
  const toleranceExpired = isPastStart && !sessionInProgress && msLate >= 15 * 60 * 1000;
  const canPrepare = !sessionInProgress && msLeft <= 15 * 60 * 1000;
  const durationMs = (nextSession.durationMinutes ?? 30) * 60 * 1000;
  const sessionDeadline = sessionInProgress ? nextSession.startedAt!.getTime() + durationMs : null;
  const msRemaining = sessionDeadline != null ? Math.max(0, sessionDeadline - now) : null;

  const buyerName = nextSession.buyerDisplayName ?? "Comprador";
  const otherSessions = todaySessions.filter((s) => s.id !== nextSession.id);
  const sessionCountLabel = tSessions("moreSessionsToday", { count: otherSessions.length });

  const buyerConnected = !!nextSession.preparingBuyerAt;
  const creatorConnected = !!nextSession.preparingCreatorAt;

  // Retraso: el reloj sólo corre contra quien falta. Yo soy el creador.
  //  · Ambos en sala → el reloj se detiene (sin retraso) hasta que arranca la sesión.
  //  · Yo en sala y falta el comprador → él lleva el retraso.
  //  · No estoy en sala y pasó la hora → el retraso es mío.
  const bothConnected = buyerConnected && creatorConnected;
  const otherIsLate = isPastStart && creatorConnected && !buyerConnected;
  const countdownFrozen = !sessionInProgress && bothConnected;
  const countdownLabel = sessionInProgress
    ? tSessions("inProgress")
    : countdownFrozen
    ? tSessions("inRoom")
    : toleranceExpired
    ? tSessions("timeIsUp")
    : otherIsLate
    ? tSessions("otherIsLate", { name: buyerName })
    : isPastStart
    ? tSessions("youAreLate")
    : tSessions("startsInShort");
  const countdownValue = sessionInProgress
    ? formatCountdown(msRemaining ?? 0)
    : isPastStart
    ? formatCountdown(msLate)
    : formatCountdown(msLeft);

  // Pre-session synchronized countdown: starts when both are preparing
  const prepT0 =
    buyerConnected && creatorConnected && nextSession.preparingBuyerAt && nextSession.preparingCreatorAt
      ? Math.max(nextSession.preparingBuyerAt.getTime(), nextSession.preparingCreatorAt.getTime())
      : null;
  const preSessionSecondsLeft =
    prepT0 !== null && !sessionInProgress && !prepOpen
      ? Math.max(0, Math.ceil(((prepT0 + 30_000) - now) / 1000))
      : null;
  // Update ref so pre-early-return effects can read these values
  preSessionCtxRef.current = { secondsLeft: preSessionSecondsLeft, inProgress: sessionInProgress };

  async function handlePrepare() {
    if (!nextSession || busy || !canPrepare) return;
    setBusy(true);
    try {
      if (nextSession.serviceKind === "meet_greet") {
        await setMeetGreetPreparing({ requestId: nextSession.id, role: "creator" });
      } else {
        await setExclusiveSessionPreparing({ requestId: nextSession.id, role: "creator" });
      }
      // Do NOT open prep room here — it opens after the 3-2-1 countdown
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
        {/* ── Core section: background image stays fixed here ── */}
        <div style={{ position: "relative" }}>
          {/* Background image — meet_greet */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "url(/encuentroenvivo.webp)",
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
              backgroundImage: "url(/sesionexclusiva.webp)",
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
                  width: 44,
                  height: 44,
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
                    width={44}
                    height={44}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 17,
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
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontWeight: 500, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {tSessions("sessionWith")}
                </div>
                <div
                  style={{
                    fontSize: 16,
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
              <div style={{ flexShrink: 0, textAlign: "end", maxWidth: "40%" }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    marginBottom: 2,
                    lineHeight: 1.3,
                    color: sessionInProgress || countdownFrozen ? "#4ade80" : isPastStart ? "#fb923c" : "rgba(255,255,255,0.65)",
                  }}
                >
                  {countdownLabel}
                </div>
                {!countdownFrozen && (
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 500,
                      letterSpacing: "-0.03em",
                      fontVariantNumeric: "tabular-nums",
                      textShadow: "0 1px 8px rgba(0,0,0,0.5)",
                      color: sessionInProgress
                        ? (msRemaining != null && msRemaining <= 60000 ? "#ef4444" : msRemaining != null && msRemaining <= 300000 ? "#f59e0b" : "#4ade80")
                        : isPastStart ? "#fb923c" : "#fff",
                      ...(isPastStart && !sessionInProgress && !toleranceExpired ? { animation: "creator-late-pulse 1.6s ease-in-out infinite" } : {}),
                    }}
                  >
                    {countdownValue}
                  </div>
                )}
                {isPastStart && !sessionInProgress && !countdownFrozen && !toleranceExpired && (
                  <div style={{ fontSize: 10, color: "#fb923c", marginTop: 3, lineHeight: 1.3, opacity: 0.85 }}>
                    {tSessions("toleranceMinutes", { minutes: 15 })}
                  </div>
                )}
              </div>
            </div>

          {/* Connection status notice — sin contenedor, centrado */}
          {canPrepare && (buyerConnected || creatorConnected) && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: buyerConnected ? "#4ade80" : "rgba(255,255,255,0.45)",
                }}
              />
              <span style={{ fontSize: 12, color: "#fff", fontWeight: 500, lineHeight: 1.3, textAlign: "center" }}>
                {buyerConnected && !creatorConnected
                  ? tSessions("buyerInRoomJoin")
                  : creatorConnected && !buyerConnected
                  ? tSessions("youAreInRoomWaitingBuyer")
                  : tSessions("bothConnectedInRoom")}
              </span>
            </div>
          )}

          {/* Action area */}
          {sessionInProgress ? (
            <button
              type="button"
              onClick={() => setPrepOpen(true)}
              style={{
                position: "relative",
                overflow: "hidden",
                width: "100%",
                height: 40,
                borderRadius: 8,
                border: "none",
                background: "transparent",
                color: "#fff",
                cursor: "pointer",
                fontSize: 15,
                fontWeight: 600,
                fontFamily: "inherit",
                letterSpacing: "-0.02em",
              }}
            >
              <span style={{
                position: "absolute", inset: 0, borderRadius: "inherit",
                background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)",
                opacity: nextSession.serviceKind === "meet_greet" ? 1 : 0,
                transition: "opacity 0.75s ease",
              }} />
              <span style={{
                position: "absolute", inset: 0, borderRadius: "inherit",
                background: "linear-gradient(135deg, #15803d 0%, #16a34a 100%)",
                opacity: nextSession.serviceKind === "exclusive_session" ? 1 : 0,
                transition: "opacity 0.75s ease",
              }} />
              <span style={{ position: "relative", zIndex: 1 }}>{tSessions("openSession")}</span>
            </button>
          ) : !toleranceExpired ? (
            <>
              {/* Info notice shown when not yet time to prepare */}
              {!canPrepare && (
                <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
                  <svg
                    width={15}
                    height={15}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={nextSession.serviceKind === "exclusive_session" ? "#f9a8d4" : "#93c5fd"}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ flexShrink: 0, marginTop: 1 }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="8.01" />
                    <line x1="12" y1="12" x2="12" y2="16" />
                  </svg>
                  <span style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.60)",
                    lineHeight: 1.4,
                  }}>
                    {tSessions("prepareHint", { minutes: 15 })}
                  </span>
                </div>
              )}

              {preSessionSecondsLeft !== null ? (
                /* Both prepared — synchronized countdown */
                <div style={{ textAlign: "center", padding: "6px 0" }}>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
                    {tSessions("bothInRoom")}
                  </div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                    {preSessionSecondsLeft}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>
                    {tSessions("startsIn")}
                  </div>
                </div>
              ) : creatorConnected ? (
                /* Creator prepared, waiting for buyer */
                <div style={{ textAlign: "center", padding: "8px 0", fontSize: 13, color: "rgba(255,255,255,0.55)", fontStyle: "italic" }}>
                  {tSessions("inRoomWaitingBuyer")}
                </div>
              ) : (
                /* Not yet prepared */
                <button
                  type="button"
                  onClick={handlePrepare}
                  disabled={!canPrepare || busy}
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    width: "100%",
                    height: 40,
                    borderRadius: 8,
                    border: "none",
                    background: !canPrepare || busy ? "rgba(255,255,255,0.14)" : "transparent",
                    color: !canPrepare || busy ? "rgba(255,255,255,0.35)" : "#fff",
                    cursor: !canPrepare || busy ? "not-allowed" : "pointer",
                    fontSize: 15,
                    fontWeight: 600,
                    fontFamily: "inherit",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {canPrepare && !busy && (
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
              )}
            </>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.4, fontWeight: 500 }}>
                {tSessions("toleranceExpired")}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => openSessionScheduleOverlay(nextSession.id, nextSession.serviceKind)}
                  disabled={busy}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 6,
                    border: "none",
                    background: nextSession.serviceKind === "meet_greet" ? "#2563eb" : "#be185d",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: busy ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {tSessions("reschedule")}
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={busy}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 6,
                    border: "none",
                    background: "rgba(255,255,255,0.10)",
                    color: "rgba(255,255,255,0.70)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: busy ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  {busy ? "Procesando..." : "Rechazar"}
                </button>
              </div>
            </div>
          )}

          {/* Session count label + toggle — stays inside the background section */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
              {sessionCountLabel}
            </div>
            {otherSessions.length > 0 && (
              <button
                type="button"
                onClick={toggleListCollapsed}
                style={{
                  background: "none",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: 0,
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                {listCollapsed ? "Ver" : "Ocultar"}
              </button>
            )}
          </div>
        </div>
        </div>

        {/* ── Session list: outside the background so el fondo no se redimensiona ── */}
        {!listCollapsed && otherSessions.length > 0 && (
          <div
            style={{
              background: "rgba(0,0,0,0.72)",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              padding: "8px 18px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {otherSessions.map((s) =>
              s.status === "auto_rejected_no_show" ? (
                <ActionSessionRow key={s.id} session={s} />
              ) : (
                <SessionRow key={s.id} session={s} />
              )
            )}
          </div>
        )}
      </div>

      {countdown321 !== null && createPortal(
        <div style={{
          position: "fixed", inset: 0, zIndex: 20000,
          background: "rgba(0,0,0,0.92)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <style>{`
            @keyframes cd321-pop {
              from { transform: scale(0.3); opacity: 0; }
              to   { transform: scale(1);   opacity: 1; }
            }
          `}</style>
          <div
            key={countdown321}
            style={{
              fontSize: 160, fontWeight: 900, color: "#fff",
              letterSpacing: "-0.06em", lineHeight: 1,
              animation: "cd321-pop 0.3s cubic-bezier(0.34,1.56,0.64,1)",
            }}
          >
            {countdown321}
          </div>
          <div style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>
            {tSessions("aboutToStart")}
          </div>
        </div>,
        document.body
      )}
    </>
  );
      })()}
    </>
  );
}
