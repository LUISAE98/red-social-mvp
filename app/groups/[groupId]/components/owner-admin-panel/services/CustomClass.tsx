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

type DarkSelectProps = {
  value: string;
  placeholder: string;
  options: string[];
  onChange: (value: string) => void;
};

type TimeSelectRowProps = {
  value: string;
  onChange: (next: string) => void;
  inputStyle: React.CSSProperties;
};

type Props = {
  draft: ServiceDraft;
  saving: boolean;

  customClassEmoji: string;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;

  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
  formatMoney: (value: number, currency: Currency) => string;

  SwitchComponent: React.ComponentType<SwitchProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;
  TimeSelectRowComponent: React.ComponentType<TimeSelectRowProps>;

  weekdayOptions: Array<{
    key: keyof WeeklyAvailabilityDraft;
    label: string;
  }>;

  createEmptyWeeklyAvailability: () => WeeklyAvailabilityDraft;

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<void>;
};

type OverlayMode = null | "activate" | "edit";

export default function CustomClass({
  draft,
  saving,
  customClassEmoji,
  panelStyle,
  titleStyle,
  subtleStyle,
  inputStyle,
  buttonSecondaryStyle,
  calcNetAmount,
  formatMoney,
  SwitchComponent,
  OverlayModalComponent,
  TimeSelectRowComponent,
  weekdayOptions,
  createEmptyWeeklyAvailability,
  onSaveDraft,
}: Props) {
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);

  const customClassCalc = useMemo(() => {
    return draft.customClass.enabled ? calcNetAmount(draft.customClass.price) : null;
  }, [draft.customClass.enabled, draft.customClass.price, calcNetAmount]);

  const isBusy = saving;

  function buildEnabledDraft(baseDraft: ServiceDraft) {
    return {
      ...baseDraft,
      customClass: {
        ...baseDraft.customClass,
        enabled: true,
        visible: true,
        visibility: "members" as const,
      },
    };
  }

  function buildDisabledDraft(baseDraft: ServiceDraft) {
    return {
      ...baseDraft,
      customClass: {
        ...baseDraft.customClass,
        enabled: false,
        price: "",
        visible: false,
        visibility: "members" as const,
        durationMinutes: "",
        availability: createEmptyWeeklyAvailability(),
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
      customClass: {
        ...overlayDraft.customClass,
        visible: overlayDraft.customClass.enabled,
        visibility: "members",
      },
    });
    setOverlayMode(null);
  }

  async function handleToggle(next: boolean) {
    if (isBusy) return;

    if (!draft.customClass.enabled && next) {
      openOverlay("activate", buildEnabledDraft(draft));
      return;
    }

    if (draft.customClass.enabled && !next) {
      await onSaveDraft(buildDisabledDraft(draft));
    }
  }

  function handleModify() {
    if (isBusy) return;
    openOverlay("edit", buildEnabledDraft(draft));
  }

  function countAvailabilitySlots() {
    return weekdayOptions.reduce((total, day) => {
      return total + draft.customClass.availability[day.key].length;
    }, 0);
  }

  function renderSummary() {
    if (!draft.customClass.enabled) return null;

    const totalSlots = countAvailabilitySlots();

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
            {draft.customClass.price
              ? formatMoney(
                  Number(draft.customClass.price),
                  draft.customClass.currency
                )
              : `0 ${draft.customClass.currency}`}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Duración configurada</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.customClass.durationMinutes
              ? `${draft.customClass.durationMinutes} min`
              : "Sin duración"}
          </div>
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          <div style={subtleStyle}>Disponibilidad configurada</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {totalSlots > 0 ? `${totalSlots} horario(s)` : "Sin horarios"}
          </div>
        </div>

        {customClassCalc ? (
          <div style={subtleStyle}>
            Por una clase de{" "}
            {formatMoney(customClassCalc.gross, draft.customClass.currency)}, tú cobras{" "}
            {formatMoney(customClassCalc.net, draft.customClass.currency)}.
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
          Modify
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
            <span style={titleStyle}>{customClassEmoji} Clase personalizada</span>
          </div>

          <SwitchComponent
            checked={draft.customClass.enabled}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label="Activar clase personalizada"
          />
        </div>

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={`${customClassEmoji} Configurar clase personalizada`}
        loading={saving}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="number"
            min="1"
            step="0.01"
            value={overlayDraft.customClass.price}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                customClass: {
                  ...prev.customClass,
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
            value={overlayDraft.customClass.currency}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                customClass: {
                  ...prev.customClass,
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
            value={overlayDraft.customClass.durationMinutes}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                customClass: {
                  ...prev.customClass,
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

        <div style={{ display: "grid", gap: 10 }}>
          <div style={titleStyle}>Weekly availability</div>

          {weekdayOptions.map((day) => {
            const slots = overlayDraft.customClass.availability[day.key];

            return (
              <div
                key={day.key}
                style={{
                  padding: "10px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={titleStyle}>{day.label}</span>

                  <button
                    type="button"
                    onClick={() =>
                      setOverlayDraft((prev) => ({
                        ...prev,
                        customClass: {
                          ...prev.customClass,
                          availability: {
                            ...prev.customClass.availability,
                            [day.key]: [
                              ...prev.customClass.availability[day.key],
                              { start: "", end: "" },
                            ],
                          },
                        },
                      }))
                    }
                    style={{
                      ...buttonSecondaryStyle,
                      width: "auto",
                      padding: "6px 10px",
                      fontSize: 12,
                    }}
                  >
                    Add time
                  </button>
                </div>

                {slots.length === 0 ? (
                  <div style={subtleStyle}>Sin horarios configurados.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {slots.map((slot, index) => (
                      <div
                        key={`${day.key}-${index}`}
                        style={{
                          display: "grid",
                          gap: 8,
                          padding: "8px",
                          borderRadius: 10,
                          background: "rgba(255,255,255,0.03)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ display: "grid", gap: 6, flex: "1 1 220px" }}>
                            <span style={subtleStyle}>From</span>
                            <TimeSelectRowComponent
                              value={slot.start}
                              onChange={(nextValue) =>
                                setOverlayDraft((prev) => {
                                  const nextSlots = [
                                    ...prev.customClass.availability[day.key],
                                  ];
                                  nextSlots[index] = {
                                    ...nextSlots[index],
                                    start: nextValue,
                                  };

                                  return {
                                    ...prev,
                                    customClass: {
                                      ...prev.customClass,
                                      availability: {
                                        ...prev.customClass.availability,
                                        [day.key]: nextSlots,
                                      },
                                    },
                                  };
                                })
                              }
                              inputStyle={inputStyle}
                            />
                          </div>

                          <div style={{ display: "grid", gap: 6, flex: "1 1 220px" }}>
                            <span style={subtleStyle}>To</span>
                            <TimeSelectRowComponent
                              value={slot.end}
                              onChange={(nextValue) =>
                                setOverlayDraft((prev) => {
                                  const nextSlots = [
                                    ...prev.customClass.availability[day.key],
                                  ];
                                  nextSlots[index] = {
                                    ...nextSlots[index],
                                    end: nextValue,
                                  };

                                  return {
                                    ...prev,
                                    customClass: {
                                      ...prev.customClass,
                                      availability: {
                                        ...prev.customClass.availability,
                                        [day.key]: nextSlots,
                                      },
                                    },
                                  };
                                })
                              }
                              inputStyle={inputStyle}
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setOverlayDraft((prev) => ({
                              ...prev,
                              customClass: {
                                ...prev.customClass,
                                availability: {
                                  ...prev.customClass.availability,
                                  [day.key]: prev.customClass.availability[
                                    day.key
                                  ].filter((_, i) => i !== index),
                                },
                              },
                            }))
                          }
                          style={{
                            ...buttonSecondaryStyle,
                            width: "auto",
                            padding: "6px 10px",
                            fontSize: 12,
                            justifySelf: "flex-start",
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </OverlayModalComponent>
    </>
  );
}