"use client";

import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

type Currency = "MXN" | "USD";
type DonationMode = "none" | "general" | "wedding";

type DonationFields = {
  donationMode: DonationMode;
  donationCurrency: Currency;
  donationMinimumAmount: string;
  donationGoalLabel: string;
  donationVideoUrl: string;
  donationPlaybackId: string;
};

type AnyDraft = DonationFields & Record<string, unknown>;

type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
};

type ModeButtonProps = {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

type OverlayModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

type Props = {
  draft: AnyDraft;
  saving: boolean;
  profileUserId: string;
  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;
  SwitchComponent: React.ComponentType<SwitchProps>;
  DonationModeButtonComponent: React.ComponentType<ModeButtonProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;
  onSaveDraft: (nextDraft: AnyDraft) => Promise<void>;
};

type OverlayMode = null | "activate" | "edit";

const VIDEO_MAX_SECONDS = 300; // 5 minutes

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    video.src = url;
  });
}

export default function ProfileDonation({
  draft,
  saving,
  profileUserId,
  panelStyle,
  titleStyle,
  subtleStyle,
  inputStyle,
  buttonSecondaryStyle,
  SwitchComponent,
  DonationModeButtonComponent,
  OverlayModalComponent,
  onSaveDraft,
}: Props) {
  const isEnabled = draft.donationMode !== "none";

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<AnyDraft>(draft);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPending, setUploadPending] = useState(false); // uploaded but playbackId not yet arrived
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const playbackListenerRef = useRef<(() => void) | null>(null);

  // Clean up any pending playbackId listener on unmount
  useEffect(() => {
    return () => { playbackListenerRef.current?.(); };
  }, []);

  const isBusy = saving || uploadProgress !== null;

  function buildEnabledDraft(base: AnyDraft): AnyDraft {
    return {
      ...base,
      donationMode: base.donationMode === "none" ? "general" : base.donationMode,
    };
  }

  function buildDisabledDraft(base: AnyDraft): AnyDraft {
    return {
      ...base,
      donationMode: "none",
      donationMinimumAmount: "",
      donationGoalLabel: "",
    };
  }

  function stopPlaybackListener() {
    playbackListenerRef.current?.();
    playbackListenerRef.current = null;
  }

  function openOverlay(mode: OverlayMode, next?: AnyDraft) {
    stopPlaybackListener();
    setOverlayMode(mode);
    setOverlayDraft(next ?? draft);
    setUploadErr(null);
    setUploadPending(false);
  }

  function closeOverlay() {
    if (isBusy) return;
    stopPlaybackListener();
    setOverlayMode(null);
    setOverlayDraft(draft);
  }

  const [saveErr, setSaveErr] = useState<string | null>(null);

  async function confirmOverlaySave() {
    if (isBusy) return;
    setSaveErr(null);

    const amount = parseFloat(overlayDraft.donationMinimumAmount as string);
    if (isNaN(amount) || amount <= 0) {
      setSaveErr("Debes definir un monto mínimo válido.");
      return;
    }

    const hasVideo = Boolean(overlayDraft.donationPlaybackId) || uploadPending;
    if (!hasVideo) {
      setSaveErr("Debes subir un video de presentación.");
      return;
    }

    if (overlayDraft.donationMode === "wedding" && !(overlayDraft.donationGoalLabel as string).trim()) {
      setSaveErr("Debes escribir el texto del botón para boda.");
      return;
    }

    await onSaveDraft(overlayDraft);
    stopPlaybackListener();
    setOverlayMode(null);
  }

  async function handleToggle(next: boolean) {
    if (isBusy) return;
    if (!isEnabled && next) {
      openOverlay("activate", buildEnabledDraft(draft));
      return;
    }
    if (isEnabled && !next) {
      await onSaveDraft(buildDisabledDraft(draft));
    }
  }

  function handleModify() {
    if (isBusy) return;
    openOverlay("edit", buildEnabledDraft(draft));
  }

  async function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(null);
    setUploadPending(false);

    // Validate duration
    const duration = await getVideoDuration(file);
    if (duration > VIDEO_MAX_SECONDS) {
      setUploadErr(`El video no puede durar más de 5 minutos (duración: ${Math.round(duration)}s).`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadProgress(0);

    try {
      // 1. Get Mux upload URL from Cloud Function
      const callable = httpsCallable<{ profileId: string }, { uploadId: string; uploadUrl: string }>(
        functions,
        "createMuxDonationUpload"
      );
      const result = await callable({ profileId: profileUserId });
      const { uploadUrl, uploadId } = result.data;

      // 2. PUT file to Mux with XHR for progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.onprogress = (ev) => {
          if (ev.total > 0) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload falló: ${xhr.status}`));
        };
        xhr.onerror = () => { xhrRef.current = null; reject(new Error("Error de red al subir")); };
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.send(file);
      });

      // 3. Upload done — mark pending and listen for webhook to write playbackId
      setOverlayDraft((p) => ({ ...p, donationVideoUrl: `mux://uploads/${uploadId}` }));
      setUploadPending(true);

      // Real-time listener: when webhook updates donation.playbackId, capture it in the draft
      stopPlaybackListener();
      const unsub = onSnapshot(doc(db, "users", profileUserId), (snap) => {
        const playbackId = snap.data()?.donation?.playbackId;
        if (typeof playbackId === "string" && playbackId) {
          setOverlayDraft((p) => ({ ...p, donationPlaybackId: playbackId }));
          setUploadPending(false);
          stopPlaybackListener();
        }
      });
      playbackListenerRef.current = unsub;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "No se pudo subir el video.";
      setUploadErr(msg);
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function renderSummary() {
    if (!isEnabled) return null;
    const modeLabel = draft.donationMode === "wedding" ? "Para boda" : "Donación general";
    const amount = draft.donationMinimumAmount
      ? `${draft.donationMinimumAmount} ${draft.donationCurrency}`
      : null;
    const hasVideo = Boolean(draft.donationPlaybackId);

    return (
      <div
        style={{
          display: "grid",
          gap: 10,
          padding: "10px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Tipo</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{modeLabel}</div>
        </div>

        {amount && (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={subtleStyle}>Monto mínimo</div>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{amount}</div>
          </div>
        )}

        {draft.donationMode === "wedding" && draft.donationGoalLabel && (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={subtleStyle}>Texto del botón</div>
            <div style={{ color: "#fff", fontSize: 14 }}>{draft.donationGoalLabel as string}</div>
          </div>
        )}

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Video de presentación</div>
          <div style={{ color: hasVideo ? "#a3e635" : "rgba(255,255,255,0.4)", fontSize: 13 }}>
            {hasVideo ? "✓ Video listo" : "Sin video"}
          </div>
        </div>

        <button
          type="button"
          onClick={handleModify}
          disabled={isBusy}
          style={{
            ...buttonSecondaryStyle,
            width: "auto",
            justifySelf: "flex-start",
            opacity: isBusy ? 0.7 : 1,
            cursor: isBusy ? "not-allowed" : "pointer",
          }}
        >
          Modificar
        </button>
      </div>
    );
  }

  // Resolved playbackId — either from saved draft or already uploaded in this session but pending
  const savedPlaybackId = draft.donationPlaybackId as string;
  const overlayPlaybackId = overlayDraft.donationPlaybackId as string;

  return (
    <>
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={titleStyle}>🎁 Donación / Apoyo</span>
          </div>
          <SwitchComponent
            checked={isEnabled}
            disabled={isBusy}
            onChange={(next) => { void handleToggle(next); }}
            label="Activar donaciones"
          />
        </div>
        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title="🎁 Configurar donación"
        loading={isBusy}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        {/* Mode selector */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>Tipo de donación</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <DonationModeButtonComponent
              active={overlayDraft.donationMode === "general"}
              disabled={isBusy}
              label="Donación general"
              onClick={() => setOverlayDraft((p) => ({ ...p, donationMode: "general", donationGoalLabel: "" }))}
            />
            <DonationModeButtonComponent
              active={overlayDraft.donationMode === "wedding"}
              disabled={isBusy}
              label="Para boda"
              onClick={() => setOverlayDraft((p) => ({ ...p, donationMode: "wedding" }))}
            />
          </div>
        </div>

        {/* Amount + currency */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>Monto mínimo</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              min="1"
              step="1"
              value={overlayDraft.donationMinimumAmount as string}
              onChange={(e) => setOverlayDraft((p) => ({ ...p, donationMinimumAmount: e.target.value }))}
              placeholder="Ej. 50"
              disabled={isBusy}
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={overlayDraft.donationCurrency as string}
              onChange={(e) => setOverlayDraft((p) => ({ ...p, donationCurrency: e.target.value as Currency }))}
              disabled={isBusy}
              style={{ ...inputStyle, width: 90 }}
            >
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        {/* Wedding label */}
        {overlayDraft.donationMode === "wedding" && (
          <div>
            <div style={{ ...subtleStyle, marginBottom: 8 }}>Texto visible en el botón</div>
            <input
              type="text"
              value={overlayDraft.donationGoalLabel as string}
              onChange={(e) => setOverlayDraft((p) => ({ ...p, donationGoalLabel: e.target.value }))}
              placeholder="Ej. Apoyo para nuestra boda"
              disabled={isBusy}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
        )}

        {/* Video upload */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>Video de presentación (máx. 5 min)</div>

          {/* Already has a ready playbackId */}
          {overlayPlaybackId && !uploadPending && uploadProgress === null && (
            <div style={{ ...subtleStyle, color: "#a3e635", marginBottom: 8 }}>✓ Video listo</div>
          )}

          {/* Saved playbackId from draft but overlayDraft hasn't picked it up yet */}
          {!overlayPlaybackId && savedPlaybackId && !uploadPending && uploadProgress === null && (
            <div style={{ ...subtleStyle, color: "#a3e635", marginBottom: 8 }}>✓ Video listo</div>
          )}

          {/* Upload in progress */}
          {uploadProgress !== null && (
            <div style={{ ...subtleStyle, marginBottom: 8 }}>Subiendo video… {uploadProgress}%</div>
          )}

          {/* Pending processing */}
          {uploadPending && uploadProgress === null && (
            <div style={{ ...subtleStyle, color: "rgba(255,200,80,0.9)", marginBottom: 8 }}>
              ⏳ Procesando video, puede tardar unos minutos…
            </div>
          )}

          {uploadProgress === null && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              style={{
                ...buttonSecondaryStyle,
                opacity: isBusy ? 0.6 : 1,
                cursor: isBusy ? "not-allowed" : "pointer",
              }}
            >
              {overlayPlaybackId || savedPlaybackId ? "Cambiar video" : "Subir video"}
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleVideoSelect}
            style={{ display: "none" }}
          />

          {uploadErr && (
            <div style={{ ...subtleStyle, color: "rgba(255,120,120,0.9)", marginTop: 6 }}>{uploadErr}</div>
          )}
        </div>

        {saveErr && (
          <div style={{ color: "rgba(255,120,120,0.95)", fontSize: 13, fontWeight: 600 }}>{saveErr}</div>
        )}
      </OverlayModalComponent>
    </>
  );
}
