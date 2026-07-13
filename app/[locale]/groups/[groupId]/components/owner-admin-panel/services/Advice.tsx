"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";

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

type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
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
  draft: ServiceDraft;
  saving: boolean;

  consejoEmoji: string;

  /** Muestra una descripción del servicio bajo el título (solo perfil). */
  showDescription?: boolean;
  /** Estilo para la descripción (solo perfil). */
  descriptionStyle?: React.CSSProperties;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;

  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
  formatMoney: (value: number, currency: Currency) => string;

  SwitchComponent: React.ComponentType<SwitchProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<void>;
};

type OverlayMode = null | "activate" | "edit";

export default function Consejos({
  draft,
  saving,
  consejoEmoji,
  showDescription = false,
  descriptionStyle,
  panelStyle,
  titleStyle,
  subtleStyle,
  inputStyle,
  buttonSecondaryStyle,
  calcNetAmount,
  formatMoney,
  SwitchComponent,
  OverlayModalComponent,
  onSaveDraft,
}: Props) {
  const tServices = useTranslations("services");
  const { resolveStoredPrice, toDisplayForInput, currency: displayCurrency, formatAnchor } =
    usePriceFormat();

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);

  const consejoCalc = useMemo(() => {
    return draft.consejo.enabled ? calcNetAmount(draft.consejo.price) : null;
  }, [draft.consejo.enabled, draft.consejo.price, calcNetAmount]);

  const isBusy = saving;

  function buildEnabledDraft(baseDraft: ServiceDraft) {
    // Mostrar el precio guardado en la moneda del creador para editarlo.
    const n = Number(baseDraft.consejo.price);
    const shown =
      baseDraft.consejo.price !== "" && Number.isFinite(n) && n > 0
        ? String(
            Math.round(
              toDisplayForInput(n, baseDraft.consejo.currency ?? "MXN") * 100
            ) / 100
          )
        : baseDraft.consejo.price;
    return {
      ...baseDraft,
      consejo: {
        ...baseDraft.consejo,
        enabled: true,
        price: shown,
        visible: true,
        visibility: "members" as const,
      },
    };
  }

  function buildDisabledDraft(baseDraft: ServiceDraft) {
    return {
      ...baseDraft,
      consejo: {
        ...baseDraft.consejo,
        enabled: false,
        price: "",
        visible: false,
        visibility: "members" as const,
      },
    };
  }

  function openOverlay(mode: OverlayMode, nextDraft?: ServiceDraft) {
    setOverlayMode(mode);
    setOverlayDraft(nextDraft ?? draft);
  }

  function closeOverlay() {
    if (isBusy) return;
    setOverlayMode(null);
    setOverlayDraft(draft);
  }

  async function confirmOverlaySave() {
    // El creador tecleó en su moneda; guardamos en MXN (ancla).
    const n = Number(overlayDraft.consejo.price);
    let consejoToSave = {
      ...overlayDraft.consejo,
      visible: overlayDraft.consejo.enabled,
      visibility: "members" as const,
    };
    if (overlayDraft.consejo.price !== "" && Number.isFinite(n) && n > 0) {
      const { price, currency } = resolveStoredPrice(n);
      consejoToSave = { ...consejoToSave, price: String(price), currency };
    }
    await onSaveDraft({
      ...overlayDraft,
      consejo: consejoToSave,
    });
    setOverlayMode(null);
  }

  async function handleToggle(next: boolean) {
    if (isBusy) return;

    if (!draft.consejo.enabled && next) {
      openOverlay("activate", buildEnabledDraft(draft));
      return;
    }

    if (draft.consejo.enabled && !next) {
      await onSaveDraft(buildDisabledDraft(draft));
    }
  }

  function handleModify() {
    if (isBusy) return;
    openOverlay("edit", buildEnabledDraft(draft));
  }

  function renderSummary() {
    if (!draft.consejo.enabled) return null;

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
          <div style={subtleStyle}>{tServices("meetGreetConfiguredPrice")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.consejo.price
              ? formatMoney(Number(draft.consejo.price), draft.consejo.currency)
              : `0 ${draft.consejo.currency}`}
          </div>
        </div>

        {consejoCalc ? (
          <div style={subtleStyle}>
            {tServices("adviceEarningsDesc", {
              gross: formatMoney(consejoCalc.gross, draft.consejo.currency),
              net: formatMoney(consejoCalc.net, draft.consejo.currency),
            })}
          </div>
        ) : null}

        <div style={subtleStyle}>
          {tServices("meetGreetMembersVisibility")}
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
            <span style={titleStyle}>{consejoEmoji} {tServices("adviceTitle")}</span>
            {showDescription && (
              <span style={descriptionStyle ?? subtleStyle}>{tServices("expConsejoDesc")}</span>
            )}
          </div>

          <SwitchComponent
            checked={draft.consejo.enabled}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label={tServices("adviceActivateLabel")}
          />
        </div>

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${consejoEmoji} ${tServices("adviceConfigTitle")}`}
        loading={saving}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="number"
            min="1"
            step="0.01"
            value={overlayDraft.consejo.price}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                consejo: {
                  ...prev.consejo,
                  enabled: true,
                  price: e.target.value,
                  visible: true,
                  visibility: "members",
                },
              }))
            }
            placeholder={tServices("pricePlaceholder")}
            style={{ ...inputStyle, width: 130, flex: "1 1 180px" }}
          />

          <span
            style={{
              ...inputStyle,
              width: 100,
              flex: "1 1 120px",
              display: "inline-flex",
              alignItems: "center",
              opacity: 0.75,
            }}
          >
            {displayCurrency}
          </span>
        </div>
        {displayCurrency !== "MXN" &&
        overlayDraft.consejo.price &&
        Number(overlayDraft.consejo.price) > 0 ? (
          <div style={subtleStyle}>
            = {formatAnchor(resolveStoredPrice(Number(overlayDraft.consejo.price)).price)}
          </div>
        ) : null}

        <div style={subtleStyle}>
          {tServices("membersOnlyServiceNote")}
        </div>
      </OverlayModalComponent>
    </>
  );
}