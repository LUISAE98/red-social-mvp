"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import { useBuyerNextSession, type BuyerNextSession } from "@/lib/hooks/useBuyerNextSession";
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
import { callGetRecordingDownloadUrl, callForceCompleteSession } from "@/lib/liveKit/sessionLifecycle";

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

// ── Sub-component: download section shown at the bottom of the panel ──────────
function CompletedDownloadSection({
  completed,
  now,
}: {
  completed: BuyerNextSession;
  now: number;
}) {
  const [dismissedCompleted, setDismissedCompleted] = useState(() => {
    try { return localStorage.getItem(`dismissed_session_${completed.id}`) === "1"; } catch { return false; }
  });
  const [downloadBusy, setDownloadBusy] = useState(false);

  if (dismissedCompleted) return null;

  const daysLeft = Math.max(
    0,
    30 - Math.floor((now - completed.scheduledAt.getTime()) / (1000 * 60 * 60 * 24))
  );
  const canDownload = daysLeft > 0;

  async function handleDownload() {
    if (downloadBusy) return;
    setDownloadBusy(true);
    try {
      const url = await callGetRecordingDownloadUrl({ sessionId: completed.id, sessionType: completed.serviceKind });
      window.location.href = url;
    } catch (e) {
      console.error(e);
    } finally {
      setDownloadBusy(false);
    }
  }

  function dismiss() {
    try { localStorage.setItem(`dismissed_session_${completed.id}`, "1"); } catch { /* */ }
    setDismissedCompleted(true);
  }

  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.12)",
        paddingTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Header row: label + X */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
          <span style={{ fontSize: 13, color: "#fff", fontWeight: 600 }}>Sesión anterior completada</span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            border: "none",
            background: "rgba(255,255,255,0.12)",
            color: "rgba(255,255,255,0.60)",
            fontSize: 12,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
          aria-label="Cerrar sección de descarga"
        >
          ✕
        </button>
      </div>

      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
        {canDownload
          ? `Descarga tu grabación. Tienes ${daysLeft} día${daysLeft === 1 ? "" : "s"} para hacerlo, después ya no se podrá.`
          : "El enlace de descarga ha expirado (30 días)."}
      </div>

      <button
        type="button"
        onClick={handleDownload}
        disabled={!canDownload || downloadBusy}
        style={{
          width: "100%",
          height: 38,
          borderRadius: 8,
          border: "none",
          background: !canDownload
            ? "rgba(255,255,255,0.08)"
            : completed.serviceKind === "exclusive_session"
            ? "rgba(236,72,153,0.22)"
            : "rgba(59,130,246,0.22)",
          color: !canDownload
            ? "rgba(255,255,255,0.30)"
            : completed.serviceKind === "exclusive_session"
            ? "#f9a8d4"
            : "#93c5fd",
          fontSize: 14,
          fontWeight: 600,
          cursor: !canDownload || downloadBusy ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          letterSpacing: "-0.01em",
          opacity: downloadBusy ? 0.7 : 1,
        }}
      >
        {downloadBusy ? "Descargando..." : "Descargar grabación"}
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function SessionCountdownBanner({ uid }: { uid: string }) {
  const tServices = useTranslations("services");
  const tCommon = useTranslations("common");
  const tSessions = useTranslations("sessions");
  const locale = useLocale();

  const { session, completedSession, loading } = useBuyerNextSession(uid);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);
  const [reschedReason, setReschedReason] = useState("");
  const lateTriggeredRef = useRef<Set<number>>(new Set());
  const [countdown321, setCountdown321] = useState<number | null>(null);
  const countdown321Triggered = useRef(false);
  const preSessionCtxRef = useRef<{ secondsLeft: number | null; inProgress: boolean }>({ secondsLeft: null, inProgress: false });
  const [reminderOpen, setReminderOpen] = useState(false);
  const reminderTriggeredRef = useRef<Set<string>>(new Set());
  const reminderCtxRef = useRef<{ canPrepare: boolean; connected: boolean; inProgress: boolean; isPastStart: boolean; msLate: number }>({ canPrepare: false, connected: false, inProgress: false, isPastStart: false, msLate: 0 });
  // session_incomplete panel states
  const [incompleteDismissed, setIncompleteDismissed] = useState(false);
  const [forceCompleting, setForceCompleting] = useState(false);
  const [forceCompleted, setForceCompleted] = useState(false);

  // Track whether the standalone completed card was dismissed (only when there's no active session)
  const [standaloneCompletedDismissed, setStandaloneCompletedDismissed] = useState(() => {
    if (!completedSession) return false;
    try { return localStorage.getItem(`dismissed_session_${completedSession.id}`) === "1"; } catch { return false; }
  });

  useEffect(() => {
    lateTriggeredRef.current.clear();
    reminderTriggeredRef.current.clear();
    setReschedOpen(false);
    setReschedReason("");
    setIncompleteDismissed(false);
    setForceCompleting(false);
    setForceCompleted(false);
    countdown321Triggered.current = false;
    setCountdown321(null);
    setReminderOpen(false);
  }, [session?.id]);

  useEffect(() => {
    if (!completedSession) return;
    try {
      setStandaloneCompletedDismissed(localStorage.getItem(`dismissed_session_${completedSession.id}`) === "1");
    } catch { /* */ }
  }, [completedSession?.id]);

  useEffect(() => {
    const target = session ?? completedSession;
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session, completedSession]);

  // Trigger 3-2-1 when pre-session countdown reaches 0 (reads ref to avoid TDZ)
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

  // Session reminder: open panel when prepare window activates + every 5 min of delay
  useEffect(() => {
    const ctx = reminderCtxRef.current;
    if (ctx.inProgress || prepOpen || ctx.connected) return;
    if (!ctx.canPrepare) return;

    // First trigger: when prepare window first opens (before session start)
    if (!ctx.isPastStart && !reminderTriggeredRef.current.has("prep_window")) {
      reminderTriggeredRef.current.add("prep_window");
      setReminderOpen(true);
      return;
    }

    // Periodic trigger: every 5 min of delay
    if (ctx.msLate > 0) {
      const bucket = Math.floor(ctx.msLate / (5 * 60 * 1000)) * 5;
      const key = `late_${bucket}`;
      if (bucket > 0 && !reminderTriggeredRef.current.has(key)) {
        reminderTriggeredRef.current.add(key);
        setReminderOpen(true);
      }
    }
  }, [now, prepOpen]);

  if (loading) return null;

  // If there's no active session and no completed session (or it's dismissed), show nothing
  if (!session && (!completedSession || standaloneCompletedDismissed)) return null;

  // ── Standalone download card (no active session, only completed) ──
  if (!session && completedSession) {
    const daysLeft = Math.max(
      0,
      30 - Math.floor((now - completedSession.scheduledAt.getTime()) / (1000 * 60 * 60 * 24))
    );
    const canDownload = daysLeft > 0;
    const bgImage = BG_IMAGE[completedSession.serviceKind];
    const creatorName = completedSession.creatorDisplayName ?? "Creador";

    async function handleDownload() {
      if (!completedSession) return;
      try {
        const url = await callGetRecordingDownloadUrl({ sessionId: completedSession.id, sessionType: completedSession.serviceKind });
        window.location.href = url;
      } catch (e) { console.error(e); }
    }

    function dismissStandalone() {
      if (!completedSession) return;
      try { localStorage.setItem(`dismissed_session_${completedSession.id}`, "1"); } catch { /* */ }
      setStandaloneCompletedDismissed(true);
    }

    return (
      <div style={{ width: "100%", position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 2, boxSizing: "border-box", backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.80) 100%)" }} />
        <button type="button" onClick={dismissStandalone} style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.70)", fontSize: 14, cursor: "pointer", display: "grid", placeItems: "center", zIndex: 2, fontFamily: "inherit" }} aria-label="Cerrar">✕</button>
        <div style={{ position: "relative", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.10)", border: "2px solid rgba(34,197,94,0.50)" }}>
              {completedSession.creatorAvatarUrl
                ? <Image src={completedSession.creatorAvatarUrl} alt={creatorName} width={44} height={44} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 18, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>{creatorName[0]}</div>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", marginBottom: 2 }}>Sesión con</div>
              <div style={{ fontSize: 16, color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creatorName}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(34,197,94,0.16)", border: "1px solid rgba(34,197,94,0.30)", borderRadius: 20, padding: "4px 10px", flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }} />
              <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>Completada</span>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
            {canDownload
              ? `Descarga tu sesión grabada. Tienes ${daysLeft} día${daysLeft === 1 ? "" : "s"} para hacerlo, después ya no se podrá.`
              : "El enlace de descarga ha expirado (30 días)."}
          </div>
          <button type="button" onClick={handleDownload} disabled={!canDownload} style={{ width: "100%", height: 38, borderRadius: 8, border: "none", background: !canDownload ? "rgba(255,255,255,0.08)" : completedSession.serviceKind === "exclusive_session" ? "rgba(236,72,153,0.22)" : "rgba(59,130,246,0.22)", color: !canDownload ? "rgba(255,255,255,0.30)" : completedSession.serviceKind === "exclusive_session" ? "#f9a8d4" : "#93c5fd", fontSize: 14, fontWeight: 600, cursor: !canDownload ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "-0.01em" }}>
            Descargar grabación
          </button>
        </div>
      </div>
    );
  }

  // ── Session incomplete panel (< 80% of duration elapsed) ─────────────────
  if (session!.status === "session_incomplete") {
    async function handleForceComplete() {
      if (!session || forceCompleting) return;
      setForceCompleting(true);
      try {
        await callForceCompleteSession({ sessionId: session.id, sessionType: session.serviceKind });
        setForceCompleted(true);
      } catch (e) { console.error(e); } finally { setForceCompleting(false); }
    }

    if (incompleteDismissed) return null;

    const bgImage = BG_IMAGE[session!.serviceKind];
    const creatorName = session!.creatorDisplayName ?? "Creador";

    return (
      <div style={{ width: "100%", position: "relative", borderRadius: 12, overflow: "hidden", marginBottom: 2, boxSizing: "border-box", backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.80) 100%)" }} />
        <div style={{ position: "relative", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.10)", border: "2px solid rgba(250,204,21,0.40)" }}>
              {session!.creatorAvatarUrl
                ? <Image src={session!.creatorAvatarUrl} alt={creatorName} width={40} height={40} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>{creatorName[0]}</div>
              }
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", marginBottom: 2 }}>Sesión con</div>
              <div style={{ fontSize: 15, color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creatorName}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(250,204,21,0.14)", border: "1px solid rgba(250,204,21,0.28)", borderRadius: 20, padding: "4px 10px", flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fde047" }} />
              <span style={{ fontSize: 11, color: "#fde047", fontWeight: 600 }}>Sesión corta</span>
            </div>
          </div>

          {forceCompleted ? (
            /* After force-complete: show download */
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                ¡Sesión marcada como completada! Ya puedes descargar la grabación.
              </div>
              <CompletedDownloadSection completed={session!} now={now} />
              <button type="button" onClick={() => setIncompleteDismissed(true)} style={{ width: "100%", height: 36, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "rgba(255,255,255,0.55)", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                Cerrar
              </button>
            </div>
          ) : (
            /* Choice panel */
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", lineHeight: 1.5 }}>
                La sesión terminó antes de lo programado. ¿Qué pasó?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={handleForceComplete} disabled={forceCompleting}
                  style={{ flex: 1, height: 40, borderRadius: 8, border: "none", background: forceCompleting ? "rgba(255,255,255,0.10)" : "rgba(34,197,94,0.22)", color: forceCompleting ? "rgba(255,255,255,0.35)" : "#86efac", fontSize: 13, fontWeight: 600, cursor: forceCompleting ? "not-allowed" : "pointer", fontFamily: "inherit", lineHeight: 1.2 }}>
                  {forceCompleting ? "Procesando..." : "Concluyó con éxito"}
                </button>
                <button type="button" onClick={() => setIncompleteDismissed(true)}
                  style={{ flex: 1, height: 40, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.60)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.2 }}>
                  Reportar problema
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Active session countdown (session exists) ──────────────────────────────
  const msLeft = session!.scheduledAt.getTime() - now;
  const isPastStart = msLeft <= 0;
  const msLate = isPastStart ? Math.abs(msLeft) : 0;
  const toleranceExpired = isPastStart && msLate >= 15 * 60 * 1000;
  const canPrepare = msLeft <= 15 * 60 * 1000;

  // When startedAt is set, both joined LiveKit — switch to descending session timer
  const sessionInProgress = !!session!.startedAt;
  const durationMs = (session!.durationMinutes ?? 30) * 60 * 1000;
  const sessionDeadline = sessionInProgress ? session!.startedAt!.getTime() + durationMs : null;
  const msRemaining = sessionDeadline != null ? Math.max(0, sessionDeadline - now) : null;

  const sessionLabel = "Sesión con";
  const creatorName = session!.creatorDisplayName ?? tSessions("creatorFallback");
  const bgImage = BG_IMAGE[session!.serviceKind];
  const btnBg = BTN_BG[session!.serviceKind];

  const countdownLabel = sessionInProgress
    ? tServices("sessionTimeRemaining")
    : isPastStart ? tServices("sessionLate") : tServices("sessionStartsIn");
  const countdownValue = sessionInProgress
    ? formatCountdown(msRemaining ?? 0)
    : isPastStart ? formatCountdown(Math.abs(msLeft)) : formatCountdown(msLeft);

  const creatorConnected = !!session!.preparingCreatorAt;
  const buyerConnected = !!session!.preparingBuyerAt;

  // Pre-session synchronized countdown
  const prepT0 =
    buyerConnected && creatorConnected && session!.preparingBuyerAt && session!.preparingCreatorAt
      ? Math.max(session!.preparingBuyerAt.getTime(), session!.preparingCreatorAt.getTime())
      : null;
  const preSessionSecondsLeft =
    prepT0 !== null && !sessionInProgress && !prepOpen
      ? Math.max(0, Math.ceil(((prepT0 + 60_000) - now) / 1000))
      : null;
  preSessionCtxRef.current = { secondsLeft: preSessionSecondsLeft, inProgress: sessionInProgress };
  reminderCtxRef.current = { canPrepare, connected: buyerConnected, inProgress: sessionInProgress, isPastStart, msLate };

  async function handlePrepare() {
    if (!session || busy || !canPrepare) return;
    setBusy(true);
    try {
      if (session.serviceKind === "meet_greet") {
        await setMeetGreetPreparing({ requestId: session.id, role: "buyer" });
      } else {
        await setExclusiveSessionPreparing({ requestId: session.id, role: "buyer" });
      }
      // Do NOT open prep room here — it opens after the 3-2-1 countdown
    } catch (e) { console.error(e); } finally { setBusy(false); }
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
    } catch (e) { console.error(e); } finally { setBusy(false); }
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
    } catch (e) { console.error(e); } finally { setBusy(false); }
  }

  // ── Auto-rejected no-show: tolerance expired, backend already rejected ────────
  if (session!.status === "auto_rejected_no_show") {
    return (
      <div
        style={{
          width: "100%",
          position: "relative",
          borderRadius: 12,
          overflow: "hidden",
          marginBottom: 2,
          boxSizing: "border-box",
          backgroundImage: `url(${bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.60) 0%, rgba(0,0,0,0.80) 100%)" }} />
        <div style={{ position: "relative", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Header: avatar + name + badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.10)", border: "2px solid rgba(251,146,60,0.40)" }}>
              {session!.creatorAvatarUrl ? (
                <Image src={session!.creatorAvatarUrl} alt={creatorName} width={52} height={52} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>
                  {creatorName[0]}
                </div>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontWeight: 500, marginBottom: 3 }}>{sessionLabel}</div>
              <div style={{ fontSize: 17, color: "#fff", fontWeight: 700, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creatorName}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(251,146,60,0.14)", border: "1px solid rgba(251,146,60,0.28)", borderRadius: 20, padding: "4px 10px", flexShrink: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fb923c" }} />
              <span style={{ fontSize: 11, color: "#fb923c", fontWeight: 600 }}>No se realizó</span>
            </div>
          </div>

          {/* Action area */}
          <div>
            {reschedOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea
                  value={reschedReason}
                  onChange={(e) => setReschedReason(e.target.value)}
                  placeholder="Motivo del cambio de fecha (opcional)"
                  rows={2}
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, color: "#fff", fontSize: 13, padding: "8px 10px", resize: "none", fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={handleReschedule} disabled={busy}
                    style={{ flex: 1, height: 38, borderRadius: 8, border: "none", background: busy ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.16)", color: busy ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                    {busy ? tCommon("processing") : "Confirmar reagenda"}
                  </button>
                  <button type="button" onClick={() => setReschedOpen(false)} disabled={busy}
                    style={{ height: 38, paddingInline: 14, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "rgba(255,255,255,0.60)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.4, fontWeight: 500 }}>
                  La sesión no se realizó dentro del tiempo de tolerancia. ¿Qué quieres hacer?
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => setReschedOpen(true)} disabled={busy}
                    style={{ flex: 1, height: 40, borderRadius: 8, border: "1px solid rgba(255,255,255,0.28)", background: "rgba(255,255,255,0.10)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "-0.02em" }}>
                    Reagendar
                  </button>
                  <button type="button" onClick={handleRefund} disabled={busy}
                    style={{ flex: 1, height: 40, borderRadius: 8, border: "none", background: busy ? "rgba(255,255,255,0.10)" : "rgba(239,68,68,0.22)", color: busy ? "rgba(255,255,255,0.35)" : "#fca5a5", fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "-0.01em" }}>
                    {busy ? tCommon("processing") : "Solicitar devolución"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {completedSession && <CompletedDownloadSection completed={completedSession} now={now} />}
        </div>
      </div>
    );
  }

  return (
    <>
      {isPastStart && !sessionInProgress && (
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
          marginBottom: 2,
          boxSizing: "border-box",
          backgroundImage: `url(${bgImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* dark overlay */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.72) 100%)" }} />

        <div style={{ position: "relative", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Row 1: avatar + name + countdown */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.10)", border: "2px solid rgba(255,255,255,0.22)" }}>
              {session!.creatorAvatarUrl ? (
                <Image src={session!.creatorAvatarUrl} alt={creatorName} width={44} height={44} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 18, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>
                  {creatorName[0]}
                </div>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontWeight: 500, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sessionLabel}</div>
              <div style={{ fontSize: 16, color: "#fff", fontWeight: 700, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creatorName}</div>
            </div>

            <div style={{ flexShrink: 0, textAlign: "right", maxWidth: "40%" }}>
              <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 2, lineHeight: 1.3, color: sessionInProgress ? "#4ade80" : isPastStart ? "#fb923c" : "rgba(255,255,255,0.65)" }}>
                {countdownLabel}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", textShadow: "0 1px 8px rgba(0,0,0,0.5)", color: sessionInProgress ? (msRemaining != null && msRemaining <= 60000 ? "#ef4444" : msRemaining != null && msRemaining <= 300000 ? "#f59e0b" : "#4ade80") : isPastStart ? "#fb923c" : "#fff", ...(isPastStart && !sessionInProgress ? { animation: "session-late-pulse 1.6s ease-in-out infinite" } : {}) }}>
                {countdownValue}
              </div>
              {isPastStart && !sessionInProgress && (
                <div style={{ fontSize: 10, color: "#fb923c", marginTop: 3, lineHeight: 1.3, opacity: 0.85 }}>
                  15 min de tolerancia
                </div>
              )}
            </div>
          </div>

          {/* Connection status notice */}
          {canPrepare && (creatorConnected || buyerConnected) && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 8, background: creatorConnected ? "rgba(34,197,94,0.14)" : "rgba(255,255,255,0.08)", border: creatorConnected ? "1px solid rgba(34,197,94,0.28)" : "1px solid rgba(255,255,255,0.12)" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: creatorConnected ? "#4ade80" : "rgba(255,255,255,0.45)" }} />
              <span style={{ fontSize: 12, color: "#fff", fontWeight: 500, lineHeight: 1.3 }}>
                {creatorConnected && !buyerConnected
                  ? "El creador ya está en la sala, ¡únete!"
                  : buyerConnected && !creatorConnected
                  ? "Ya estás en la sala, esperando al creador"
                  : "Ambos conectados en la sala"}
              </span>
            </div>
          )}

          {/* Action area */}
          <div>
            {!toleranceExpired ? (
              <>
                {!canPrepare && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginBottom: 8 }}>
                    <svg
                      width={15}
                      height={15}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={session!.serviceKind === "exclusive_session" ? "#f9a8d4" : "#93c5fd"}
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
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", lineHeight: 1.4 }}>
                      {tServices("sessionWait15min")}
                    </span>
                  </div>
                )}
                {preSessionSecondsLeft !== null ? (
                  /* Both prepared — synchronized countdown */
                  <div style={{ textAlign: "center", padding: "6px 0" }}>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", marginBottom: 6 }}>
                      Ambos están en la sala
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {preSessionSecondsLeft}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 4 }}>
                      La sesión comienza en...
                    </div>
                  </div>
                ) : buyerConnected ? (
                  /* Buyer prepared, waiting for creator */
                  <div style={{ textAlign: "center", padding: "8px 0", fontSize: 13, color: "rgba(255,255,255,0.55)", fontStyle: "italic" }}>
                    En sala · Esperando al creador
                  </div>
                ) : (
                  /* Not yet prepared */
                  <button type="button" onClick={handlePrepare} disabled={!canPrepare || busy}
                    style={{ width: "100%", height: 40, borderRadius: 8, border: "none", background: canPrepare && !busy ? btnBg : "rgba(255,255,255,0.14)", color: canPrepare && !busy ? "#fff" : "rgba(255,255,255,0.35)", fontSize: 15, fontWeight: 600, cursor: canPrepare && !busy ? "pointer" : "not-allowed", fontFamily: "inherit", letterSpacing: "-0.02em", transition: "background 0.2s" }}>
                    {busy ? tCommon("processing") : tServices("prepareButton")}
                  </button>
                )}
              </>
            ) : reschedOpen ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <textarea value={reschedReason} onChange={(e) => setReschedReason(e.target.value)} placeholder="Motivo del cambio de fecha (opcional)" rows={2}
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 8, color: "#fff", fontSize: 13, padding: "8px 10px", resize: "none", fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={handleReschedule} disabled={busy}
                    style={{ flex: 1, height: 38, borderRadius: 8, border: "none", background: busy ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.16)", color: busy ? "rgba(255,255,255,0.35)" : "#fff", fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit" }}>
                    {busy ? tCommon("processing") : "Confirmar reagenda"}
                  </button>
                  <button type="button" onClick={() => setReschedOpen(false)} disabled={busy}
                    style={{ height: 38, paddingInline: 14, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "rgba(255,255,255,0.60)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" }}>
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.4, fontWeight: 500 }}>
                  El tiempo de tolerancia venció. Elige una opción:
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => setReschedOpen(true)} disabled={busy}
                    style={{ flex: 1, height: 40, borderRadius: 8, border: "1px solid rgba(255,255,255,0.28)", background: "rgba(255,255,255,0.10)", color: "#fff", fontSize: 14, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "-0.02em" }}>
                    Reagendar
                  </button>
                  <button type="button" onClick={handleRefund} disabled={busy}
                    style={{ flex: 1, height: 40, borderRadius: 8, border: "none", background: busy ? "rgba(255,255,255,0.10)" : "rgba(239,68,68,0.22)", color: busy ? "rgba(255,255,255,0.35)" : "#fca5a5", fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "-0.01em" }}>
                    {busy ? tCommon("processing") : "Solicitar devolución"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Completed session download section (only when there's also an active session) */}
          {completedSession && (
            <CompletedDownloadSection completed={completedSession} now={now} />
          )}

        </div>
      </div>

      {reminderOpen && !sessionInProgress && !prepOpen && createPortal(
        <div style={{
          position: "fixed", inset: 0, zIndex: 15000,
          background: "rgba(0,0,0,0.70)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "20px 16px", boxSizing: "border-box",
        }}>
          <div style={{ position: "relative", width: "100%", maxWidth: 360, borderRadius: 18, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.85)" }}>
            <div style={{ position: "absolute", inset: 0, backgroundImage: `url(${bgImage})`, backgroundSize: "cover", backgroundPosition: "center" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.82) 100%)" }} />
            <button
              type="button"
              onClick={() => setReminderOpen(false)}
              style={{ position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.75)", fontSize: 14, cursor: "pointer", display: "grid", placeItems: "center", fontFamily: "inherit", zIndex: 1 }}
            >✕</button>
            <div style={{ position: "relative", padding: "22px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "rgba(255,255,255,0.10)", border: "2px solid rgba(255,255,255,0.28)" }}>
                  {session!.creatorAvatarUrl
                    ? <Image src={session!.creatorAvatarUrl} alt={creatorName} width={52} height={52} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 700, color: "#fff", textTransform: "uppercase" }}>{creatorName[0]}</div>
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 3 }}>{sessionLabel}</div>
                  <div style={{ fontSize: 17, color: "#fff", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creatorName}</div>
                </div>
              </div>
              {/* Countdown */}
              <div style={{ textAlign: "center", padding: "4px 0" }}>
                <div style={{ fontSize: 11, color: isPastStart ? "#fb923c" : "rgba(255,255,255,0.55)", marginBottom: 4, fontWeight: 500 }}>
                  {isPastStart ? "Lleva de retraso" : "Comienza en"}
                </div>
                <div style={{ fontSize: 44, fontWeight: 900, color: isPastStart ? "#fb923c" : "#fff", letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                  {countdownValue}
                </div>
              </div>
              {/* Action */}
              {!buyerConnected ? (
                <button
                  type="button"
                  onClick={async () => { await handlePrepare(); setReminderOpen(false); }}
                  disabled={!canPrepare || busy}
                  style={{ width: "100%", height: 46, borderRadius: 10, border: "none", background: canPrepare && !busy ? btnBg : "rgba(255,255,255,0.14)", color: canPrepare && !busy ? "#fff" : "rgba(255,255,255,0.35)", fontSize: 16, fontWeight: 700, cursor: canPrepare && !busy ? "pointer" : "not-allowed", fontFamily: "inherit", letterSpacing: "-0.02em" }}>
                  {busy ? tCommon("processing") : tServices("prepareButton")}
                </button>
              ) : (
                <div style={{ textAlign: "center", fontSize: 14, color: "#4ade80", fontWeight: 600 }}>
                  Ya estás en la sala
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

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
            La sesión está por comenzar
          </div>
        </div>,
        document.body
      )}

      <MeetGreetPreparationFullscreen
        open={prepOpen}
        onClose={() => setPrepOpen(false)}
        role="buyer"
        sessionId={session!.id}
        sessionType={session!.serviceKind}
        scheduledAtLabel={fmtScheduledAt(session!.scheduledAt, locale)}
        durationMinutes={session!.durationMinutes}
      />
    </>
  );
}
