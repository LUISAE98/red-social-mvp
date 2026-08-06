"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import ServiceInfoIcon from "@/components/services/ServiceInfoIcon";
import ServicePreviewReveal from "@/components/services/ServicePreviewReveal";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";

// Color de acento del servicio de suscripción: azul celeste. Tiñe todos sus iconos
// (info de la descripción, aviso de comunidad pública e items informativos).
const SUBSCRIPTION_ACCENT = "#38bdf8";

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
  /** Cambia la comunidad a privada. Ausente = sin switch. */
  onChangeVisibility?: (next: "public" | "private") => Promise<void>;
  saving: boolean;
  removingLegacyMembers: boolean;
  activeLegacyFreeMembersCount: number;
  canRemoveLegacyFreeMembersLater: boolean;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  descriptionStyle: React.CSSProperties;
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
  onChangeVisibility,
  saving,
  removingLegacyMembers,
  activeLegacyFreeMembersCount,
  canRemoveLegacyFreeMembersLater,
  panelStyle,
  titleStyle,
  subtleStyle,
  descriptionStyle,
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
  const { currency: displayCurrency } = usePriceFormat();
  const [overlayMode, setOverlayMode] = useState<SubscriptionOverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  const [showRemoveLegacyMembersModal, setShowRemoveLegacyMembersModal] =
    useState(false);
  const { toast: subToast, showToast: showSubToast } = useVibraToast();
  const [changingVisibility, setChangingVisibility] = useState(false);
  const [popping, setPopping] = useState(false);

 const disabledByVisibility = isPublic;

  // Switch para pasar la comunidad a privada. Solo cuando es pública y el padre
  // provee el callback. Al pasar a privada, isPublic → false y el switch desaparece;
  // para volver a pública se hace desde Configuración.
  const canMakePrivate = isPublic && typeof onChangeVisibility === "function";

  async function handleMakePrivate() {
    if (!onChangeVisibility || changingVisibility || saving || removingLegacyMembers) return;
    setPopping(true); // dispara la animación de salida (pop) del panel
    setChangingVisibility(true);
    try {
      await onChangeVisibility("private");
      // Ya privada: abrir el panel de configuración para poner el costo (flujo de
      // activación de la suscripción). isPublic se refleja solo por el snapshot.
      openOverlay("activate", {
        ...draft,
        subscription: { ...draft.subscription, enabled: true },
      });
    } catch {
      setPopping(false);
      showSubToast(tServices("communityPrivacyChangeError"), "error");
    } finally {
      setChangingVisibility(false);
    }
  }

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
    // El precio se guarda CRUDO en MXN; se muestra tal cual para editarlo.
    const shown = src.subscription.price;
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
    // El creador teclea en MXN; se guarda CRUDO en MXN (sin round-trip USD).
    const n = Number(overlayDraft.subscription.price);
    let toSave = overlayDraft;
    if (overlayDraft.subscription.price !== "" && Number.isFinite(n) && n > 0) {
      toSave = {
        ...overlayDraft,
        subscription: { ...overlayDraft.subscription, price: String(n), currency: "MXN" },
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
        <div className="serviceActivationPanel" style={panelStyle}>
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
                {tServices("subscriptionTitle")}
              </span>
              <span
                style={
                  !draft.subscription.enabled
                    ? { ...descriptionStyle, display: "flex", alignItems: "flex-start", gap: 6 }
                    : descriptionStyle
                }
              >
                {!draft.subscription.enabled ? (
                  <ServiceInfoIcon color={SUBSCRIPTION_ACCENT} />
                ) : null}
                <span>{tServices("expSubscriptionDesc")}</span>
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

          {/* Items informativos: mismo patrón que las demás experiencias
              (hover en laptop / "ver más" en celular cuando está inactiva; fijos
              cuando está activa). */}
          {!draft.subscription.enabled ? (
            <ServicePreviewReveal service="subscription" accentColor={SUBSCRIPTION_ACCENT} />
          ) : (
            <ServiceFeaturePreview service="subscription" accentColor={SUBSCRIPTION_ACCENT} />
          )}

{disabledByVisibility && (
  <>
    <style>{`
      @keyframes vibraSubPrivacyPop {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.92); }
      }
    `}</style>
    <div
      style={{
        display: "grid",
        gap: 12,
        padding: "12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "transparent",
        marginTop: 2,
        animation: popping ? "vibraSubPrivacyPop 200ms ease-in forwards" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ marginTop: 1 }}>
          <ServiceInfoIcon color={SUBSCRIPTION_ACCENT} size={16} />
        </span>
        <span style={descriptionStyle}>
          {tServices("subscriptionPublicDisabledWarning")}
        </span>
      </div>

      {canMakePrivate && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingTop: 10,
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span style={titleStyle}>
              {tServices("communityPrivacyToggleLabel")}
            </span>
            <SwitchComponent
              checked={false}
              disabled={changingVisibility || saving || removingLegacyMembers}
              onChange={() => void handleMakePrivate()}
              label={tServices("communityPrivacyToggleAria")}
            />
          </div>
          <span style={subtleStyle}>
            {tServices("subscriptionBackToPublicNote")}
          </span>
        </>
      )}
    </div>
  </>
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
        title={tServices("subscriptionConfigModalTitle")}
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
        {overlayDraft.subscription.price &&
        Number(overlayDraft.subscription.price) > 0 ? (
          <div style={subtleStyle}>
            {/* Neto que gana el creador = 75% (precio − 25% comisión Vibra). */}
            = {formatMoney(Number(overlayDraft.subscription.price) * 0.75, "MXN")}
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