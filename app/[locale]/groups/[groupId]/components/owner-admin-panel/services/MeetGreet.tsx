"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import ServiceInfoIcon from "@/components/services/ServiceInfoIcon";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";

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
  activeColor?: string;
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

  meetGreetEmoji: string;
  /** Color de acento del servicio; activa el ícono info y oculta el emoji cuando está inactivo (solo perfil). */
  accentColor?: string;

  /** Muestra una descripción del servicio bajo el título (solo perfil). */
  showDescription?: boolean;
  /** Estilo para la descripción (solo perfil). */
  descriptionStyle?: React.CSSProperties;

  /** Título alternativo para el servicio (solo perfil). */
  titleOverride?: string;

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

export default function MeetGreet({
  draft,
  saving,
  meetGreetEmoji,
  accentColor,
  showDescription = false,
  descriptionStyle,
  titleOverride,
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

  const meetGreetCalc = useMemo(() => {
    return draft.meetGreet.enabled ? calcNetAmount(draft.meetGreet.price) : null;
  }, [draft.meetGreet.enabled, draft.meetGreet.price, calcNetAmount]);

  const isBusy = saving;

  function buildEnabledDraft(baseDraft: ServiceDraft) {
    // Mostrar el precio guardado en la moneda del creador para editarlo.
    const n = Number(baseDraft.meetGreet.price);
    const shown =
      baseDraft.meetGreet.price !== "" && Number.isFinite(n) && n > 0
        ? String(
            Math.round(
              toDisplayForInput(n, baseDraft.meetGreet.currency ?? "MXN") * 100
            ) / 100
          )
        : baseDraft.meetGreet.price;
    return {
      ...baseDraft,
      meetGreet: {
        ...baseDraft.meetGreet,
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
      meetGreet: {
        ...baseDraft.meetGreet,
        enabled: false,
        price: "",
        visible: false,
        visibility: "members" as const,
        durationMinutes: "",
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
    const n = Number(overlayDraft.meetGreet.price);
    let meetGreetToSave = {
      ...overlayDraft.meetGreet,
      visible: overlayDraft.meetGreet.enabled,
      visibility: "members" as const,
    };
    if (overlayDraft.meetGreet.price !== "" && Number.isFinite(n) && n > 0) {
      const { price, currency } = resolveStoredPrice(n);
      meetGreetToSave = { ...meetGreetToSave, price: String(price), currency };
    }
    await onSaveDraft({
      ...overlayDraft,
      meetGreet: meetGreetToSave,
    });
    setOverlayMode(null);
  }

  async function handleToggle(next: boolean) {
    if (isBusy) return;

    if (!draft.meetGreet.enabled && next) {
      openOverlay("activate", buildEnabledDraft(draft));
      return;
    }

    if (draft.meetGreet.enabled && !next) {
      await onSaveDraft(buildDisabledDraft(draft));
    }
  }

  function handleModify() {
    if (isBusy) return;
    openOverlay("edit", buildEnabledDraft(draft));
  }

  function renderSummary() {
    if (!draft.meetGreet.enabled) return null;

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
            {draft.meetGreet.price
              ? formatMoney(
                  Number(draft.meetGreet.price),
                  draft.meetGreet.currency
                )
              : `0 ${draft.meetGreet.currency}`}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>{tServices("meetGreetConfiguredDuration")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.meetGreet.durationMinutes
              ? `${draft.meetGreet.durationMinutes} min`
              : tServices("meetGreetNoDuration")}
          </div>
        </div>

        {meetGreetCalc ? (
          <div style={subtleStyle}>
            {tServices("meetGreetEarningsDesc", {
              gross: formatMoney(meetGreetCalc.gross, draft.meetGreet.currency),
              net: formatMoney(meetGreetCalc.net, draft.meetGreet.currency),
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
          <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <span style={titleStyle}>
              {!accentColor || draft.meetGreet.enabled ? `${meetGreetEmoji} ` : ""}
              {titleOverride ?? tServices("liveSessionTitle")}
            </span>
            {showDescription && (
              <span
                style={
                  accentColor && !draft.meetGreet.enabled
                    ? { ...(descriptionStyle ?? subtleStyle), display: "flex", alignItems: "flex-start", gap: 6 }
                    : (descriptionStyle ?? subtleStyle)
                }
              >
                {accentColor && !draft.meetGreet.enabled ? <ServiceInfoIcon color={accentColor} /> : null}
                <span>{tServices("expMeetGreetDesc")}</span>
              </span>
            )}
          </div>

          <SwitchComponent
            checked={draft.meetGreet.enabled}
            activeColor={accentColor}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label={tServices("meetGreetActivateLabel")}
          />
        </div>

        {accentColor && !draft.meetGreet.enabled ? (
          <ServiceFeaturePreview service="meetGreet" accentColor={accentColor} />
        ) : null}

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${meetGreetEmoji} ${tServices("meetGreetConfigTitle")}`}
        loading={saving}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="number"
            min="1"
            step="0.01"
            value={overlayDraft.meetGreet.price}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                meetGreet: {
                  ...prev.meetGreet,
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

          <input
            type="number"
            min="1"
            step="1"
            value={overlayDraft.meetGreet.durationMinutes}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                meetGreet: {
                  ...prev.meetGreet,
                  enabled: true,
                  durationMinutes: e.target.value,
                  visible: true,
                  visibility: "members",
                },
              }))
            }
            placeholder={tServices("durationPlaceholder")}
            style={{ ...inputStyle, width: 160, flex: "1 1 180px" }}
          />
        </div>
        {displayCurrency !== "MXN" &&
        overlayDraft.meetGreet.price &&
        Number(overlayDraft.meetGreet.price) > 0 ? (
          <div style={subtleStyle}>
            = {formatAnchor(resolveStoredPrice(Number(overlayDraft.meetGreet.price)).price)}
          </div>
        ) : null}

        <div style={subtleStyle}>
          {tServices("membersOnlyServiceNote")}
        </div>
      </OverlayModalComponent>
    </>
  );
}