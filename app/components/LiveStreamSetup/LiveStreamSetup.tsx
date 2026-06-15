"use client";

import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  callCreateMuxLiveStream,
  fetchLiveStreamCredentials,
} from "@/lib/posts/post-service";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

type Props = {
  open: boolean;
  onClose: () => void;
  postId: string;
  liveStreamId?: string | null;
  onStreamCreated?: (liveStreamId: string, playbackId: string | null) => void;
};

type Credentials = {
  streamKey: string;
  ingestUrl: string;
  liveStreamId: string;
};

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: do nothing silently
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
      {copied ? "¡Copiado!" : "Copiar"}
    </button>
  );
}

function CredentialRow({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret);

  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.4)",
          marginBottom: 6,
          fontFamily: fontStack,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: "8px 10px",
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: "monospace",
            color: secret && !revealed ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.85)",
            wordBreak: "break-all",
            lineHeight: 1.5,
            letterSpacing: secret && !revealed ? "0.2em" : undefined,
          }}
        >
          {secret && !revealed ? "•".repeat(24) : value}
        </span>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {secret && (
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.5)",
                fontSize: 12,
                fontFamily: fontStack,
                cursor: "pointer",
              }}
            >
              {revealed ? "Ocultar" : "Ver"}
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
  onStreamCreated,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [loadingCreds, setLoadingCreds] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (open) { setShouldRender(true); return; }
    const t = window.setTimeout(() => setShouldRender(false), 200);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const loadCredentials = useCallback(async () => {
    setLoadingCreds(true);
    setError(null);
    try {
      const creds = await fetchLiveStreamCredentials(postId);
      setCredentials(creds);
    } catch {
      setError("No se pudieron cargar las credenciales.");
    } finally {
      setLoadingCreds(false);
    }
  }, [postId]);

  useEffect(() => {
    if (open && liveStreamId) {
      loadCredentials();
    }
    if (!open) {
      setCredentials(null);
      setError(null);
    }
  }, [open, liveStreamId, loadCredentials]);

  async function handleCreateStream() {
    setCreating(true);
    setError(null);
    try {
      const result = await callCreateMuxLiveStream(postId);
      onStreamCreated?.(result.liveStreamId, result.playbackId);
      await loadCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el stream.");
    } finally {
      setCreating(false);
    }
  }

  if (!shouldRender || !mounted) return null;

  const hasStream = !!(liveStreamId || credentials);

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,0.72)",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    padding: "0 0 env(safe-area-inset-bottom, 0)",
    animation: open ? "fadeIn 0.18s ease" : "fadeOut 0.18s ease forwards",
  };

  const panel: CSSProperties = {
    width: "100%",
    maxWidth: 520,
    maxHeight: "88vh",
    overflowY: "auto",
    borderRadius: "16px 16px 0 0",
    background: "rgba(12,7,24,0.98)",
    border: "1px solid rgba(168,85,255,0.2)",
    borderBottom: "none",
    padding: "20px 20px 32px",
    animation: open ? "slideUp 0.2s ease" : "slideDown 0.2s ease forwards",
  };

  return createPortal(
    <>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fadeOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes slideUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @keyframes slideDown { from { transform: translateY(0) } to { transform: translateY(100%) } }
      `}</style>
      <div style={overlay} onClick={onClose}>
        <div style={panel} onClick={(e) => e.stopPropagation()}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: "rgba(239,68,68,0.15)",
                border: "1px solid rgba(239,68,68,0.3)",
                display: "grid", placeItems: "center",
              }}>
                <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="10" stroke="#ef4444" strokeWidth="1.4" fill="none" />
                  <circle cx="11" cy="11" r="6" fill="#ef4444" />
                </svg>
              </div>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>
                Configurar transmisión
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 999,
                border: "none", background: "rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.5)", cursor: "pointer",
                fontSize: 16, display: "grid", placeItems: "center",
                fontFamily: fontStack,
              }}
            >
              ×
            </button>
          </div>

          {/* No stream yet */}
          {!hasStream && !loadingCreds && (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              <p style={{
                fontSize: 14, color: "rgba(255,255,255,0.55)",
                fontFamily: fontStack, marginBottom: 20, lineHeight: 1.5,
              }}>
                Activa el stream en Mux para obtener tu URL RTMP y Stream Key, y poder transmitir desde OBS u otro software.
              </p>
              <button
                type="button"
                onClick={handleCreateStream}
                disabled={creating}
                style={{
                  padding: "12px 28px",
                  borderRadius: 10,
                  border: "none",
                  background: creating ? "rgba(168,85,255,0.35)" : "linear-gradient(135deg,#a855ff,#7c3aed)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: fontStack,
                  cursor: creating ? "not-allowed" : "pointer",
                }}
              >
                {creating ? "Activando..." : "Activar stream"}
              </button>
              {error && (
                <p style={{ marginTop: 12, fontSize: 12, color: "#f87171", fontFamily: fontStack }}>
                  {error}
                </p>
              )}
            </div>
          )}

          {/* Loading credentials */}
          {loadingCreds && (
            <div style={{ textAlign: "center", padding: "32px 0", color: "rgba(255,255,255,0.4)", fontFamily: fontStack, fontSize: 13 }}>
              Cargando credenciales...
            </div>
          )}

          {/* Credentials loaded */}
          {credentials && !loadingCreds && (
            <>
              <div style={{
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.18)",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 20,
                fontSize: 12,
                color: "rgba(255,255,255,0.55)",
                fontFamily: fontStack,
                lineHeight: 1.5,
              }}>
                🔒 La Stream Key es privada. No la compartas con nadie.
              </div>

              <CredentialRow label="URL RTMP (Server)" value={credentials.ingestUrl} />
              <CredentialRow label="Stream Key" value={credentials.streamKey} secret />

              {/* Divider */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", margin: "20px 0" }} />

              {/* OBS instructions */}
              <div style={{ marginBottom: 4 }}>
                <p style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.35)",
                  fontFamily: fontStack,
                  marginBottom: 14,
                }}>
                  Cómo configurar OBS
                </p>
                {[
                  "Abre OBS.",
                  "Ve a Settings → Stream.",
                  "En Service, selecciona Custom.",
                  "Pega la URL RTMP en el campo Server.",
                  "Pega la Stream Key en el campo Stream Key.",
                  "Haz clic en Apply y luego en Start Streaming.",
                ].map((step, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      marginBottom: 10,
                    }}
                  >
                    <span style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: "rgba(168,85,255,0.18)",
                      border: "1px solid rgba(168,85,255,0.3)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#d8b4fe",
                      fontFamily: fontStack,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{
                      fontSize: 13,
                      color: "rgba(255,255,255,0.65)",
                      fontFamily: fontStack,
                      lineHeight: 1.5,
                      paddingTop: 2,
                    }}>
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {error && hasStream && (
            <p style={{ marginTop: 12, fontSize: 12, color: "#f87171", fontFamily: fontStack }}>
              {error}
            </p>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
