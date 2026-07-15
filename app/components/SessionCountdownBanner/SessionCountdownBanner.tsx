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
            border: "none",
            background: "none",
            color: "rgba(255,255,255,0.45)",
            fontSize: 16,
            cursor: "pointer",
            padding: "0 2px",
            fontFamily: "inherit",
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-label="Cerrar sección de descarga"
        >
          ✕
        </button>
      </div>

      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5, textAlign: "center" }}>
        {canDownload
          ? `Descarga tu sesión. Tienes ${daysLeft} día${daysLeft === 1 ? "" : "s"} para hacerlo, después ya no se podrá.`
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
        {downloadBusy ? "Descargando..." : "Descargar sesión"}
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
    setReschedOpen(false);
    setReschedReason("");
    setIncompleteDismissed(false);
    setForceCompleting(false);
    setForceCompleted(false);
    countdown321Triggered.current = false;
    setCountdown321(null);
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
        <button type="button" onClick={dismissStandalone} style={{ position: "absolute", top: 10, right: 10, border: "none", background: "none", color: "rgba(255,255,255,0.45)", fontSize: 16, cursor: "pointer", padding: "0 2px", zIndex: 2, fontFamily: "inherit", lineHeight: 1 }} aria-label="Cerrar">✕</button>
        <div style={{ position: "relative", padding: "16px 40px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
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
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>Completada</span>
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", lineHeight: 1.5, textAlign: "center" }}>
            {canDownload
              ? `Descarga tu sesión. Tienes ${daysLeft} día${daysLeft === 1 ? "" : "s"} para hacerlo, después ya no se podrá.`
              : "El enlace de descarga ha expirado (30 días)."}
          </div>
          <button type="button" onClick={handleDownload} disabled={!canDownload} style={{ width: "100%", height: 38, borderRadius: 8, border: "none", background: !canDownload ? "rgba(255,255,255,0.08)" : completedSession.serviceKind === "exclusive_session" ? "rgba(236,72,153,0.22)" : "rgba(59,130,246,0.22)", color: !canDownload ? "rgba(255,255,255,0.30)" : completedSession.serviceKind === "exclusive_session" ? "#f9a8d4" : "#93c5fd", fontSize: 14, fontWeight: 600, cursor: !canDownload ? "not-allowed" : "pointer", fontFamily: "inherit", letterSpacing: "-0.01em" }}>
            Descargar sesión
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
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fde047", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#fde047", fontWeight: 600 }}>Sesión corta</span>
              </div>
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
                  style={{ flex: 1, height: 40, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.2 }}>
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
  const msLate = isPastStart ? Math.min(Math.abs(msLeft), 15 * 60 * 1000) : 0;

  // When startedAt is set, both joined LiveKit — switch to descending session timer
  const sessionInProgress = !!session!.startedAt;
  const durationMs = (session!.durationMinutes ?? 30) * 60 * 1000;
  const sessionDeadline = sessionInProgress ? session!.startedAt!.getTime() + durationMs : null;
  const msRemaining = sessionDeadline != null ? Math.max(0, sessionDeadline - now) : null;

  // La tolerancia (no-show) y el flujo de preparación sólo aplican ANTES de que
  // arranque la sesión. Una vez en curso jamás mostramos reagendar/devolución
  // ni el aviso de "en sala"; sólo el botón para volver a entrar.
  const toleranceExpired = isPastStart && !sessionInProgress && msLate >= 15 * 60 * 1000;
  const canPrepare = !sessionInProgress && msLeft <= 15 * 60 * 1000;

  const sessionLabel = "Sesión con";
  const creatorName = session!.creatorDisplayName ?? tSessions("creatorFallback");
  const bgImage = BG_IMAGE[session!.serviceKind];
  const btnBg = BTN_BG[session!.serviceKind];

  const creatorConnected = !!session!.preparingCreatorAt;
  const buyerConnected = !!session!.preparingBuyerAt;

  // Retraso: el reloj sólo corre contra quien falta. Yo soy el comprador.
  //  · Ambos en sala → el reloj se detiene (sin retraso) hasta que arranca la sesión.
  //  · Yo en sala y falta el creador → él lleva el retraso.
  //  · No estoy en sala y pasó la hora → el retraso es mío.
  const bothConnected = buyerConnected && creatorConnected;
  const otherIsLate = isPastStart && buyerConnected && !creatorConnected;
  const countdownFrozen = !sessionInProgress && bothConnected;
  const countdownLabel = sessionInProgress
    ? "Sesión en curso"
    : countdownFrozen
    ? "En sala"
    : toleranceExpired
    ? "Se acabó el tiempo"
    : otherIsLate
    ? `${creatorName} lleva de retraso`
    : isPastStart ? tServices("sessionLate") : tServices("sessionStartsIn");
  const countdownValue = sessionInProgress
    ? formatCountdown(msRemaining ?? 0)
    : isPastStart ? formatCountdown(msLate) : formatCountdown(msLeft);

  // Pre-session synchronized countdown
  const prepT0 =
    buyerConnected && creatorConnected && session!.preparingBuyerAt && session!.preparingCreatorAt
      ? Math.max(session!.preparingBuyerAt.getTime(), session!.preparingCreatorAt.getTime())
      : null;
  const preSessionSecondsLeft =
    prepT0 !== null && !sessionInProgress && !prepOpen
      ? Math.max(0, Math.ceil(((prepT0 + 30_000) - now) / 1000))
      : null;
  preSessionCtxRef.current = { secondsLeft: preSessionSecondsLeft, inProgress: sessionInProgress };

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
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fb923c", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#fb923c", fontWeight: 600 }}>No se realizó</span>
              </div>
            </div>
          </div>

          {/* Action area */}
          <div>
            <div style={{ overflow: "hidden", maxHeight: reschedOpen ? 0 : "120px", opacity: reschedOpen ? 0 : 1, transition: "max-height 0.30s cubic-bezier(0.16,1,0.3,1), opacity 0.18s ease", pointerEvents: reschedOpen ? "none" : "auto" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.4, fontWeight: 500 }}>
                  La sesión no se realizó dentro del tiempo de tolerancia. ¿Qué quieres hacer?
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => setReschedOpen(true)} disabled={busy}
                    style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: session!.serviceKind === "meet_greet" ? "#2563eb" : "#be185d", color: "#fff", fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                    Reagendar
                  </button>
                  <button type="button" onClick={handleRefund} disabled={busy}
                    style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)", fontSize: 13, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                    {busy ? tCommon("processing") : "Solicitar devolución"}
                  </button>
                </div>
              </div>
            </div>
            <div style={{ overflow: "hidden", maxHeight: reschedOpen ? "280px" : 0, opacity: reschedOpen ? 1 : 0, transition: "max-height 0.30s cubic-bezier(0.16,1,0.3,1), opacity 0.18s ease", pointerEvents: reschedOpen ? "auto" : "none" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 2 }}>
                <textarea value={reschedReason} onChange={(e) => setReschedReason(e.target.value)} placeholder="Motivo del cambio de fecha (opcional)" rows={3}
                  style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, resize: "none", outline: "none" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={handleReschedule} disabled={busy}
                    style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: session!.serviceKind === "meet_greet" ? "#2563eb" : "#be185d", color: "#fff", fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                    {busy ? tCommon("processing") : "Confirmar reagenda"}
                  </button>
                  <button type="button" onClick={() => setReschedOpen(false)} disabled={busy}
                    style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            </div>
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
              <div style={{ fontSize: 11, fontWeight: 500, marginBottom: 2, lineHeight: 1.3, color: sessionInProgress || countdownFrozen ? "#4ade80" : isPastStart ? "#fb923c" : "rgba(255,255,255,0.65)" }}>
                {countdownLabel}
              </div>
              {!countdownFrozen && (
                <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", textShadow: "0 1px 8px rgba(0,0,0,0.5)", color: sessionInProgress ? (msRemaining != null && msRemaining <= 60000 ? "#ef4444" : msRemaining != null && msRemaining <= 300000 ? "#f59e0b" : "#4ade80") : isPastStart ? "#fb923c" : "#fff", ...(isPastStart && !sessionInProgress && !toleranceExpired ? { animation: "session-late-pulse 1.6s ease-in-out infinite" } : {}) }}>
                  {countdownValue}
                </div>
              )}
              {isPastStart && !sessionInProgress && !countdownFrozen && !toleranceExpired && (
                <div style={{ fontSize: 10, color: "#fb923c", marginTop: 3, lineHeight: 1.3, opacity: 0.85 }}>
                  15 min de tolerancia
                </div>
              )}
            </div>
          </div>

          {/* Connection status notice */}
          {canPrepare && (creatorConnected || buyerConnected) && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
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
            {sessionInProgress ? (
              /* Sesión en curso — botón para volver a entrar a la sala */
              <button type="button" onClick={() => setPrepOpen(true)}
                style={{ width: "100%", height: 40, borderRadius: 8, border: "none", background: "linear-gradient(135deg, #16a34a 0%, #22c55e 100%)", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", letterSpacing: "-0.02em" }}>
                Volver a entrar
              </button>
            ) : !toleranceExpired ? (
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
            ) : (
              <>
                <div style={{ overflow: "hidden", maxHeight: reschedOpen ? 0 : "120px", opacity: reschedOpen ? 0 : 1, transition: "max-height 0.30s cubic-bezier(0.16,1,0.3,1), opacity 0.18s ease", pointerEvents: reschedOpen ? "none" : "auto" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.4, fontWeight: 500 }}>
                      El tiempo de tolerancia venció. Elige una opción:
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => setReschedOpen(true)} disabled={busy}
                        style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: session!.serviceKind === "meet_greet" ? "#2563eb" : "#be185d", color: "#fff", fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                        Reagendar
                      </button>
                      <button type="button" onClick={handleRefund} disabled={busy}
                        style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)", fontSize: 13, fontWeight: 500, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                        {busy ? tCommon("processing") : "Solicitar devolución"}
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{ overflow: "hidden", maxHeight: reschedOpen ? "280px" : 0, opacity: reschedOpen ? 1 : 0, transition: "max-height 0.30s cubic-bezier(0.16,1,0.3,1), opacity 0.18s ease", pointerEvents: reschedOpen ? "auto" : "none" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 2 }}>
                    <textarea value={reschedReason} onChange={(e) => setReschedReason(e.target.value)} placeholder="Motivo del cambio de fecha (opcional)" rows={3}
                      style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "none", borderRadius: 12, padding: "10px 12px", color: "#fff", fontSize: 13, fontFamily: "inherit", lineHeight: 1.5, resize: "none", outline: "none" }} />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={handleReschedule} disabled={busy}
                        style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: session!.serviceKind === "meet_greet" ? "#2563eb" : "#be185d", color: "#fff", fontSize: 13, fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                        {busy ? tCommon("processing") : "Confirmar reagenda"}
                      </button>
                      <button type="button" onClick={() => setReschedOpen(false)} disabled={busy}
                        style={{ flex: 1, height: 36, borderRadius: 6, border: "none", background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.70)", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit", opacity: busy ? 0.7 : 1 }}>
                        {tCommon("cancel")}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Completed session download section (only when there's also an active session) */}
          {completedSession && (
            <CompletedDownloadSection completed={completedSession} now={now} />
          )}

        </div>
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
