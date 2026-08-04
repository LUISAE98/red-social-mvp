"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { DONATION_MIN_AMOUNT_MXN } from "@/lib/currency/catalog";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import {
  DEFAULT_DONATION_SUGGESTED_AMOUNTS,
  normalizeSuggestedAmounts,
} from "../OwnerAdminServices.parts";

// Cada monto sugerido debe ser al menos este valor (MXN).
const DONATION_MIN_PER_AMOUNT = DONATION_MIN_AMOUNT_MXN;

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
  donationSuggestedAmounts: string[];
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
  confirmDisabled?: boolean;
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
  formatMoney,
  OverlayModalComponent,
  DonationModeButtonComponent,
  SwitchComponent,
  onSaveDraft,
}: Props) {
  const tServices = useTranslations("services");
  const { currency: displayCurrency } = usePriceFormat();

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

  // Validación de los 4 montos sugeridos (mínimo por monto).
  const amountBelowMin = (i: number): boolean => {
    const raw = overlayDraft.donationSuggestedAmounts[i] ?? "";
    return raw.trim() !== "" && Number(raw) < DONATION_MIN_PER_AMOUNT;
  };
  // Hay al menos un monto tecleado por debajo del mínimo.
  const anyAmountBelowMin = [0, 1, 2, 3].some((i) => amountBelowMin(i));
  // Bloquea publicar si algún monto está vacío, no es finito o es < mínimo.
  const amountsInvalid = [0, 1, 2, 3].some((i) => {
    const raw = overlayDraft.donationSuggestedAmounts[i] ?? "";
    const n = Number(raw);
    return raw.trim() === "" || !Number.isFinite(n) || n < DONATION_MIN_PER_AMOUNT;
  });

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
      donationSuggestedAmounts: [...DEFAULT_DONATION_SUGGESTED_AMOUNTS],
      donationMessage: "",
    };
  }

  function stopPlaybackListener() {
    playbackListenerRef.current?.();
    playbackListenerRef.current = null;
  }

  function openOverlay(mode: OverlayMode, nextDraft?: ServiceDraft) {
    stopPlaybackListener();
    const src = nextDraft ?? draft;
    // Los 4 montos se guardan CRUDOS en MXN; se cargan tal cual para editarlos
    // (rellenando con los defaults [50,120,250,490] si vienen incompletos).
    const shown = normalizeSuggestedAmounts(src.donationSuggestedAmounts);
    setOverlayMode(mode);
    setOverlayDraft({ ...src, donationSuggestedAmounts: shown });
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

    const amountsNum = overlayDraft.donationSuggestedAmounts.map((s) => Number(s));
    if (
      amountsNum.length !== 4 ||
      amountsNum.some((n) => !Number.isFinite(n) || n < DONATION_MIN_PER_AMOUNT)
    ) {
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

    // El creador teclea en MXN; se guardan CRUDOS en MXN (sin round-trip USD).
    await onSaveDraft({
      ...overlayDraft,
      donationSuggestedAmounts: amountsNum.map((n) => String(n)),
      donationCurrency: "MXN",
    });
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
            {normalizeSuggestedAmounts(draft.donationSuggestedAmounts)
              .map((a) => formatMoney(Number(a), "MXN"))
              .join(" · ")}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Video de presentación</div>
          <div style={{ color: hasVideo ? "#a3e635" : "rgba(255,255,255,0.4)", fontSize: 13 }}>
            {hasVideo ? "✓ Video listo" : "Sin video (opcional)"}
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
        confirmDisabled={amountsInvalid}
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
          <div style={{ ...subtleStyle, marginBottom: 8 }}>
            Define 4 montos sugeridos (en {displayCurrency}). Quienes te apoyen los verán como botones para donar con un toque, y también podrán escribir otra cantidad. El mínimo por monto es ${DONATION_MIN_PER_AMOUNT}.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[0, 1, 2, 3].map((i) => {
              const belowMinI = amountBelowMin(i);
              const amtI = Number(overlayDraft.donationSuggestedAmounts[i] ?? "");
              const netI = Number.isFinite(amtI) && amtI > 0 ? amtI * WALLET_NET_RATE : null; // neto = 75% de la donación
              const showEarnI = netI != null && netI > 0 && !belowMinI;
              return (
              <div key={i} style={{ display: "grid", gap: 2 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="number"
                    min={DONATION_MIN_PER_AMOUNT}
                    step="1"
                    value={overlayDraft.donationSuggestedAmounts[i] ?? ""}
                    onChange={(e) =>
                      setOverlayDraft((p) => {
                        const current = normalizeSuggestedAmounts(p.donationSuggestedAmounts);
                        const next = [...current];
                        next[i] = e.target.value;
                        return { ...p, donationSuggestedAmounts: next };
                      })
                    }
                    placeholder="Ej. 50"
                    disabled={isBusy}
                    style={{ ...inputStyle, width: "100%", flex: "1 1 auto", minWidth: 0 }}
                  />
                  <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                    + $3
                  </span>
                </div>
                {/* Aviso del mínimo + cuánto ganas, agrupados en una celda para que colapsen sin dejar hueco. */}
                <div>
                  <div
                    style={{
                      maxHeight: belowMinI ? 22 : 0,
                      opacity: belowMinI ? 1 : 0,
                      transform: belowMinI ? "translateY(0)" : "translateY(4px)",
                      overflow: "hidden",
                      transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
                    }}
                  >
                    <div style={{ color: "#f87171", fontSize: 12, marginTop: 2 }}>
                      {`El mínimo es $${DONATION_MIN_PER_AMOUNT}`}
                    </div>
                  </div>
                  <div
                    style={{
                      maxHeight: showEarnI ? 22 : 0,
                      opacity: showEarnI ? 1 : 0,
                      transform: showEarnI ? "translateY(0)" : "translateY(4px)",
                      overflow: "hidden",
                      transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
                    }}
                  >
                    <div style={{ ...subtleStyle, fontSize: 11, marginTop: 2 }}>
                      {`Ganas ${formatMoney(netI ?? 0, "MXN")}`}
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>

        <div style={{ ...subtleStyle, opacity: 0.7, fontSize: 11 }}>
          A todas las experiencias se les suman $3 MXN por el cargo de procesamiento de Stripe.
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
