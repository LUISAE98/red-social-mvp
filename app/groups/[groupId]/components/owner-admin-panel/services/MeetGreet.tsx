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

type Props = {
  draft: ServiceDraft;
  saving: boolean;

  meetGreetEmoji: string;

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
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);

  const meetGreetCalc = useMemo(() => {
    return draft.meetGreet.enabled ? calcNetAmount(draft.meetGreet.price) : null;
  }, [draft.meetGreet.enabled, draft.meetGreet.price, calcNetAmount]);

  const isBusy = saving;

  function buildEnabledDraft(baseDraft: ServiceDraft) {
    return {
      ...baseDraft,
      meetGreet: {
        ...baseDraft.meetGreet,
        enabled: true,
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
    await onSaveDraft({
      ...overlayDraft,
      meetGreet: {
        ...overlayDraft.meetGreet,
        visible: overlayDraft.meetGreet.enabled,
        visibility: "members",
      },
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
          <div style={subtleStyle}>Precio configurado</div>
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
          <div style={subtleStyle}>Duración configurada</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.meetGreet.durationMinutes
              ? `${draft.meetGreet.durationMinutes} min`
              : "Sin duración"}
          </div>
        </div>

        {meetGreetCalc ? (
          <div style={subtleStyle}>
            Por un meet & greet de{" "}
            {formatMoney(meetGreetCalc.gross, draft.meetGreet.currency)}, tú cobras{" "}
            {formatMoney(meetGreetCalc.net, draft.meetGreet.currency)}.
          </div>
        ) : null}

        <div style={subtleStyle}>
          Visibilidad actual: solo miembros.
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
            <span style={titleStyle}>{meetGreetEmoji} Meet & Greet digital</span>
          </div>

          <SwitchComponent
            checked={draft.meetGreet.enabled}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label="Activar Meet & Greet digital"
          />
        </div>

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${meetGreetEmoji} Configurar Meet & Greet digital`}
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
            placeholder="Precio"
            style={{ ...inputStyle, width: 130, flex: "1 1 180px" }}
          />

          <select
            value={overlayDraft.meetGreet.currency}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                meetGreet: {
                  ...prev.meetGreet,
                  enabled: true,
                  currency: e.target.value as Currency,
                  visible: true,
                  visibility: "members",
                },
              }))
            }
            style={{ ...inputStyle, width: 100, flex: "1 1 120px" }}
          >
            <option value="MXN">MXN</option>
            <option value="USD">USD</option>
          </select>

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
            placeholder="Duración (min)"
            style={{ ...inputStyle, width: 160, flex: "1 1 180px" }}
          />
        </div>

        <div style={subtleStyle}>
          Este servicio queda visible solo para miembros.
        </div>
      </OverlayModalComponent>
    </>
  );
}