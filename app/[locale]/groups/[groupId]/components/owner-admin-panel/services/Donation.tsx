"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";

type Currency = "MXN" | "USD";

type FreeToSubscriptionPolicy = "legacy_free" | "require_subscription" | "";
type SubscriptionToFreePolicy = "keep_members_free" | "remove_all_members" | "";
type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price"
  | "";

type SubscriptionDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
};

type ServiceBlockDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
  visible: boolean;
  visibility: "public" | "members";
};

type MeetGreetDraft = ServiceBlockDraft & {
  durationMinutes: string;
};

type AvailabilitySlotDraft = {
  start: string;
  end: string;
};

type WeeklyAvailabilityDraft = {
  monday: AvailabilitySlotDraft[];
  tuesday: AvailabilitySlotDraft[];
  wednesday: AvailabilitySlotDraft[];
  thursday: AvailabilitySlotDraft[];
  friday: AvailabilitySlotDraft[];
  saturday: AvailabilitySlotDraft[];
  sunday: AvailabilitySlotDraft[];
};

type CustomClassDraft = ServiceBlockDraft & {
  durationMinutes: string;
  availability: WeeklyAvailabilityDraft;
};

type DonationMode = "none" | "general" | "wedding";

type ServiceDraft = {
  subscription: SubscriptionDraft;
  saludo: ServiceBlockDraft;
  consejo: ServiceBlockDraft;
  meetGreet: MeetGreetDraft;
  customClass: CustomClassDraft;
  donationMode: DonationMode;
  donationCurrency: Currency;
  donationMinimumAmount: string;
  donationGoalLabel: string;
  donationMessage: string;
  donationVideoUrl: string;
  donationPlaybackId: string;
  freeToSubscriptionPolicy: FreeToSubscriptionPolicy;
  subscriptionToFreePolicy: SubscriptionToFreePolicy;
  subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy;
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

type DonationModeButtonProps = {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
};

type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
};

const VIDEO_MAX_SECONDS = 300;

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

type Props = {
  draft: ServiceDraft;
  savedDraft: ServiceDraft;
  saving: boolean;
  removingLegacyMembers: boolean;

  donationEmoji: string;
  groupId: string;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;

  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
  formatMoney: (value: number, currency: Currency) => string;

  OverlayModalComponent: React.ComponentType<OverlayModalProps>;
  DonationModeButtonComponent: React.ComponentType<DonationModeButtonProps>;
  SwitchComponent: React.ComponentType<SwitchProps>;

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<void>;
};

type OverlayMode = null | "activate" | "edit";

export default function Donation({
  draft,
  saving,
  removingLegacyMembers,
  donationEmoji,
  groupId,
  panelStyle,
  titleStyle,
  subtleStyle,
  inputStyle,
  buttonSecondaryStyle,
  calcNetAmount,
  formatMoney,
  OverlayModalComponent,
  DonationModeButtonComponent,
  SwitchComponent,
  onSaveDraft,
}: Props) {
  const tServices = useTranslations("services");

  const isEnabled = draft.donationMode !== "none";

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const playbackListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => { playbackListenerRef.current?.(); };
  }, []);

  const isBusy = saving || removingLegacyMembers || uploadProgress !== null;

  const donationMinimumCalc = useMemo(() => {
    return draft.donationMode !== "none"
      ? calcNetAmount(draft.donationMinimumAmount)
      : null;
  }, [draft.donationMode, draft.donationMinimumAmount, calcNetAmount]);

  function buildEnabledDraft(base: ServiceDraft): ServiceDraft {
    return {
      ...base,
      donationMode: base.donationMode === "none" ? "general" : base.donationMode,
    };
  }

  function buildDisabledDraft(base: ServiceDraft): ServiceDraft {
    return {
      ...base,
      donationMode: "none",
      donationCurrency: "MXN",
      donationMinimumAmount: "",
      donationMessage: "",
    };
  }

  function stopPlaybackListener() {
    playbackListenerRef.current?.();
    playbackListenerRef.current = null;
  }

  function openOverlay(mode: OverlayMode, nextDraft?: ServiceDraft) {
    stopPlaybackListener();
    setOverlayMode(mode);
    setOverlayDraft(nextDraft ?? draft);
    setSaveErr(null);
    setUploadErr(null);
    setUploadPending(false);
  }

  function closeOverlay() {
    if (isBusy) return;
    stopPlaybackListener();
    setOverlayMode(null);
    setOverlayDraft(draft);
    setSaveErr(null);
    setUploadErr(null);
    setUploadPending(false);
  }

  async function handleVideoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadErr(null);
    setUploadPending(false);

    const duration = await getVideoDuration(file);
    if (duration > VIDEO_MAX_SECONDS) {
      setUploadErr(`El video no puede durar más de 5 minutos (${Math.round(duration)}s).`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploadProgress(0);

    try {
      const callable = httpsCallable<{ groupId: string }, { uploadId: string; uploadUrl: string }>(
        functions,
        "createMuxGroupDonationUpload"
      );
      const result = await callable({ groupId });
      const { uploadUrl, uploadId } = result.data;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.upload.onprogress = (ev) => {
          if (ev.total > 0) setUploadProgress(Math.round((ev.loaded / ev.total) * 100));
        };
        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Error al subir (${xhr.status})`));
        };
        xhr.onerror = () => { xhrRef.current = null; reject(new Error("Error de red al subir el video.")); };
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "video/mp4");
        xhr.send(file);
      });

      setOverlayDraft((p) => ({ ...p, donationVideoUrl: `mux://uploads/${uploadId}`, donationPlaybackId: "" }));
      setUploadPending(true);

      stopPlaybackListener();
      const unsub = onSnapshot(doc(db, "groups", groupId), (snap) => {
        const playbackId = snap.data()?.donation?.playbackId;
        if (typeof playbackId === "string" && playbackId) {
          setOverlayDraft((p) => ({ ...p, donationPlaybackId: playbackId }));
          setUploadPending(false);
          stopPlaybackListener();
        }
      });
      playbackListenerRef.current = unsub;
    } catch (err: unknown) {
      setUploadErr(err instanceof Error ? err.message : "No se pudo subir el video.");
    } finally {
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function confirmOverlaySave() {
    if (isBusy) return;
    setSaveErr(null);

    const amount = parseFloat(overlayDraft.donationMinimumAmount);
    if (isNaN(amount) || amount <= 0) {
      setSaveErr(tServices("donationMinAmountError"));
      return;
    }

    if (!overlayDraft.donationMessage.trim()) {
      setSaveErr(tServices("donationMessageRequired"));
      return;
    }
    if (overlayDraft.donationMessage.trim().length > 160) {
      setSaveErr(tServices("donationMessageTooLong"));
      return;
    }

    await onSaveDraft(overlayDraft);
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
    if (isBusy || draft.donationMode === "none") return;
    openOverlay("edit", draft);
  }

  function renderSummary() {
    if (draft.donationMode === "none") return null;

    const donationModeLabel = tServices("donationModeLabel");
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
          <div style={subtleStyle}>{tServices("donationTypeLabel")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {donationModeLabel}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>{tServices("donationMinAmount")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.donationMinimumAmount
              ? formatMoney(Number(draft.donationMinimumAmount), draft.donationCurrency)
              : `0 ${draft.donationCurrency}`}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Video de presentación</div>
          <div style={{ color: hasVideo ? "#a3e635" : "rgba(255,255,255,0.4)", fontSize: 13 }}>
            {hasVideo ? "✓ Video listo" : "Sin video (opcional)"}
          </div>
        </div>

        {donationMinimumCalc ? (
          <div style={subtleStyle}>
            {tServices("donationMinConfiguredDesc", {
              amount: formatMoney(donationMinimumCalc.gross, draft.donationCurrency),
            })}
          </div>
        ) : null}

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
          {tServices("modify")}
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={panelStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={titleStyle}>{donationEmoji} {tServices("donationTitle")}</span>
          </div>
          <SwitchComponent
            checked={isEnabled}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label={tServices("donationEnableLabel")}
          />
        </div>
        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${donationEmoji} ${tServices("donationConfigTitle")}`}
        loading={saving}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>{tServices("donationMessageLabel")}</div>
          <textarea
            value={overlayDraft.donationMessage}
            onChange={(e) => setOverlayDraft((p) => ({ ...p, donationMessage: e.target.value.slice(0, 160) }))}
            placeholder="Escribe un mensaje para quienes te apoyan..."
            disabled={isBusy}
            rows={3}
            maxLength={160}
            style={{ ...inputStyle, width: "100%", resize: "vertical" }}
          />
          <div style={{ ...subtleStyle, textAlign: "right", marginTop: 4 }}>
            {overlayDraft.donationMessage.length} / 160
          </div>
        </div>

        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>{tServices("donationMinAmount")}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="number"
              min="1"
              step="1"
              value={overlayDraft.donationMinimumAmount}
              onChange={(e) =>
                setOverlayDraft((p) => ({
                  ...p,
                  donationMinimumAmount: e.target.value,
                }))
              }
              placeholder="Ej. 50"
              disabled={isBusy}
              style={{ ...inputStyle, flex: 1 }}
            />
            <select
              value={overlayDraft.donationCurrency}
              onChange={(e) =>
                setOverlayDraft((p) => ({
                  ...p,
                  donationCurrency: e.target.value as Currency,
                }))
              }
              disabled={isBusy}
              style={{ ...inputStyle, width: 90 }}
            >
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        {/* Video de presentación (opcional) */}
        <div>
          <div style={{ ...subtleStyle, marginBottom: 6 }}>Video de presentación <span style={{ opacity: 0.5 }}>(opcional, máx. 5 min)</span></div>

          {overlayDraft.donationPlaybackId ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "#a3e635" }}>✓ Video listo</span>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                style={{ ...buttonSecondaryStyle, fontSize: 12, padding: "4px 10px" }}
              >
                Cambiar
              </button>
            </div>
          ) : uploadPending ? (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
              ⏳ Procesando video...
            </div>
          ) : uploadProgress !== null ? (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
              Subiendo {uploadProgress}%...
            </div>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => fileInputRef.current?.click()}
              style={{ ...buttonSecondaryStyle }}
            >
              Subir video
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => void handleVideoSelect(e)}
          />

          {uploadErr && (
            <div style={{ color: "rgba(255,120,120,0.95)", fontSize: 12, marginTop: 6 }}>
              {uploadErr}
            </div>
          )}
        </div>

        {saveErr && (
          <div
            style={{
              color: "rgba(255,120,120,0.95)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {saveErr}
          </div>
        )}
      </OverlayModalComponent>
    </>
  );
}
