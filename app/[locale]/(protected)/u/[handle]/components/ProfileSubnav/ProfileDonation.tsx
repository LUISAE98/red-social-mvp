"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

type Currency = "MXN" | "USD";
type DonationMode = "none" | "general" | "wedding";

type DonationFields = {
  donationMode: DonationMode;
  donationCurrency: Currency;
  donationMinimumAmount: string;
  donationMessage: string;
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
  const tProfile = useTranslations("profile");
  const tCommon = useTranslations("common");
  const { format: formatMoney, resolveStoredPrice, toDisplayForInput, currency: displayCurrency, formatAnchor } =
    usePriceFormat();

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
      donationMessage: "",
    };
  }

  function stopPlaybackListener() {
    playbackListenerRef.current?.();
    playbackListenerRef.current = null;
  }

  function openOverlay(mode: OverlayMode, next?: AnyDraft) {
    stopPlaybackListener();
    const src = next ?? draft;
    // Mostrar el mínimo guardado (MXN) en la moneda del creador para editarlo.
    const stored = src.donationMinimumAmount as string;
    const n = Number(stored);
    const shown =
      stored !== "" && Number.isFinite(n) && n > 0
        ? String(
            Math.round(
              toDisplayForInput(n, (src.donationCurrency as string) ?? "MXN") * 100
            ) / 100
          )
        : stored;
    setOverlayMode(mode);
    setOverlayDraft({ ...src, donationMinimumAmount: shown });
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
      setSaveErr(tProfile("donationInvalidAmount"));
      return;
    }

    const hasVideo = Boolean(overlayDraft.donationPlaybackId) || uploadPending;
    if (!hasVideo) {
      setSaveErr(tProfile("donationNoVideo"));
      return;
    }

    if (!(overlayDraft.donationMessage as string).trim()) {
      setSaveErr(tProfile("donationNoMessage"));
      return;
    }
    if ((overlayDraft.donationMessage as string).trim().length > 160) {
      setSaveErr(tProfile("donationMessageTooLong"));
      return;
    }

    // El creador tecleó en su moneda; guardamos en MXN (ancla).
    const { price, currency } = resolveStoredPrice(amount);
    const toSave: AnyDraft = {
      ...overlayDraft,
      donationMinimumAmount: String(price),
      donationCurrency: currency,
    };

    await onSaveDraft(toSave);
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
      setUploadErr(tProfile("donationVideoTooLong", { duration: Math.round(duration) }));
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
          else reject(new Error(tProfile("donationUploadFailed", { status: xhr.status })));
        };
        xhr.onerror = () => { xhrRef.current = null; reject(new Error(tProfile("donationNetworkError"))); };
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
      const msg = err instanceof Error ? err.message : tProfile("donationUploadDefault");
      setUploadErr(msg);
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function renderSummary() {
    if (!isEnabled) return null;
    const modeLabel = tCommon("donation");
    const amount = draft.donationMinimumAmount
      ? formatMoney(Number(draft.donationMinimumAmount), { baseCurrency: draft.donationCurrency ?? "MXN" })
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
          <div style={subtleStyle}>{tProfile("donationTypeLabel")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{modeLabel}</div>
        </div>

        {amount && (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={subtleStyle}>{tProfile("donationMinAmount")}</div>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{amount}</div>
          </div>
        )}

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>{tProfile("donationPresentationVideo")}</div>
          <div style={{ color: hasVideo ? "#a3e635" : "rgba(255,255,255,0.4)", fontSize: 13 }}>
            {hasVideo ? tProfile("donationVideoReady") : tProfile("donationNoVideoStatus")}
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
          {tProfile("editLabel")}
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
            <span style={titleStyle}>{tProfile("donationTitle")}</span>
          </div>
          <SwitchComponent
            checked={isEnabled}
            disabled={isBusy}
            onChange={(next) => { void handleToggle(next); }}
            label={tProfile("donationEnableLabel")}
          />
        </div>
        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={tProfile("donationConfigTitle")}
        loading={isBusy}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        {/* Message */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>{tProfile("donationMessageLabel")}</div>
          <textarea
            value={overlayDraft.donationMessage as string}
            onChange={(e) => setOverlayDraft((p) => ({ ...p, donationMessage: e.target.value.slice(0, 160) }))}
            placeholder={tProfile("donationMessagePlaceholder")}
            disabled={isBusy}
            rows={3}
            maxLength={160}
            style={{ ...inputStyle, width: "100%", resize: "vertical" }}
          />
          <div style={{ ...subtleStyle, textAlign: "right", marginTop: 4 }}>
            {(overlayDraft.donationMessage as string).length} / 160
          </div>
        </div>

        {/* Amount + currency */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>{tProfile("donationMinAmount")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              min="1"
              step="1"
              value={overlayDraft.donationMinimumAmount as string}
              onChange={(e) => setOverlayDraft((p) => ({ ...p, donationMinimumAmount: e.target.value }))}
              placeholder={tProfile("donationAmountPlaceholder")}
              disabled={isBusy}
              style={{ ...inputStyle, flex: 1 }}
            />
            <span
              style={{
                ...inputStyle,
                width: 90,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0.75,
              }}
            >
              {displayCurrency}
            </span>
          </div>
          {displayCurrency !== "MXN" &&
          (overlayDraft.donationMinimumAmount as string) &&
          Number(overlayDraft.donationMinimumAmount) > 0 ? (
            <div style={{ ...subtleStyle, marginTop: 4 }}>
              = {formatAnchor(resolveStoredPrice(Number(overlayDraft.donationMinimumAmount)).price)}
            </div>
          ) : null}
        </div>

        {/* Video upload */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>{tProfile("donationVideoLabel")}</div>

          {/* Already has a ready playbackId */}
          {overlayPlaybackId && !uploadPending && uploadProgress === null && (
            <div style={{ ...subtleStyle, color: "#a3e635", marginBottom: 8 }}>{tProfile("donationVideoReady")}</div>
          )}

          {/* Saved playbackId from draft but overlayDraft hasn't picked it up yet */}
          {!overlayPlaybackId && savedPlaybackId && !uploadPending && uploadProgress === null && (
            <div style={{ ...subtleStyle, color: "#a3e635", marginBottom: 8 }}>{tProfile("donationVideoReady")}</div>
          )}

          {/* Upload in progress */}
          {uploadProgress !== null && (
            <div style={{ ...subtleStyle, marginBottom: 8 }}>{tProfile("donationUploading", { progress: uploadProgress })}</div>
          )}

          {/* Pending processing */}
          {uploadPending && uploadProgress === null && (
            <div style={{ ...subtleStyle, color: "rgba(255,200,80,0.9)", marginBottom: 8 }}>
              {tProfile("donationProcessing")}
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
              {overlayPlaybackId || savedPlaybackId ? tProfile("donationChangeVideo") : tProfile("donationUploadVideo")}
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
