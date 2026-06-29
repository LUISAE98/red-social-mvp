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

type Props = {
  draft: ServiceDraft;
  savedDraft: ServiceDraft;
  saving: boolean;
  removingLegacyMembers: boolean;

  donationEmoji: string;

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
  const isEnabled = draft.donationMode !== "none";

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const isBusy = saving || removingLegacyMembers;

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
      donationGoalLabel: "",
    };
  }

  function openOverlay(mode: OverlayMode, nextDraft?: ServiceDraft) {
    setOverlayMode(mode);
    setOverlayDraft(nextDraft ?? draft);
    setSaveErr(null);
  }

  function closeOverlay() {
    if (isBusy) return;
    setOverlayMode(null);
    setOverlayDraft(draft);
    setSaveErr(null);
  }

  async function confirmOverlaySave() {
    if (isBusy) return;
    setSaveErr(null);

    const amount = parseFloat(overlayDraft.donationMinimumAmount);
    if (isNaN(amount) || amount <= 0) {
      setSaveErr("Debes definir un monto mínimo válido.");
      return;
    }

    if (overlayDraft.donationMode === "wedding" && !overlayDraft.donationGoalLabel.trim()) {
      setSaveErr("Debes escribir el texto del botón para boda.");
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

    const donationModeLabel =
      draft.donationMode === "general" ? "Donación" : "Donación para boda";

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
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {donationModeLabel}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Monto mínimo</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.donationMinimumAmount
              ? formatMoney(Number(draft.donationMinimumAmount), draft.donationCurrency)
              : `0 ${draft.donationCurrency}`}
          </div>
        </div>

        {draft.donationMode === "wedding" && draft.donationGoalLabel && (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={subtleStyle}>Texto del botón</div>
            <div style={{ color: "#fff", fontSize: 14 }}>{draft.donationGoalLabel}</div>
          </div>
        )}

        {donationMinimumCalc ? (
          <div style={subtleStyle}>
            Monto mínimo configurado:{" "}
            {formatMoney(donationMinimumCalc.gross, draft.donationCurrency)}. El
            usuario podrá donar ese monto o uno mayor.
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
            <span style={titleStyle}>{donationEmoji} Donación / Apoyo</span>
          </div>
          <SwitchComponent
            checked={isEnabled}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label="Activar donaciones"
          />
        </div>
        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${donationEmoji} Configurar donación`}
        loading={saving}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>Tipo de donación</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <DonationModeButtonComponent
              active={overlayDraft.donationMode === "general"}
              disabled={isBusy}
              label="Donación"
              onClick={() =>
                setOverlayDraft((p) => ({
                  ...p,
                  donationMode: "general",
                  donationGoalLabel: "",
                }))
              }
            />
            <DonationModeButtonComponent
              active={overlayDraft.donationMode === "wedding"}
              disabled={isBusy}
              label="Para boda"
              onClick={() =>
                setOverlayDraft((p) => ({ ...p, donationMode: "wedding" }))
              }
            />
          </div>
        </div>

        <div>
          <div style={{ ...subtleStyle, marginBottom: 8 }}>Monto mínimo</div>
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

        {overlayDraft.donationMode === "wedding" && (
          <div>
            <div style={{ ...subtleStyle, marginBottom: 8 }}>
              Texto visible en el botón
            </div>
            <input
              type="text"
              value={overlayDraft.donationGoalLabel}
              onChange={(e) =>
                setOverlayDraft((p) => ({
                  ...p,
                  donationGoalLabel: e.target.value,
                }))
              }
              placeholder="Ej. Apoyo para nuestra boda"
              disabled={isBusy}
              style={{ ...inputStyle, width: "100%" }}
            />
          </div>
        )}

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
