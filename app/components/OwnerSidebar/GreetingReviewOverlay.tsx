"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { GreetingRequestDoc, UserMini } from "./OwnerSidebar";

const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

function getRelativeTime(createdAt?: { toDate: () => Date } | null): string {
  if (!createdAt) return "Hace un momento";
  const diffMs = Date.now() - createdAt.toDate().getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays >= 1) return `Hace ${diffDays} ${diffDays === 1 ? "día" : "días"}`;
  if (diffHours >= 1) return `Hace ${diffHours} ${diffHours === 1 ? "hora" : "horas"}`;
  if (diffMins >= 1) return `Hace ${diffMins} ${diffMins === 1 ? "minuto" : "minutos"}`;
  return "Hace un momento";
}

type ViewState = "review" | "camera";
type RecordPhase = "preview" | "recording" | "done";

type Props = {
  item: { id: string; data: GreetingRequestDoc };
  buyer: UserMini | null;
  busy: boolean;
  onAccept: () => void;
  onReject: () => void;
  onClose: () => void;
  getInitials: (name?: string | null) => string;
  typeLabel: (t: string) => string;
};

export default function GreetingReviewOverlay({
  item,
  buyer,
  busy,
  onAccept,
  onReject,
  onClose,
  getInitials,
  typeLabel,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [earningFormatted, setEarningFormatted] = useState<string | null>(null);
  const [viewState, setViewState] = useState<ViewState>("review");
  const [recordPhase, setRecordPhase] = useState<RecordPhase>("preview");
  const [isMobile, setIsMobile] = useState(false);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Fetch earning from Firestore
  useEffect(() => {
    const req = item.data;
    const source = req.source ?? "group";
    const id = source === "profile" ? req.profileUserId ?? req.creatorId : req.groupId;
    if (!id) return;
    const col = source === "profile" ? "users" : "groups";
    getDoc(doc(db, col, id)).then((snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      const offerings = Array.isArray(data.offerings)
        ? (data.offerings as Array<Record<string, unknown>>)
        : [];
      const offering = offerings.find((o) => o.type === req.type);
      if (!offering) return;
      const rawPrice =
        typeof offering.memberPrice === "number"
          ? offering.memberPrice
          : typeof offering.price === "number"
            ? offering.price
            : null;
      if (rawPrice == null || rawPrice <= 0) return;
      const net = rawPrice * 0.77;
      const cur = typeof offering.currency === "string" ? offering.currency : "MXN";
      setEarningFormatted(
        "$" +
          new Intl.NumberFormat("es-MX", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(net) +
          ` ${cur}`
      );
    }).catch(() => {});
  }, [item]);

  // Attach stream to video element after camera activates
  useEffect(() => {
    if (viewState === "camera" && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [viewState]);

  // Cleanup stream and blob URL on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  // Seconds counter while recording — auto-stops at max duration
  useEffect(() => {
    if (recordPhase !== "recording") { setRecordingSeconds(0); return; }
    const maxSeconds = item.data.type === "saludo" ? 240 : item.data.type === "consejo" ? 420 : 240;
    const id = setInterval(() => {
      setRecordingSeconds((s) => {
        const next = s + 1;
        if (next >= maxSeconds) recorderRef.current?.stop();
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [recordPhase, item.data.type]);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  function getRecordingMessage(seconds: number, type: string): string | null {
    if (type === "saludo") {
      if (seconds >= 210) {
        const rem = 240 - seconds;
        return rem > 0 ? `El saludo concluirá en ${rem} ${rem === 1 ? "segundo" : "segundos"}` : null;
      }
      if (seconds >= 180 && seconds < 190) return "Este saludo es considerablemente más largo de lo habitual";
      if (seconds >= 120 && seconds < 130) return "Este saludo ya supera la duración habitual";
      if (seconds >= 60 && seconds < 70) return "Ya estás en el tiempo promedio de un saludo personalizado";
    }
    if (type === "consejo") {
      if (seconds >= 390) {
        const rem = 420 - seconds;
        return rem > 0 ? `El consejo concluirá en ${rem} ${rem === 1 ? "segundo" : "segundos"}` : null;
      }
      if (seconds >= 300 && seconds < 310) return "Este consejo ya supera la duración habitual";
      if (seconds >= 150 && seconds < 160) return "Ya estás en el tiempo promedio de un consejo";
    }
    return null;
  }

  const req = item.data;
  const buyerLetter = getInitials(buyer?.displayName);

  const titleText =
    req.type === "consejo"
      ? "Revisar Consejo"
      : req.type === "mensaje"
        ? "Revisar Mensaje"
        : "Revisar Saludo";

  const cameraTitleText =
    req.type === "consejo"
      ? "Responder Consejo"
      : req.type === "mensaje"
        ? "Responder Mensaje"
        : "Responder Saludo";

  const handleGrabar = async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      setViewState("camera");
      setRecordPhase("preview");
    } catch {
      setCameraError("No se pudo acceder a la cámara. Verifica los permisos.");
    }
  };

  const handleStartRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mr = new MediaRecorder(streamRef.current);
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      // Stop camera tracks — release webcam
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      // Build playback URL
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setRecordedBlobUrl(url);
      setRecordPhase("done");
    };
    mr.start();
    recorderRef.current = mr;
    setRecordPhase("recording");
  };

  const handleStopRecording = () => { recorderRef.current?.stop(); };

  const handleRepeat = async () => {
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    setRecordedBlobUrl(null);
    recorderRef.current = null;
    chunksRef.current = [];
    setRecordingSeconds(0);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setRecordPhase("preview");
    } catch {
      setCameraError("No se pudo acceder a la cámara.");
      stopCamera();
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    setRecordedBlobUrl(null);
    setViewState("review");
    setRecordPhase("preview");
    setRecordingSeconds(0);
    setSheetExpanded(false);
    setCameraError(null);
  };

  const handleClose = () => { stopCamera(); onClose(); };

  if (!mounted) return null;

  // ─── Shared sub-sections ────────────────────────────────────────────────────

  const buyerRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {buyer?.photoURL ? (
        <img
          src={buyer.photoURL}
          alt={buyer.displayName}
          style={{
            width: 38, height: 38, borderRadius: 12, objectFit: "cover",
            border: "1px solid rgba(255,255,255,0.12)", flexShrink: 0,
          }}
        />
      ) : (
        <div style={{
          width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center",
          justifyContent: "center", fontWeight: 700, fontSize: 13, color: "#fff", flexShrink: 0,
        }}>
          {buyerLetter}
        </div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {buyer?.handle ? (
          <Link href={`/u/${buyer.handle}`} onClick={handleClose} style={{
            color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2,
            textDecoration: "none", display: "block", overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {buyer.displayName}
          </Link>
        ) : (
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>
            {buyer?.displayName ?? "Usuario"}
          </span>
        )}
        <span style={{ display: "block", color: "rgba(255,255,255,0.42)", fontSize: 11, lineHeight: 1.3 }}>
          {getRelativeTime(req.createdAt)}
        </span>
      </div>
      {earningFormatted && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0, gap: 2 }}>
          <span style={{ color: "#86efac", fontWeight: 500, fontSize: 11, letterSpacing: "0.01em", lineHeight: 1 }}>
            Tu ganancia
          </span>
          <span style={{ color: "#86efac", fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em", lineHeight: 1 }}>
            {earningFormatted}
          </span>
        </div>
      )}
    </div>
  );

  const divider = <div style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />;

  const infoSection = (
    <>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>¿Para quién es?</span>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{req.toName}</span>
      </div>
      {req.instructions ? (
        <div style={{ display: "grid", gap: 4 }}>
          <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
            {req.type === "consejo" ? "¿Cuál es el contexto del consejo?" : "¿Cuál es el contexto del saludo?"}
          </span>
          <span style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.5, color: "rgba(255,255,255,0.82)" }}>
            {req.instructions}
          </span>
        </div>
      ) : null}
    </>
  );

  const recordControls = recordPhase === "done" ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button type="button" onClick={handleRepeat} disabled={busy} style={{
        width: "100%", height: 38, borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)",
        color: "rgba(255,255,255,0.65)", fontWeight: 600, fontSize: 13,
        cursor: busy ? "not-allowed" : "pointer", fontFamily: fontStack,
      }}>
        Repetir grabación
      </button>
      <button type="button" onClick={onAccept} disabled={busy} style={{
        width: "100%", height: 42, borderRadius: 10,
        border: "1px solid rgba(34,197,94,0.3)",
        background: busy ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.2)",
        color: busy ? "rgba(134,239,172,0.45)" : "#86efac",
        fontWeight: 700, fontSize: 14, cursor: busy ? "not-allowed" : "pointer", fontFamily: fontStack,
      }}>
        {busy ? "Enviando..." : `Enviar ${req.type === "consejo" ? "consejo" : "saludo"}`}
      </button>
    </div>
  ) : null;

  // Button overlaid on the camera zone
  const cameraRecordButton = recordPhase !== "done" ? (
    <button
      type="button"
      onClick={recordPhase === "preview" ? handleStartRecording : handleStopRecording}
      style={{
        position: "absolute", bottom: 28, left: "50%", transform: "translateX(-50%)",
        width: 68, height: 68, borderRadius: "50%",
        border: "3px solid rgba(255,255,255,0.88)",
        background: "transparent",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", padding: 0,
      }}
    >
      {recordPhase === "recording" ? (
        <div style={{ width: 26, height: 26, borderRadius: 6, background: "#ef4444" }} />
      ) : (
        <div style={{ width: 50, height: 50, borderRadius: "50%", background: "#ef4444" }} />
      )}
    </button>
  ) : null;

  const containerBase: React.CSSProperties = {
    background: "linear-gradient(145deg, rgb(6,3,12) 0%, rgb(10,5,20) 100%)",
    border: "1px solid rgba(168,85,255,0.15)",
    borderRadius: 16,
    padding: 20,
    boxSizing: "border-box",
    boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
    fontFamily: fontStack,
  };

  // ─── MOBILE CAMERA VIEW ──────────────────────────────────────────────────────
  if (viewState === "camera" && isMobile) {
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: 10050, fontFamily: fontStack }}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
        {/* Close */}
        <button type="button" onClick={handleClose} style={{
          position: "absolute", top: 16, right: 16, zIndex: 3,
          background: "rgba(0,0,0,0.55)", border: "none", color: "rgba(255,255,255,0.8)",
          cursor: "pointer", width: 36, height: 36, borderRadius: "50%",
          fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          ✕
        </button>

        {/* Milestone message above record button */}
        {recordPhase === "recording" && getRecordingMessage(recordingSeconds, req.type) && (
          <div style={{
            position: "absolute", bottom: 178, left: "50%", transform: "translateX(-50%)", zIndex: 3,
            background: "rgba(0,0,0,0.62)", borderRadius: 20, padding: "5px 14px",
            color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: fontStack,
            whiteSpace: "nowrap", backdropFilter: "blur(4px)",
          }}>
            {getRecordingMessage(recordingSeconds, req.type)}
          </div>
        )}

        {/* Record button overlaid on camera */}
        {cameraRecordButton && (
          <div style={{ position: "absolute", bottom: 100, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 3 }}>
            {cameraRecordButton}
          </div>
        )}

        {/* Timer overlaid on camera */}
        {recordPhase === "recording" && (
          <div style={{
            position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: 3,
            background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "4px 14px",
            display: "flex", alignItems: "center", gap: 7,
            color: "#fff", fontWeight: 600, fontSize: 14, fontFamily: fontStack,
          }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "block" }} />
            {formatTime(recordingSeconds)}
          </div>
        )}

        {/* Bottom sheet */}
        <div style={{
          position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 2,
          background: "rgba(6,3,12,0.94)",
          borderRadius: "16px 16px 0 0",
          backdropFilter: "blur(12px)",
          transform: `translateY(${sheetExpanded ? "0%" : "calc(100% - 90px)"})`,
          transition: "transform 320ms cubic-bezier(0.4,0,0.2,1)",
          maxHeight: "75vh",
          overflowY: "auto",
        }}>
          {/* Handle */}
          <div onClick={() => setSheetExpanded((v) => !v)} style={{
            display: "flex", justifyContent: "center", padding: "10px 0 8px", cursor: "pointer",
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.28)" }} />
          </div>

          <div style={{ padding: "0 16px 32px", display: "grid", gap: 14 }}>
            {recordControls}
            {sheetExpanded && (
              <>
                {divider}
                {buyerRow}
                {divider}
                {infoSection}
              </>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ─── DESKTOP CAMERA VIEW ─────────────────────────────────────────────────────
  if (viewState === "camera" && !isMobile) {
    return createPortal(
      <div style={{
        position: "fixed", inset: 0, zIndex: 10050,
        background: "rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "20px 24px", boxSizing: "border-box", fontFamily: fontStack,
      }}
        onClick={handleClose}
      >
        <div style={{
          ...containerBase,
          width: "90vw",
          maxWidth: 1100,
          height: "min(82vh, 720px)",
          display: "flex",
          flexDirection: "row",
          gap: 24,
          alignItems: "stretch",
          overflow: "hidden",
          padding: 0,
        }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Left: info panel — narrow, scrollable */}
          <div style={{
            width: "clamp(220px, 24%, 280px)",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            overflowY: "auto",
            padding: 20,
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ color: "#fff", fontWeight: 500, fontSize: 16, letterSpacing: "-0.02em" }}>
                {cameraTitleText}
              </span>
              <button type="button" onClick={handleClose} style={{
                background: "transparent", border: "none", color: "rgba(255,255,255,0.45)",
                cursor: "pointer", padding: "4px 6px", fontSize: 16, lineHeight: 1, borderRadius: 8,
              }}>
                ✕
              </button>
            </div>
            {buyerRow}
            {divider}
            {infoSection}
            <div style={{ marginTop: "auto", paddingTop: 8 }}>
              {recordControls}
            </div>
          </div>

          {/* Right: camera / playback fills remaining height */}
          <div style={{ flex: 1, minWidth: 0, padding: "20px 20px 20px 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center" }}>

              {/* Live webcam — hidden when done */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                disablePictureInPicture
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  height: "100%", width: "auto", maxWidth: "100%",
                  borderRadius: 14, objectFit: "contain", background: "#000",
                  display: recordPhase === "done" ? "none" : "block",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              />

              {/* Playback video — shown when done */}
              {recordPhase === "done" && recordedBlobUrl && (
                <video
                  src={recordedBlobUrl}
                  controls
                  playsInline
                  disablePictureInPicture
                  onContextMenu={(e) => e.preventDefault()}
                  style={{
                    height: "100%", width: "auto", maxWidth: "100%",
                    borderRadius: 14, objectFit: "contain", background: "#000",
                    display: "block", border: "1px solid rgba(255,255,255,0.08)",
                  }}
                />
              )}

              {/* Timer */}
              {recordPhase === "recording" && (
                <div style={{
                  position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.55)", borderRadius: 20, padding: "4px 14px",
                  display: "flex", alignItems: "center", gap: 7,
                  color: "#fff", fontWeight: 600, fontSize: 14, fontFamily: fontStack,
                  backdropFilter: "blur(4px)",
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", display: "block", flexShrink: 0 }} />
                  {formatTime(recordingSeconds)}
                </div>
              )}
              {/* Milestone message */}
              {recordPhase === "recording" && getRecordingMessage(recordingSeconds, req.type) && (
                <div style={{
                  position: "absolute", bottom: 110, left: "50%", transform: "translateX(-50%)",
                  background: "rgba(0,0,0,0.62)", borderRadius: 20, padding: "5px 14px",
                  color: "#fff", fontWeight: 500, fontSize: 12, fontFamily: fontStack,
                  whiteSpace: "nowrap", backdropFilter: "blur(4px)", textAlign: "center",
                }}>
                  {getRecordingMessage(recordingSeconds, req.type)}
                </div>
              )}
              {cameraRecordButton}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // ─── REVIEW VIEW (default) ───────────────────────────────────────────────────
  return createPortal(
    <div style={{
      position: "fixed", inset: 0, zIndex: 10050,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, boxSizing: "border-box", fontFamily: fontStack,
    }}
      onClick={handleClose}
    >
      <div style={{ ...containerBase, width: "100%", maxWidth: 380, display: "grid", gap: 16 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#fff", fontWeight: 500, fontSize: 17, letterSpacing: "-0.02em" }}>
            {titleText}
          </span>
          <button type="button" onClick={handleClose} style={{
            background: "transparent", border: "none", color: "rgba(255,255,255,0.45)",
            cursor: "pointer", padding: "4px 6px", fontSize: 16, lineHeight: 1, borderRadius: 8,
          }}>
            ✕
          </button>
        </div>

        {buyerRow}
        {divider}
        {infoSection}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={handleGrabar} disabled={busy} style={{
            flex: 1, height: 38, borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.35)", background: busy ? "rgba(59,130,246,0.06)" : "rgba(59,130,246,0.18)",
            color: busy ? "rgba(147,197,253,0.4)" : "#93c5fd",
            fontWeight: 700, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
            fontFamily: fontStack, transition: "background 150ms",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span style={{
              width: 16, height: 16, borderRadius: "50%",
              border: "2px solid rgba(255,255,255,0.85)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: "#ef4444",
                display: "block",
              }} />
            </span>
            Comenzar
          </button>
          <button type="button" onClick={onReject} disabled={busy} style={{
            flex: 1, height: 38, borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)",
            color: busy ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.65)",
            fontWeight: 600, fontSize: 13, cursor: busy ? "not-allowed" : "pointer",
            fontFamily: fontStack, transition: "background 150ms",
          }}>
            {busy ? "Procesando..." : "Rechazar"}
          </button>
        </div>
        {cameraError && (
          <span style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{cameraError}</span>
        )}
      </div>
    </div>,
    document.body
  );
}
