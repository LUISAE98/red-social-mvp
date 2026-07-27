"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
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

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

type Props = {
  draft: ServiceDraft;
  savedDraft: ServiceDraft;
  isPublic: boolean;
  saving: boolean;
  removingLegacyMembers: boolean;
  activeLegacyFreeMembersCount: number;
  canRemoveLegacyFreeMembersLater: boolean;

  subscriptionEmoji: string;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;

  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
  formatMoney: (value: number, currency: Currency) => string;

  SwitchComponent: React.ComponentType<SwitchProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;
  ConfirmModalComponent: React.ComponentType<ConfirmModalProps>;
  SpinningGearComponent: React.ComponentType;

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<void>;
  onRemoveLegacyMembers: () => Promise<void>;
};

type SubscriptionOverlayMode =
  | null
  | "activate"
  | "edit"
  | "deactivate"
  | "price_increase";

function TransitionPolicyPanel({
  mode,
  value,
  onChange,
  saving,
  titleStyle,
  subtleStyle,
}: {
  mode:
    | "free_to_subscription"
    | "subscription_to_free"
    | "subscription_price_increase";
  value: string;
  onChange: (next: string) => void;
  saving: boolean;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
}) {
  const tServices = useTranslations("services");
  const panelStyle: React.CSSProperties = {
    padding: "10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
    gap: 10,
  };

  const optionCard = (active: boolean): React.CSSProperties => ({
    borderRadius: 12,
    border: active
      ? "1px solid rgba(255,255,255,0.9)"
      : "1px solid rgba(255,255,255,0.1)",
    background: active ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
    padding: "10px 12px",
    display: "grid",
    gap: 4,
    cursor: saving ? "not-allowed" : "pointer",
    opacity: saving ? 0.6 : 1,
    textAlign: "left",
  });

  if (mode === "free_to_subscription") {
    return (
      <div style={panelStyle}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={titleStyle}>{tServices("freeToSubscriptionPolicyTitle")}</span>
          <span style={subtleStyle}>
            {tServices("freeToSubscriptionPolicyDescription")}
          </span>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("legacy_free")}
          style={optionCard(value === "legacy_free")}
        >
          <span style={titleStyle}>{tServices("freeToSubscriptionOptionLegacyFreeTitle")}</span>
          <span style={subtleStyle}>
            {tServices("freeToSubscriptionOptionLegacyFreeDesc")}
          </span>
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("require_subscription")}
          style={optionCard(value === "require_subscription")}
        >
          <span style={titleStyle}>{tServices("freeToSubscriptionOptionRequireTitle")}</span>
          <span style={subtleStyle}>
            {tServices("freeToSubscriptionOptionRequireDesc")}
          </span>
        </button>
      </div>
    );
  }

  if (mode === "subscription_price_increase") {
    return (
      <div style={panelStyle}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={titleStyle}>{tServices("priceIncreasePolicyTitle")}</span>
          <span style={subtleStyle}>
            {tServices("priceIncreasePolicyDescription")}
          </span>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("keep_legacy_price")}
          style={optionCard(value === "keep_legacy_price")}
        >
          <span style={titleStyle}>{tServices("priceIncreaseOptionKeepLegacyTitle")}</span>
          <span style={subtleStyle}>
            {tServices("priceIncreaseOptionKeepLegacyDesc")}
          </span>
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("require_resubscribe_new_price")}
          style={optionCard(value === "require_resubscribe_new_price")}
        >
          <span style={titleStyle}>
            {tServices("priceIncreaseOptionRequireResubscribeTitle")}
          </span>
          <span style={subtleStyle}>
            {tServices("priceIncreaseOptionRequireResubscribeDesc")}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={titleStyle}>{tServices("subscriptionToFreePolicyTitle")}</span>
        <span style={subtleStyle}>
          {tServices("subscriptionToFreePolicyDescription")}
        </span>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => onChange("keep_members_free")}
        style={optionCard(value === "keep_members_free")}
      >
        <span style={titleStyle}>{tServices("subscriptionToFreeOptionKeepTitle")}</span>
        <span style={subtleStyle}>
          {tServices("subscriptionToFreeOptionKeepDesc")}
        </span>
      </button>

      <button
        type="button"
        disabled={saving}
        onClick={() => onChange("remove_all_members")}
        style={optionCard(value === "remove_all_members")}
      >
        <span style={titleStyle}>{tServices("subscriptionToFreeOptionRemoveTitle")}</span>
        <span style={subtleStyle}>
          {tServices("subscriptionToFreeOptionRemoveDesc")}
        </span>
      </button>
    </div>
  );
}

export default function Subscription({
  draft,
  savedDraft,
  isPublic,
  saving,
  removingLegacyMembers,
  activeLegacyFreeMembersCount,
  canRemoveLegacyFreeMembersLater,
  subscriptionEmoji,
  panelStyle,
  titleStyle,
  subtleStyle,
  inputStyle,
  buttonSecondaryStyle,
  calcNetAmount,
  formatMoney,
  SwitchComponent,
  OverlayModalComponent,
  ConfirmModalComponent,
  SpinningGearComponent,
  onSaveDraft,
  onRemoveLegacyMembers,
}: Props) {
  const tServices = useTranslations("services");
  const { resolveStoredPrice, toDisplayForInput, currency: displayCurrency, formatAnchor } =
    usePriceFormat();
  const [overlayMode, setOverlayMode] = useState<SubscriptionOverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  const [showRemoveLegacyMembersModal, setShowRemoveLegacyMembersModal] =
    useState(false);
  const { toast: subToast, showToast: showSubToast } = useVibraToast();

 const disabledByVisibility = isPublic;
const disabledPanelStyle: React.CSSProperties = disabledByVisibility
  ? {
      opacity: 0.55,
      filter: "grayscale(0.35)",
    }
  : {};

  const subscriptionCalc = useMemo(() => {
    return draft.subscription.enabled ? calcNetAmount(draft.subscription.price) : null;
  }, [draft.subscription.enabled, draft.subscription.price, calcNetAmount]);

  const isBusy = saving || removingLegacyMembers;

  const savedPrevSubscriptionPrice =
    savedDraft.subscription.price.trim() === ""
      ? null
      : Number(savedDraft.subscription.price);

  const overlayNextSubscriptionPrice =
    overlayDraft.subscription.price.trim() === ""
      ? null
      : Number(overlayDraft.subscription.price);

  const shouldShowFreeToSubscriptionPolicy =
    !savedDraft.subscription.enabled &&
    overlayDraft.subscription.enabled &&
    !isPublic;

  const shouldShowSubscriptionToFreePolicy =
    savedDraft.subscription.enabled && !overlayDraft.subscription.enabled;

  const shouldShowPriceIncreasePolicy =
    !isPublic &&
    savedDraft.subscription.enabled &&
    overlayDraft.subscription.enabled &&
    savedDraft.subscription.currency === overlayDraft.subscription.currency &&
    savedDraft.subscription.price.trim() !== "" &&
    overlayDraft.subscription.price.trim() !== "" &&
    savedPrevSubscriptionPrice != null &&
    overlayNextSubscriptionPrice != null &&
    !Number.isNaN(savedPrevSubscriptionPrice) &&
    !Number.isNaN(overlayNextSubscriptionPrice) &&
    overlayNextSubscriptionPrice > savedPrevSubscriptionPrice;

  function openOverlay(mode: SubscriptionOverlayMode, nextDraft?: ServiceDraft) {
    const src = nextDraft ?? draft;
    // Mostrar el precio guardado en la moneda del creador para editarlo.
    const n = Number(src.subscription.price);
    const shown =
      src.subscription.price !== "" && Number.isFinite(n) && n > 0
        ? String(
            Math.round(
              toDisplayForInput(n, src.subscription.currency ?? "MXN") * 100
            ) / 100
          )
        : src.subscription.price;
    setOverlayMode(mode);
    setOverlayDraft({
      ...src,
      subscription: { ...src.subscription, price: shown },
    });
  }

  function closeOverlay() {
    if (isBusy) return;
    setOverlayMode(null);
    setOverlayDraft(draft);
  }

  async function confirmOverlaySave() {
    // El creador tecleó en su moneda; guardamos en MXN (ancla).
    const n = Number(overlayDraft.subscription.price);
    let toSave = overlayDraft;
    if (overlayDraft.subscription.price !== "" && Number.isFinite(n) && n > 0) {
      const { price, currency } = resolveStoredPrice(n);
      toSave = {
        ...overlayDraft,
        subscription: { ...overlayDraft.subscription, price: String(price), currency },
      };
    }
    await onSaveDraft(toSave);
    setOverlayMode(null);
  }

  function handleToggle(next: boolean) {
    if (isBusy) return;

    if (disabledByVisibility && next) {
      return;
    }

    const nextDraft: ServiceDraft = {
      ...draft,
      subscription: {
        ...draft.subscription,
        enabled: next,
        price: next ? draft.subscription.price : "",
      },
    };

    if (!draft.subscription.enabled && next) {
      openOverlay("activate", nextDraft);
      return;
    }

    if (draft.subscription.enabled && !next) {
      openOverlay("deactivate", nextDraft);
      return;
    }
  }

function handleModify() {
  if (isBusy || disabledByVisibility) return;
  openOverlay("edit", draft);
}

  function renderSummary() {
    if (!draft.subscription.enabled || disabledByVisibility) return null;

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
          <div style={subtleStyle}>{tServices("subscriptionSummaryPriceLabel")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.subscription.price
              ? formatMoney(Number(draft.subscription.price), draft.subscription.currency)
              : `0 ${draft.subscription.currency}`}
          </div>
        </div>

        {subscriptionCalc ? (
          <div style={subtleStyle}>
            {tServices("subscriptionCalculationMessage", {
              price: formatMoney(subscriptionCalc.gross, draft.subscription.currency),
              netAmount: formatMoney(subscriptionCalc.net, draft.subscription.currency),
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
          {tServices("subscriptionModifyButton")}
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
        <div
  style={{
    ...panelStyle,
    ...disabledPanelStyle,
  }}
>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
              <span style={titleStyle}>
                {subscriptionEmoji} {tServices("subscriptionTitle")}
              </span>
            </div>

<div
  onClick={() => {
    if (disabledByVisibility) {
      showSubToast(tServices("subscriptionPublicDisabledToast"), "warning");
    }
  }}
  style={{
    cursor: disabledByVisibility ? "not-allowed" : "default",
  }}
>
  <SwitchComponent
    checked={disabledByVisibility ? false : draft.subscription.enabled}
    disabled={isBusy || disabledByVisibility}
    onChange={handleToggle}
    label={
      disabledByVisibility
        ? tServices("subscriptionDisabledLabel")
        : tServices("subscriptionToggleLabel")
    }
  />
</div>
          </div>

{disabledByVisibility && (
  <div
    style={{
      ...subtleStyle,
      marginTop: 2,
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.04)",
      color: "rgba(255,255,255,0.68)",
    }}
  >
    {tServices("subscriptionPublicDisabledWarning")}
  </div>
)}

          {renderSummary()}
        </div>

        {canRemoveLegacyFreeMembersLater && (
          <div style={panelStyle}>
            <div style={{ display: "grid", gap: 2 }}>
              <span style={titleStyle}>{tServices("removeLegacyMembersTitle")}</span>
              <span style={subtleStyle}>
                {tServices("removeLegacyMembersDescription")}
              </span>
            </div>

            <div style={subtleStyle}>
              {tServices("removeLegacyMembersCountLabel")}{" "}
              <strong style={{ color: "#fff" }}>
                {activeLegacyFreeMembersCount}
              </strong>
            </div>

            <button
              type="button"
              onClick={() => setShowRemoveLegacyMembersModal(true)}
              disabled={isBusy}
              style={{
                ...buttonSecondaryStyle,
                opacity: isBusy ? 0.7 : 1,
                cursor: isBusy ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {removingLegacyMembers ? (
                <>
                  <SpinningGearComponent />
                  {tServices("removingLegacyMembersButton")}
                </>
              ) : (
                tServices("removeLegacyMembersButton")
              )}
            </button>

            <div style={subtleStyle}>
              {tServices("removeLegacyMembersWarning")}
            </div>
          </div>
        )}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${subscriptionEmoji} ${tServices("subscriptionConfigModalTitle")}`}
        loading={saving}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="number"
            min="1"
            step="0.01"
            value={overlayDraft.subscription.price}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                subscription: {
                  ...prev.subscription,
                  price: e.target.value,
                },
              }))
            }
            placeholder={tServices("subscriptionPriceInputPlaceholder")}
            style={{ ...inputStyle, width: 160, flex: "1 1 200px" }}
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
        {displayCurrency !== "USD" &&
        overlayDraft.subscription.price &&
        Number(overlayDraft.subscription.price) > 0 ? (
          <div style={subtleStyle}>
            = {formatAnchor(resolveStoredPrice(Number(overlayDraft.subscription.price)).price)}
          </div>
        ) : null}

        {shouldShowFreeToSubscriptionPolicy ? (
          <TransitionPolicyPanel
            mode="free_to_subscription"
            value={overlayDraft.freeToSubscriptionPolicy}
            onChange={(next) =>
              setOverlayDraft((prev) => ({
                ...prev,
                freeToSubscriptionPolicy: next as FreeToSubscriptionPolicy,
              }))
            }
            saving={saving}
            titleStyle={titleStyle}
            subtleStyle={subtleStyle}
          />
        ) : null}

        {shouldShowSubscriptionToFreePolicy ? (
          <TransitionPolicyPanel
            mode="subscription_to_free"
            value={overlayDraft.subscriptionToFreePolicy}
            onChange={(next) =>
              setOverlayDraft((prev) => ({
                ...prev,
                subscriptionToFreePolicy: next as SubscriptionToFreePolicy,
              }))
            }
            saving={saving}
            titleStyle={titleStyle}
            subtleStyle={subtleStyle}
          />
        ) : null}

        {shouldShowPriceIncreasePolicy ? (
          <TransitionPolicyPanel
            mode="subscription_price_increase"
            value={overlayDraft.subscriptionPriceIncreasePolicy}
            onChange={(next) =>
              setOverlayDraft((prev) => ({
                ...prev,
                subscriptionPriceIncreasePolicy:
                  next as SubscriptionPriceIncreasePolicy,
              }))
            }
            saving={saving}
            titleStyle={titleStyle}
            subtleStyle={subtleStyle}
          />
        ) : null}
      </OverlayModalComponent>

      <ConfirmModalComponent
        open={showRemoveLegacyMembersModal}
        title={tServices("confirmRemoveLegacyMembersTitle")}
        description={
          <>
            {tServices("confirmRemoveLegacyMembersDescription")}
            <br />
            <br />
            <strong style={{ color: "#fff" }}>
              {tServices("confirmRemoveLegacyMembersCount")} {activeLegacyFreeMembersCount}
            </strong>
          </>
        }
        confirmLabel={tServices("confirmRemoveLegacyMembersButton")}
        loading={removingLegacyMembers}
        onCancel={() => {
          if (removingLegacyMembers) return;
          setShowRemoveLegacyMembersModal(false);
        }}
        onConfirm={async () => {
          await onRemoveLegacyMembers();
          setShowRemoveLegacyMembersModal(false);
        }}
      />
      <VibraToast toast={subToast} />
    </>
  );
}