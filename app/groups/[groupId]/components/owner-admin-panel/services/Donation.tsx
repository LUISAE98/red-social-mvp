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

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<void>;
};

type OverlayMode = null | "activate" | "edit";

export default function Donation({
  draft,
  savedDraft,
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
  onSaveDraft,
}: Props) {
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);

  const isBusy = saving || removingLegacyMembers;

  const donationMinimumCalc = useMemo(() => {
    return draft.donationMode !== "none"
      ? calcNetAmount(draft.donationMinimumAmount)
      : null;
  }, [draft.donationMode, draft.donationMinimumAmount, calcNetAmount]);

  const hasUnsavedDonationChanges =
    draft.donationMode !== savedDraft.donationMode ||
    draft.donationCurrency !== savedDraft.donationCurrency ||
    draft.donationMinimumAmount !== savedDraft.donationMinimumAmount ||
    draft.donationGoalLabel !== savedDraft.donationGoalLabel;

  function buildDisabledDraft(baseDraft: ServiceDraft): ServiceDraft {
    return {
      ...baseDraft,
      donationMode: "none",
      donationCurrency: "MXN",
      donationMinimumAmount: "",
      donationGoalLabel: "",
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
    await onSaveDraft(overlayDraft);
    setOverlayMode(null);
  }

  function handleSelectMode(nextMode: DonationMode) {
    if (isBusy) return;

    if (nextMode === "none") {
      void onSaveDraft(buildDisabledDraft(draft));
      return;
    }

    const nextDraft: ServiceDraft = {
      ...draft,
      donationMode: nextMode,
      donationCurrency:
        draft.donationMode === "none" ? "MXN" : draft.donationCurrency,
      donationMinimumAmount:
        draft.donationMode === "none" ? "" : draft.donationMinimumAmount,
      donationGoalLabel:
        nextMode === "wedding" ? draft.donationGoalLabel : "",
    };

    openOverlay(draft.donationMode === "none" ? "activate" : "edit", nextDraft);
  }

  function handleModify() {
    if (isBusy || draft.donationMode === "none") return;
    openOverlay("edit", draft);
  }

  function renderSummary() {
    if (draft.donationMode === "none") return null;

    const donationModeLabel =
      draft.donationMode === "general"
        ? "Donación"
        : "Donación para boda";

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
          <div style={subtleStyle}>Modo configurado</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {donationModeLabel}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Monto mínimo</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.donationMinimumAmount
              ? formatMoney(
                  Number(draft.donationMinimumAmount),
                  draft.donationCurrency
                )
              : `0 ${draft.donationCurrency}`}
          </div>
        </div>

        {draft.donationMode === "wedding" && (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={subtleStyle}>Texto visible</div>
            <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
              {draft.donationGoalLabel || "Sin texto"}
            </div>
          </div>
        )}

        {donationMinimumCalc ? (
          <div style={subtleStyle}>
            Monto mínimo configurado:{" "}
            {formatMoney(
              donationMinimumCalc.gross,
              draft.donationCurrency
            )}. El usuario podrá donar ese monto o uno mayor.
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
        <div style={{ display: "grid", gap: 2 }}>
          <span style={titleStyle}>{donationEmoji} Donación</span>
          <span style={subtleStyle}>
            Elige una sola modalidad. Si activas donación o donación para boda,
            se mostrará el monto mínimo. Si eliges sin donación, debe quedar
            totalmente desactivada.
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <DonationModeButtonComponent
            active={draft.donationMode === "none"}
            disabled={isBusy}
            label="Sin donación"
            onClick={() => handleSelectMode("none")}
          />

          <DonationModeButtonComponent
            active={draft.donationMode === "general"}
            disabled={isBusy}
            label="Donación"
            onClick={() => handleSelectMode("general")}
          />

          <DonationModeButtonComponent
            active={draft.donationMode === "wedding"}
            disabled={isBusy}
            label="Donación para boda"
            onClick={() => handleSelectMode("wedding")}
          />
        </div>

        {renderSummary()}

        {draft.donationMode !== "none" && (
          <div style={subtleStyle}>
            El video de agradecimiento o presentación de la donación queda
            pendiente para el hito donde integremos video/live.
          </div>
        )}

        {hasUnsavedDonationChanges && draft.donationMode !== "none" && (
          <div style={subtleStyle}>
            Hay cambios de donación pendientes por guardar.
          </div>
        )}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${donationEmoji} Configurar donación`}
        loading={saving}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <DonationModeButtonComponent
            active={overlayDraft.donationMode === "none"}
            disabled={isBusy}
            label="Sin donación"
            onClick={() =>
              setOverlayDraft((prev) => ({
                ...prev,
                donationMode: "none",
                donationCurrency: "MXN",
                donationMinimumAmount: "",
                donationGoalLabel: "",
              }))
            }
          />

          <DonationModeButtonComponent
            active={overlayDraft.donationMode === "general"}
            disabled={isBusy}
            label="Donación"
            onClick={() =>
              setOverlayDraft((prev) => ({
                ...prev,
                donationMode: "general",
                donationGoalLabel: "",
              }))
            }
          />

          <DonationModeButtonComponent
            active={overlayDraft.donationMode === "wedding"}
            disabled={isBusy}
            label="Donación para boda"
            onClick={() =>
              setOverlayDraft((prev) => ({
                ...prev,
                donationMode: "wedding",
              }))
            }
          />
        </div>

        {overlayDraft.donationMode !== "none" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="number"
                min="1"
                step="0.01"
                value={overlayDraft.donationMinimumAmount}
                onChange={(e) =>
                  setOverlayDraft((prev) => ({
                    ...prev,
                    donationMinimumAmount: e.target.value,
                  }))
                }
                placeholder="Monto mínimo"
                style={{ ...inputStyle, width: 130 }}
              />

              <select
                value={overlayDraft.donationCurrency}
                onChange={(e) =>
                  setOverlayDraft((prev) => ({
                    ...prev,
                    donationCurrency: e.target.value as Currency,
                  }))
                }
                style={{ ...inputStyle, flex: 1, minWidth: 82 }}
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>

            {overlayDraft.donationMode === "wedding" && (
              <input
                type="text"
                value={overlayDraft.donationGoalLabel}
                onChange={(e) =>
                  setOverlayDraft((prev) => ({
                    ...prev,
                    donationGoalLabel: e.target.value,
                  }))
                }
                placeholder="Texto visible (ej. Apoyo para nuestra boda)"
                style={{ ...inputStyle, width: "100%" }}
              />
            )}
          </>
        )}
      </OverlayModalComponent>
    </>
  );
}