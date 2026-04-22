"use client";

import React, { useMemo, useState } from "react";

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
          <span style={titleStyle}>Transición: gratis → suscripción</span>
          <span style={subtleStyle}>
            Debes decidir qué pasa con los miembros actuales al volver la comunidad de suscripción.
          </span>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("legacy_free")}
          style={optionCard(value === "legacy_free")}
        >
          <span style={titleStyle}>Dejar a los miembros actuales gratis</span>
          <span style={subtleStyle}>
            Los miembros que ya estaban dentro conservan acceso legado sin pagar.
          </span>
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("require_subscription")}
          style={optionCard(value === "require_subscription")}
        >
          <span style={titleStyle}>Pedir suscripción a los miembros actuales</span>
          <span style={subtleStyle}>
            Los miembros existentes deberán suscribirse para continuar con acceso.
          </span>
        </button>
      </div>
    );
  }

  if (mode === "subscription_price_increase") {
    return (
      <div style={panelStyle}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={titleStyle}>Cambio: aumento de precio de suscripción</span>
          <span style={subtleStyle}>
            Como el nuevo precio es mayor al anterior, debes decidir qué pasa con los miembros que ya estaban dentro.
          </span>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("keep_legacy_price")}
          style={optionCard(value === "keep_legacy_price")}
        >
          <span style={titleStyle}>Mantener a cada quien como ya estaba</span>
          <span style={subtleStyle}>
            Los suscriptores de pago actuales conservan su precio anterior. Los integrantes que ya eran gratis por legado siguen gratis por legado. El nuevo precio solo aplica a nuevas suscripciones.
          </span>
        </button>

        <button
          type="button"
          disabled={saving}
          onClick={() => onChange("require_resubscribe_new_price")}
          style={optionCard(value === "require_resubscribe_new_price")}
        >
          <span style={titleStyle}>
            Sacar a los suscriptores de pago actuales y pedir nueva suscripción
          </span>
          <span style={subtleStyle}>
            Los suscriptores de pago actuales deberán suscribirse otra vez con el nuevo precio. Los integrantes gratis por legado se mantienen como gratis por legado.
          </span>
        </button>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={titleStyle}>Transición: suscripción → gratis</span>
        <span style={subtleStyle}>
          Debes decidir qué pasa con los integrantes cuando la comunidad deje de ser de suscripción.
        </span>
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={() => onChange("keep_members_free")}
        style={optionCard(value === "keep_members_free")}
      >
        <span style={titleStyle}>Mantener a todos dentro y volverla gratuita</span>
        <span style={subtleStyle}>
          La comunidad deja de cobrar y quienes están dentro permanecen con acceso normal.
        </span>
      </button>

      <button
        type="button"
        disabled={saving}
        onClick={() => onChange("remove_all_members")}
        style={optionCard(value === "remove_all_members")}
      >
        <span style={titleStyle}>Sacar a todos al quitar la suscripción</span>
        <span style={subtleStyle}>
          La comunidad vuelve a ser gratuita, pero sin conservar automáticamente a los miembros actuales.
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
  const [overlayMode, setOverlayMode] = useState<SubscriptionOverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  const [showRemoveLegacyMembersModal, setShowRemoveLegacyMembersModal] =
    useState(false);

  const disabledByVisibility = isPublic;

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
    setOverlayMode(mode);
    setOverlayDraft(nextDraft ?? draft);
  }

  function closeOverlay() {
    if (isBusy) return;
    setOverlayMode(null);
    setOverlayDraft(draft);
  }

  async function confirmOverlaySave() {
    await onSaveDraft(overlayDraft);
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
    if (isBusy) return;
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
          <div style={subtleStyle}>Precio mensual configurado</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.subscription.price
              ? formatMoney(Number(draft.subscription.price), draft.subscription.currency)
              : `0 ${draft.subscription.currency}`}
          </div>
        </div>

        {subscriptionCalc ? (
          <div style={subtleStyle}>
            Por una suscripción de{" "}
            {formatMoney(subscriptionCalc.gross, draft.subscription.currency)}, tú cobras{" "}
            {formatMoney(subscriptionCalc.net, draft.subscription.currency)}.
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
          Modificar
        </button>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
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
              <span style={titleStyle}>
                {subscriptionEmoji} Suscripción mensual
              </span>
            </div>

            <SwitchComponent
              checked={draft.subscription.enabled}
              disabled={isBusy || disabledByVisibility}
              onChange={handleToggle}
              label="Activar suscripción mensual"
            />
          </div>

          {disabledByVisibility && (
            <div style={subtleStyle}>
              Para activar suscripción mensual, la comunidad debe ser privada u oculta.
            </div>
          )}

          {renderSummary()}
        </div>

        {canRemoveLegacyFreeMembersLater && (
          <div style={panelStyle}>
            <div style={{ display: "grid", gap: 2 }}>
              <span style={titleStyle}>Retirar miembros gratuitos</span>
              <span style={subtleStyle}>
                Esta acción aparece solo cuando la comunidad ya quedó guardada como comunidad de suscripción y todavía existen miembros activos con acceso gratuito heredado.
              </span>
            </div>

            <div style={subtleStyle}>
              Miembros gratuitos detectados actualmente:{" "}
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
                  Retirando miembros gratuitos...
                </>
              ) : (
                "Sacar a los miembros gratuitos"
              )}
            </button>

            <div style={subtleStyle}>
              Solo afectará a miembros activos con acceso gratuito heredado. No toca owner, moderadores protegidos, miembros removidos ni suscriptores de pago.
            </div>
          </div>
        )}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${subscriptionEmoji} Configurar suscripción mensual`}
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
            placeholder="Precio mensual"
            style={{ ...inputStyle, width: 160, flex: "1 1 200px" }}
          />

          <select
            value={overlayDraft.subscription.currency}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                subscription: {
                  ...prev.subscription,
                  currency: e.target.value as Currency,
                },
              }))
            }
            style={{ ...inputStyle, width: 100, flex: "1 1 120px" }}
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>
        </div>

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
        title="Retirar miembros gratuitos"
        description={
          <>
            Vas a retirar a todos los miembros que siguen dentro con acceso gratuito
            heredado en esta comunidad. Después de esto, deberán suscribirse o
            quitar/olvidar el grupo.
            <br />
            <br />
            <strong style={{ color: "#fff" }}>
              Miembros detectados para esta acción: {activeLegacyFreeMembersCount}
            </strong>
          </>
        }
        confirmLabel="Sí, retirar miembros gratuitos"
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
    </>
  );
}