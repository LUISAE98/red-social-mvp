"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import LiveKitVideoRoom from "@/app/components/liveKit/LiveKitVideoRoom";
import type { LivekitSessionType } from "@/lib/liveKit/getLivekitToken";
import { callGetRecordingDownloadUrl } from "@/lib/liveKit/sessionLifecycle";

type Props = {
  open: boolean;
  onClose: () => void;
  role: "buyer" | "creator";
  sessionId: string;
  sessionType: LivekitSessionType;
  // Mantenidos por compatibilidad — no se renderizan
  scheduledAtLabel?: string | null;
  durationMinutes?: number | null;
};

export default function MeetGreetPreparationFullscreen({
  open,
  onClose,
  role,
  sessionId,
  sessionType,
}: Props) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine) and (min-width: 768px)");
    setIsDesktop(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  // Orientación física del teléfono. Cuando el usuario lo pone de lado
  // (horizontal), el panel se muestra a pantalla completa sin rotar y la cámara
  // sale horizontal y derecha. En vertical se conserva el truco de rotar 90°.
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(orientation: landscape)");
    setIsLandscape(mql.matches);
    const h = (e: MediaQueryListEvent) => setIsLandscape(e.matches);
    mql.addEventListener("change", h);
    return () => mql.removeEventListener("change", h);
  }, []);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  // ── Estado ────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"call" | "expired">("call");
  const [endSheet, setEndSheet] = useState<"hidden" | "confirm" | "feedback">("hidden");
  const [feedbackText, setFeedbackText] = useState("");
  const [showTwoMinAlert, setShowTwoMinAlert] = useState(false);
  const [showFarewellAlert, setShowFarewellAlert] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [isEndingSession, setIsEndingSession] = useState(false);
  const [dlBusy, setDlBusy] = useState(false);
  const [dlMsg, setDlMsg] = useState<string | null>(null);
  const endSessionRef = useRef<(() => Promise<void>) | null>(null);
  const twoMinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const farewellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset al cerrar/abrir
  useEffect(() => {
    if (!open) {
      setMode("call");
      setEndSheet("hidden");
      setFeedbackText("");
      setShowTwoMinAlert(false);
      setShowFarewellAlert(false);
      setSessionEnded(false);
      setIsEndingSession(false);
    }
  }, [open]);

  const handleEndCallRequest = useCallback(() => {
    setEndSheet("confirm");
  }, []);

  const handleTimerExpired = useCallback(() => {
    setMode("expired");
  }, []);

  const handleDownloadRecording = useCallback(async () => {
    if (dlBusy) return;
    setDlBusy(true);
    setDlMsg(null);
    try {
      const url = await callGetRecordingDownloadUrl({ sessionId, sessionType });
      window.location.href = url;
    } catch {
      setDlMsg(
        'La grabación se está procesando. La encontrarás en "Entregadas" en unos minutos.'
      );
    } finally {
      setDlBusy(false);
    }
  }, [dlBusy, sessionId, sessionType]);

  const handleTwoMinWarning = useCallback(() => {
    setShowTwoMinAlert(true);
    if (twoMinTimerRef.current) clearTimeout(twoMinTimerRef.current);
    twoMinTimerRef.current = setTimeout(() => setShowTwoMinAlert(false), 4500);
  }, []);

  const handleFarewellWarning = useCallback(() => {
    setShowFarewellAlert(true);
    if (farewellTimerRef.current) clearTimeout(farewellTimerRef.current);
    farewellTimerRef.current = setTimeout(() => setShowFarewellAlert(false), 4500);
  }, []);

  const handleConfirmEnd = useCallback(async () => {
    setIsEndingSession(true);
    setSessionEnded(true);
    setEndSheet("feedback");
    try {
      await endSessionRef.current?.();
    } finally {
      setIsEndingSession(false);
    }
  }, []);

  if (!mounted || !open) return null;

  const backdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 2147483647,
    background: "#000",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    overscrollBehavior: "none",
    touchAction: "none",
  };

  // El panel se rota por CSS solo cuando el teléfono está en vertical (para
  // simular apaisado). De lado no se rota: la cámara ya es horizontal.
  const rotateMobile = !isDesktop && !isLandscape;

  // Desktop: panel 16:9 centrado. Móvil de lado: pantalla completa sin rotar.
  // Móvil vertical: se rota el panel 90° para verse apaisado.
  const panelStyle: CSSProperties = isDesktop
    ? {
        position: "relative",
        width: "min(95dvw, calc(95dvh * 16 / 9))",
        height: "min(95dvh, calc(95dvw * 9 / 16))",
        borderRadius: 20,
        overflow: "hidden",
        flexShrink: 0,
      }
    : rotateMobile
    ? {
        position: "absolute",
        top: 0,
        insetInlineStart: "100dvw",
        width: "100dvh",
        height: "100dvw",
        transformOrigin: "top left",
        transform: "rotate(90deg)",
        overflow: "hidden",
        flexShrink: 0,
      }
    : {
        position: "absolute",
        inset: 0,
        width: "100dvw",
        height: "100dvh",
        overflow: "hidden",
        flexShrink: 0,
      };

  return createPortal(
    <div role="dialog" aria-modal="true" style={backdropStyle}>
      <div style={panelStyle}>

        {/* Video call activa */}
        {mode === "call" && (
          <LiveKitVideoRoom
            sessionId={sessionId}
            sessionType={sessionType}
            role={role}
            onLeave={onClose}
            isMobile={!isDesktop}
            rotated={rotateMobile}
            onEndCallRequest={handleEndCallRequest}
            onTimerExpired={handleTimerExpired}
            onTwoMinWarning={handleTwoMinWarning}
            onFarewellWarning={handleFarewellWarning}
            endSessionRef={endSessionRef}
          />
        )}

        {/* Cancelación: la pantalla se funde a negro MUY suavemente y se corta en
            un proceso de ~2s, en vez de cortar de golpe. */}
        {mode === "call" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "#000",
              zIndex: 7,
              opacity: sessionEnded ? 1 : 0,
              transition: "opacity 1.6s cubic-bezier(0.4, 0, 0.2, 1)",
              pointerEvents: sessionEnded ? "auto" : "none",
            }}
          />
        )}

        {/* Aviso 2 minutos */}
        {mode === "call" && showTwoMinAlert && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderRadius: 10,
              padding: "10px 20px",
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)", letterSpacing: "0.01em" }}>
                Quedan 2 minutos de sesión
              </span>
            </div>
          </div>
        )}

        {/* Aviso 20 segundos — mismo estilo que el de 2 minutos */}
        {mode === "call" && showFarewellAlert && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 6,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              borderRadius: 10,
              padding: "10px 20px",
            }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.85)", letterSpacing: "0.01em" }}>
                Es momento de despedirte
              </span>
            </div>
          </div>
        )}

        {/* Panel Vibra — confirmar fin / feedback */}
        {mode === "call" && endSheet !== "hidden" && (
          <>
            <style>{`
              @keyframes vibraEndPanelIn {
                from { opacity: 0; transform: scale(0.94) translateY(10px); }
                to   { opacity: 1; transform: scale(1) translateY(0); }
              }
            `}</style>
            <div
              style={{
                position: "absolute", inset: 0, zIndex: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: 24,
                background: "rgba(0,0,0,0.88)",
                fontFamily: "inherit",
              }}
              onMouseDown={e => {
                if (e.target === e.currentTarget && endSheet === "confirm") setEndSheet("hidden");
              }}
            >
              <section style={{
                width: "min(100%, 380px)",
                borderRadius: 18,
                background: "#0a0a0a",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
                color: "#fff",
                overflow: "hidden",
                animation: "vibraEndPanelIn 180ms ease-out",
              }}>

                {/* Header */}
                <header style={{
                  height: 56,
                  display: "grid",
                  gridTemplateColumns: "48px 1fr 48px",
                  alignItems: "center",
                  padding: "0 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.12)",
                  flexShrink: 0,
                }}>
                  <div aria-hidden="true" />
                  <span style={{
                    fontSize: 17, fontWeight: 500, color: "#fff",
                    lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em",
                  }}>
                    {endSheet === "confirm" ? "Terminar sesión" : "Sesión terminada"}
                  </span>
                  {endSheet === "confirm" ? (
                    <button
                      type="button"
                      onClick={() => setEndSheet("hidden")}
                      style={{
                        border: "none", background: "none", color: "#fff",
                        cursor: "pointer", display: "grid", placeItems: "center",
                        justifySelf: "end", padding: 4,
                        fontSize: 32, fontWeight: 300, lineHeight: 1,
                      }}
                    >×</button>
                  ) : (
                    <div aria-hidden="true" />
                  )}
                </header>

                {/* Confirmar */}
                {endSheet === "confirm" && (
                  <>
                    <div style={{ padding: "18px 20px 8px" }}>
                      <p style={{ color: "rgba(255,255,255,0.70)", fontSize: 14, lineHeight: 1.55, margin: 0 }}>
                        ¿Estás seguro de que quieres acabar la sesión antes de tiempo? Después nos dejarás un mensaje para decirnos qué pasó.
                      </p>
                    </div>
                    <div style={{
                      padding: "14px 20px 18px",
                      borderTop: "1px solid rgba(255,255,255,0.12)",
                      display: "flex", flexDirection: "column", gap: 10,
                    }}>
                      <button
                        type="button"
                        onClick={handleConfirmEnd}
                        disabled={isEndingSession}
                        style={{
                          width: "100%", height: 42, borderRadius: 5, border: "none",
                          background: isEndingSession ? "rgba(239,68,68,0.50)" : "#ef4444",
                          color: "rgba(255,255,255,0.98)",
                          fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                          cursor: isEndingSession ? "not-allowed" : "pointer",
                          letterSpacing: "-0.02em",
                          display: "grid", placeItems: "center",
                        }}
                      >
                        {isEndingSession ? "Terminando…" : "Sí, terminar sesión"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEndSheet("hidden")}
                        disabled={isEndingSession}
                        style={{
                          width: "100%", height: 42, borderRadius: 5, border: "none",
                          background: "rgba(255,255,255,0.1)",
                          color: "rgba(255,255,255,0.55)",
                          fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                          cursor: isEndingSession ? "not-allowed" : "pointer",
                          letterSpacing: "-0.02em",
                          display: "grid", placeItems: "center",
                        }}
                      >
                        No, continuar
                      </button>
                    </div>
                  </>
                )}

                {/* Feedback — enviar no es funcional aún */}
                {endSheet === "feedback" && (
                  <>
                    <div style={{ padding: "18px 20px 8px" }}>
                      <textarea
                        placeholder="Dinos qué pasó…"
                        value={feedbackText}
                        onChange={e => setFeedbackText(e.target.value)}
                        rows={4}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          background: "rgba(255,255,255,0.06)",
                          border: "none",
                          borderRadius: 12, padding: "10px 12px",
                          color: "#fff", fontSize: 13, resize: "none",
                          fontFamily: "inherit", outline: "none",
                          lineHeight: 1.5,
                        }}
                      />
                    </div>
                    <div style={{ padding: "14px 20px 18px", borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEndSheet("hidden");
                          setFeedbackText("");
                          setSessionEnded(false);
                          onClose();
                        }}
                        style={{
                          width: "100%", height: 42, borderRadius: 5, border: "none",
                          background: "#a855f7", color: "rgba(255,255,255,0.98)",
                          fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                          cursor: "pointer", letterSpacing: "-0.02em",
                          display: "grid", placeItems: "center",
                        }}
                      >
                        Enviar
                      </button>
                    </div>
                  </>
                )}

              </section>
            </div>
          </>
        )}

        {/* Tarjeta de descarga — sesión expirada por tiempo */}
        {mode === "expired" && (
          <div style={{
            position: "absolute", inset: 0, background: "#000",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 24, fontFamily: "inherit",
          }}>
            <div style={{
              width: "min(100%, 340px)",
              borderRadius: 18,
              background: "#0a0a0a",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
              overflow: "hidden",
              padding: "32px 24px 28px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
              textAlign: "center",
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(168,85,255,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </div>

              <div>
                <p style={{ color: "#fff", fontSize: 16, fontWeight: 600, margin: "0 0 8px", lineHeight: 1.3 }}>
                  Tu sesión ha terminado
                </p>
                <p style={{ color: "rgba(255,255,255,0.50)", fontSize: 13, margin: 0, lineHeight: 1.55 }}>
                  La grabación estará disponible para descargar. Tienes{" "}
                  <strong style={{ color: "rgba(255,255,255,0.80)" }}>30 días</strong>{" "}
                  para descargarla antes de que sea eliminada.
                </p>
              </div>

              <button
                type="button"
                onClick={handleDownloadRecording}
                disabled={dlBusy}
                style={{
                  width: "100%", height: 42, borderRadius: 5, border: "none",
                  background: dlBusy ? "rgba(168,85,255,0.5)" : "#a855f7",
                  color: "rgba(255,255,255,0.98)",
                  fontSize: 15, fontWeight: 500, fontFamily: "inherit",
                  cursor: dlBusy ? "not-allowed" : "pointer", letterSpacing: "-0.02em",
                  display: "grid", placeItems: "center",
                }}
              >
                {dlBusy ? "Descargando…" : "Descargar grabación"}
              </button>

              {dlMsg && (
                <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  {dlMsg}
                </p>
              )}

              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "none", border: "none",
                  color: "rgba(255,255,255,0.35)",
                  fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Aviso móvil: exige teléfono en horizontal con giro automático activado.
          Solo aparece cuando el viewport NO está en landscape (incluye el caso de
          giro bloqueado). Tapa la llamada con fondo translúcido hasta que el
          usuario gire el dispositivo — que es el único estado donde la cámara y
          la sala salen bien. Va fuera del panel rotado para leerse derecho. */}
      {!isDesktop && !isLandscape && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2147483647,
            background: "rgba(0,0,0,0.82)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 20,
            padding: 32,
            textAlign: "center",
            fontFamily: "inherit",
          }}
        >
          <style>{`
            @keyframes vibraRotateHint {
              0%, 55%, 100% { transform: rotate(0deg); }
              75%, 95% { transform: rotate(-90deg); }
            }
          `}</style>
          <svg
            width={68}
            height={68}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#a855f7"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ animation: "vibraRotateHint 2.4s ease-in-out infinite" }}
          >
            <rect x="7" y="2" width="10" height="20" rx="2" />
            <line x1="11" y1="18" x2="13" y2="18" />
          </svg>
          <div>
            <p style={{ color: "#fff", fontSize: 18, fontWeight: 700, margin: "0 0 8px", lineHeight: 1.3, letterSpacing: "-0.01em" }}>
              Gira tu teléfono
            </p>
            <p style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, margin: 0, lineHeight: 1.55, maxWidth: 300 }}>
              Activa el{" "}
              <strong style={{ color: "rgba(255,255,255,0.88)" }}>giro automático</strong>{" "}
              de tu pantalla y pon el teléfono en{" "}
              <strong style={{ color: "rgba(255,255,255,0.88)" }}>horizontal</strong>{" "}
              para que la videollamada se vea bien.
            </p>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
