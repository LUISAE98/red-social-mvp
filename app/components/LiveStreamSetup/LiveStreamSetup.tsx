"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  callCreateMuxLiveStream,
  callCreateCFLiveInput,
  fetchLiveStreamCredentials,
  saveLiveBroadcastMode,
} from "@/lib/posts/post-service";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

const fontStack = "inherit";
const PANEL_CLOSE_THRESHOLD = 130;

type BroadcastMode = "direct" | "rtmp";

type Props = {
  open: boolean;
  onClose: () => void;
  postId: string;
  liveStreamId?: string | null;
  broadcastMode?: BroadcastMode | null;
  onStreamCreated?: (liveStreamId: string, playbackId: string | null) => void;
  onOpenCreatorPanel?: () => void;
};

type Credentials = {
  streamKey: string;
  ingestUrl: string;
  liveStreamId: string;
};

function CopyButton({ value }: { value: string }) {
  const tLive = useTranslations("live");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback silencioso
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        flexShrink: 0,
        padding: "6px 12px",
        borderRadius: 8,
        border: "1px solid rgba(168,85,255,0.35)",
        background: copied ? "rgba(34,197,94,0.15)" : "rgba(168,85,255,0.12)",
        color: copied ? "#86efac" : "#d8b4fe",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: fontStack,
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {copied ? tLive("copied") : tLive("copy")}
    </button>
  );
}

function CredentialRow({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const tLive = useTranslations("live");
  const [revealed, setRevealed] = useState(!secret);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: "0.06em",
        textTransform: "uppercase", color: "rgba(255,255,255,0.4)",
        marginBottom: 6, fontFamily: fontStack,
      }}>
        {label}
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 10, padding: "8px 10px",
      }}>
        <span style={{
          flex: 1, fontSize: 12, fontFamily: "monospace",
          color: secret && !revealed ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)",
          wordBreak: "break-all", lineHeight: 1.5,
          letterSpacing: secret && !revealed ? "0.2em" : undefined,
        }}>
          {secret && !revealed ? "•".repeat(24) : value}
        </span>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              style={{
                padding: "6px 10px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.5)",
                fontSize: 12, fontFamily: fontStack, cursor: "pointer",
              }}
            >
              {revealed ? tLive("hide") : tLive("reveal")}
            </button>
          )}
          <CopyButton value={value} />
        </div>
      </div>
    </div>
  );
}

export default function LiveStreamSetup({
  open,
  onClose,
  postId,
  liveStreamId,
  broadcastMode: broadcastModeProp,
  onStreamCreated,
  onOpenCreatorPanel,
}: Props) {
  const tCommon = useTranslations("common");
  const tLive = useTranslations("live");
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [isDesktop, setIsDesktop] = useState(false);
  const [selectedMode, setSelectedMode] = useState<BroadcastMode | null>(
    broadcastModeProp ?? (liveStreamId ? "rtmp" : null),
  );
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (error) showToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Swipe to close (mobile)
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);
  const panelCloseOffsetRef = useRef(
    typeof window === "undefined" ? 900 : window.innerHeight,
  );

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      if (!isDesktop) {
        setIsPanelDragging(false);
        setPanelOffsetY(panelCloseOffsetRef.current);
        const frameOne = window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => { setPanelOffsetY(0); });
        });
        return () => window.cancelAnimationFrame(frameOne);
      }
      return;
    }
    if (!isDesktop) {
      setIsPanelDragging(false);
      setPanelOffsetY(panelCloseOffsetRef.current);
      const timer = window.setTimeout(() => setShouldRender(false), 260);
      return () => window.clearTimeout(timer);
    }
    const t = window.setTimeout(() => setShouldRender(false), 180);
    return () => window.clearTimeout(t);
  }, [open, isDesktop]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (broadcastModeProp) setSelectedMode(broadcastModeProp);
    else if (liveStreamId && !broadcastModeProp) setSelectedMode("rtmp");
  }, [broadcastModeProp, liveStreamId]);

  const loadCredentials = useCallback(async () => {
    setLoadingCreds(true);
    setError(null);
    try {
      const creds = await fetchLiveStreamCredentials(postId);
      setCredentials(creds);
    } catch {
      setError(tLive("setupCredsError"));
    } finally {
      setLoadingCreds(false);
    }
  }, [postId]);

  useEffect(() => {
    if (open && liveStreamId && selectedMode === "rtmp") loadCredentials();
    if (!open) { setCredentials(null); setError(null); }
  }, [open, liveStreamId, selectedMode, loadCredentials]);

  async function handleSelectMode(mode: BroadcastMode) {
    setSelectedMode(mode);
    setError(null);
    setCreating(true);
    try {
      await saveLiveBroadcastMode(postId, mode);
      if (mode === "direct") {
        const result = await callCreateCFLiveInput(postId);
        onStreamCreated?.(result.liveInputId, null);
      } else {
        const result = await callCreateMuxLiveStream(postId);
        onStreamCreated?.(result.liveStreamId, result.playbackId);
        await loadCredentials();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tLive("setupError"));
      setSelectedMode(null);
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateStream() {
    setCreating(true);
    setError(null);
    try {
      const result = await callCreateMuxLiveStream(postId);
      onStreamCreated?.(result.liveStreamId, result.playbackId);
      await loadCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : tLive("createStreamError"));
    } finally {
      setCreating(false);
    }
  }

  function applyPanelOffset(raw: number): number {
    if (raw >= 0) return Math.min(panelCloseOffsetRef.current, raw);
    return raw * 0.2;
  }

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setIsPanelDragging(true);
    dragStartY.current = e.clientY;
    dragStartOffset.current = panelOffsetY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [panelOffsetY]);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isPanelDragging) return;
    const delta = e.clientY - dragStartY.current;
    setPanelOffsetY(applyPanelOffset(dragStartOffset.current + delta));
  }, [isPanelDragging]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDragEnd = useCallback(() => {
    if (!isPanelDragging) return;
    setIsPanelDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      setPanelOffsetY(panelCloseOffsetRef.current);
      setTimeout(() => { onClose(); setPanelOffsetY(0); }, 260);
    } else {
      setPanelOffsetY(0);
    }
  }, [isPanelDragging, panelOffsetY, onClose]);

  if (!shouldRender || !mounted) return null;

  const hasStream = !!(liveStreamId || credentials);
  const effectiveMode = selectedMode ?? broadcastModeProp;
  const showModeSelector = !effectiveMode && !hasStream && !creating;
  const showDirectReady = effectiveMode === "direct" && !creating && !error;
  const showRtmpFlow = effectiveMode === "rtmp" && !creating;

  // Contenido scrollable — compartido entre desktop y mobile
  const scrollContent = (
    <div className="lss-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 24px" }}>

      {/* Selección de modo → cargando: contenedor unificado que mantiene altura durante la transición */}
      {(showModeSelector || creating) && !showDirectReady && !showRtmpFlow && (
        <div style={{ position: "relative" }}>
          {/* Botones: se desvanecen al iniciar la carga, permanecen en DOM para mantener altura */}
          <div style={{
            opacity: creating ? 0 : 1,
            transition: "opacity 220ms ease",
            pointerEvents: creating ? "none" : "auto",
          }}>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: fontStack, marginBottom: 16, lineHeight: 1.5 }}>
              {tLive("setupHowToBroadcast")}
            </p>

            <button
              type="button"
              onClick={() => handleSelectMode("direct")}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 14,
                padding: "14px 16px", borderRadius: 12,
                border: "none",
                background: "rgba(59,130,246,0.16)",
                cursor: "pointer", textAlign: "start", marginBottom: 10,
                transition: "background 0.15s",
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: "rgba(59,130,246,0.22)", border: "none",
                display: "grid", placeItems: "center",
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                  <path d="M19.4 14a8 8 0 1 0-14.8 0" />
                  <path d="M12 20v-4" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>{tLive("setupFromVibra")}</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: fontStack, marginTop: 2 }}>{tLive("setupUseDevice")}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginInlineStart: "auto" }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => handleSelectMode("rtmp")}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 14,
                padding: "14px 16px", borderRadius: 12,
                border: "none",
                background: "rgba(168,85,255,0.16)",
                cursor: "pointer", textAlign: "start",
                transition: "background 0.15s",
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                background: "rgba(168,85,255,0.22)", border: "none",
                display: "grid", placeItems: "center",
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>Software externo</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: fontStack, marginTop: 2 }}>OBS, Streamlabs u otro software RTMP</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginInlineStart: "auto" }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          {/* Spinner: aparece encima del área de botones cuando carga */}
          {creating && (
            <div style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
            }}>
              <div className="vibraPullRefreshSpinner refreshing" style={{ width: 40, height: 40 }} />
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", fontFamily: fontStack }}>
                {tLive("setupPreparing")}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Modo directo — listo */}
      {showDirectReady && (
        <div style={{ animation: "lssContentReveal 340ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
          <div style={{
            background: "rgba(59,130,246,0.16)", border: "none",
            borderRadius: 12, padding: "14px 16px",
            display: "flex", alignItems: "center", gap: 14, marginBottom: 20,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: "rgba(59,130,246,0.22)", border: "none",
              display: "grid", placeItems: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />
                <path d="M19.4 14a8 8 0 1 0-14.8 0" />
                <path d="M12 20v-4" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>Todo listo para transmitir desde Vibra</div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: fontStack, marginTop: 2 }}>Usa los controles en el panel de tu live.</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {onOpenCreatorPanel && (
              <button
                type="button"
                onClick={() => { onClose(); onOpenCreatorPanel(); }}
                style={{
                  width: "100%", padding: "11px 16px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, rgba(168,85,255,0.85), rgba(124,58,237,0.85))",
                  color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: fontStack, cursor: "pointer",
                }}
              >
                {tLive("setupOpenControlPanel")}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%", padding: "11px 16px", borderRadius: 10, border: "none",
                background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)",
                fontSize: 14, fontWeight: 600, fontFamily: fontStack, cursor: "pointer",
              }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Flujo RTMP */}
      {showRtmpFlow && !creating && (
        <div style={{ animation: "lssContentReveal 340ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
          {!hasStream && !loadingCreds && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", fontFamily: fontStack, marginBottom: 20, lineHeight: 1.5 }}>
                Activa el stream en Mux para obtener tu URL RTMP y Stream Key.
              </p>
              <button
                type="button"
                onClick={handleCreateStream}
                disabled={creating}
                style={{
                  padding: "12px 28px", borderRadius: 10, border: "none",
                  background: creating ? "rgba(168,85,255,0.35)" : "linear-gradient(135deg,#a855f7,#7c3aed)",
                  color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: fontStack,
                  cursor: creating ? "not-allowed" : "pointer",
                }}
              >
                {creating ? "Activando..." : "Activar stream"}
              </button>
            </div>
          )}

          {loadingCreds && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "rgba(255,255,255,0.4)", fontFamily: fontStack, fontSize: 13 }}>
              Cargando credenciales...
            </div>
          )}

          {credentials && !loadingCreds && (
            <>
              <div style={{
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.18)",
                borderRadius: 10, padding: "10px 14px", marginBottom: 20,
                fontSize: 12, color: "rgba(255,255,255,0.55)", fontFamily: fontStack, lineHeight: 1.5,
              }}>
                🔒 La Stream Key es privada. No la compartas con nadie.
              </div>
              <CredentialRow label="URL RTMP (Server)" value={credentials.ingestUrl} />
              <CredentialRow label="Stream Key" value={credentials.streamKey} secret />
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", margin: "20px 0" }} />
              <div style={{ marginBottom: 4 }}>
                <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", fontFamily: fontStack, marginBottom: 14 }}>
                  {tLive("setupHowToObs")}
                </p>
                {[
                  "Abre OBS.",
                  "Ve a Settings → Stream.",
                  "En Service, selecciona Custom.",
                  "Pega la URL RTMP en el campo Server.",
                  "Pega la Stream Key en el campo Stream Key.",
                  "Haz clic en Apply y luego en Start Streaming.",
                ].map((step, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
                    <span style={{
                      flexShrink: 0, width: 22, height: 22, borderRadius: 999,
                      background: "rgba(168,85,255,0.18)", border: "1px solid rgba(168,85,255,0.3)",
                      display: "grid", placeItems: "center",
                      fontSize: 11, fontWeight: 700, color: "#d8b4fe", fontFamily: fontStack,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", fontFamily: fontStack, lineHeight: 1.5, paddingTop: 2 }}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
              {onOpenCreatorPanel && (
                <button
                  type="button"
                  onClick={() => { onClose(); onOpenCreatorPanel(); }}
                  style={{
                    marginTop: 20, width: "100%", padding: "11px 16px",
                    borderRadius: 10, border: "none",
                    background: "linear-gradient(135deg, rgba(168,85,255,0.85), rgba(124,58,237,0.85))",
                    color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: fontStack, cursor: "pointer",
                  }}
                >
                  {tLive("setupOpenControlPanel")}
                </button>
              )}
            </>
          )}
        </div>
      )}

    </div>
  );

  return createPortal(
    <>
      <style>{`
        @keyframes vibraLssIn {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes vibraLssOut {
          from { opacity: 1; transform: scale(1) translateY(0); }
          to   { opacity: 0; transform: scale(0.94) translateY(10px); }
        }
        @keyframes lssContentReveal {
          from { opacity: 0; clip-path: inset(0 0 100% 0); }
          to   { opacity: 1; clip-path: inset(0 0 0% 0); }
        }
        .lss-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .lss-scroll::-webkit-scrollbar-track { background: transparent; }
        .lss-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 999px; }
      `}</style>

      {/* Backdrop */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 999999,
          display: "flex",
          alignItems: isDesktop ? "center" : "flex-end",
          justifyContent: "center",
          padding: isDesktop ? 24 : 0,
          background: isDesktop ? "rgba(0,0,0,0.88)" : "rgba(0,0,0,0.52)",
          backdropFilter: isDesktop ? undefined : "blur(10px)",
          WebkitBackdropFilter: isDesktop ? undefined : "blur(10px)",
          fontFamily: "inherit",
        }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        {isDesktop ? (
          /* Desktop: panel centrado con animación CSS */
          <section
            style={{
              width: "min(100%, 540px)",
              maxHeight: "min(88vh, 680px)",
              display: "flex",
              flexDirection: "column",
              borderRadius: 18,
              background: "#0a0a0a",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
              color: "#fff",
              overflow: "hidden",
              animation: open
                ? "vibraLssIn 180ms ease-out"
                : "vibraLssOut 180ms ease-in forwards",
            }}
          >
            <header
              style={{
                height: 56,
                display: "grid",
                gridTemplateColumns: "48px 1fr 48px",
                alignItems: "center",
                padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.12)",
                flexShrink: 0,
              } as React.CSSProperties}
            >
              <div />
              <span style={{
                fontSize: 17, fontWeight: 500, color: "#fff",
                lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em",
              }}>
                {tLive("setupConfigure")}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label={tCommon("closeAriaLabel")}
                style={{
                  border: "none", background: "none", color: "#fff",
                  cursor: "pointer", display: "grid", placeItems: "center",
                  justifySelf: "end", padding: 4,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>
            {scrollContent}
          </section>
        ) : (
          /* Mobile: arquitectura 3 capas */
          /* Capa 1 — panel-outer: entrada/salida + cierre con drag + relleno de fondo */
          <div
            style={{
              width: "100%",
              maxHeight: "calc(100dvh - 72px)",
              display: "flex",
              flexDirection: "column",
              background: "rgba(8,9,11,0.96)",
              transform: open
                ? `translateY(${Math.max(0, panelOffsetY)}px)`
                : "translateY(100%)",
              transition: isPanelDragging
                ? "none"
                : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
              willChange: "transform",
            }}
          >
            {/* Capa 2 — section-wrapper: solo rubber band hacia arriba */}
            <div
              style={{
                transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
                transition: isPanelDragging
                  ? "none"
                  : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {/* Capa 3 — section: header + contenido, overflow hidden */}
              <section
                style={{
                  maxHeight: "calc(100dvh - 72px)",
                  borderRadius: "22px 22px 0 0",
                  background: "rgba(8,9,11,0.96)",
                  boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
                  color: "#fff",
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <header
                  onPointerDown={handleDragStart}
                  onPointerMove={handleDragMove}
                  onPointerUp={handleDragEnd}
                  onPointerCancel={handleDragEnd}
                  style={{
                    height: 56,
                    display: "grid",
                    gridTemplateColumns: "72px 1fr 72px",
                    alignItems: "center",
                    padding: "0 12px",
                    borderBottom: "1px solid rgba(255,255,255,0.07)",
                    flexShrink: 0,
                    touchAction: "none",
                    userSelect: "none",
                    WebkitUserSelect: "none",
                  } as React.CSSProperties}
                >
                  <div aria-hidden="true" />
                  <h3 style={{
                    margin: 0,
                    textAlign: "center",
                    fontSize: 17,
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.2,
                    color: "#fff",
                  }}>
                    {tLive("setupConfigure")}
                  </h3>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      width: 40, height: 40,
                      border: "none",
                      background: "transparent",
                      color: "rgba(255,255,255,0.86)",
                      cursor: "pointer",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 32,
                      fontWeight: 300,
                      lineHeight: 1,
                      justifySelf: "end",
                    }}
                  >
                    ×
                  </button>
                </header>
                {scrollContent}
              </section>
            </div>
          </div>
        )}
      </div>
      <VibraToast toast={toast} />
    </>,
    document.body
  );
}
