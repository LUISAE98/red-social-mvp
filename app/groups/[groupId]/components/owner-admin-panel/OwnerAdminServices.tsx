"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { updateOfferings } from "@/lib/groups/updateOfferings";
import type {
  Currency,
  GroupOffering,
  CreatorServiceType,
  ServiceSourceScope,
  GroupDonationSettings,
  DonationMode,
} from "@/types/group";

type Visibility = "public" | "private" | "hidden" | string | null;

type MonetizationInput = {
  isPaid?: boolean;
  priceMonthly?: number | null;
  currency?: Currency | null;
} | null;

type OfferingInput = {
  type?: CreatorServiceType | string;
  enabled?: boolean;
  visible?: boolean;
  memberPrice?: number | null;
  publicPrice?: number | null;
  currency?: Currency | null;
  requiresApproval?: boolean;
  sourceScope?: ServiceSourceScope | string;
  price?: number | null;
} | null;

type DonationInput = Partial<GroupDonationSettings> | null;

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;
  currentVisibility?: Visibility;
  currentMonetization?: MonetizationInput;
  currentOfferings?: OfferingInput[] | null;
  currentDonation?: DonationInput;
};

type ServiceDraft = {
  subscriptionEnabled: boolean;
  subscriptionPrice: string;
  subscriptionCurrency: Currency;

  saludoEnabled: boolean;
  saludoPrice: string;
  saludoCurrency: Currency;

  donationMode: DonationMode;
  donationCurrency: Currency;
  donationMinimumAmount: string;
  donationGoalLabel: string;
};

function pickSubscription(monetization: MonetizationInput) {
  return {
    enabled: monetization?.isPaid === true,
    price: monetization?.priceMonthly ?? null,
    currency: (monetization?.currency ?? "MXN") as Currency,
  };
}

function pickSaludoOffering(offerings: OfferingInput[] | null | undefined) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === "saludo");

  const resolvedPrice =
    found?.memberPrice ?? found?.publicPrice ?? found?.price ?? null;

  return {
    enabled: found?.enabled === true,
    price: resolvedPrice,
    currency: (found?.currency ?? "MXN") as Currency,
  };
}

function pickDonation(donation: DonationInput) {
  const mode: DonationMode =
    donation?.mode === "general" || donation?.mode === "wedding"
      ? donation.mode
      : "none";

  const minimumAmount =
    Array.isArray(donation?.suggestedAmounts) &&
    donation.suggestedAmounts.length > 0 &&
    Number(donation.suggestedAmounts[0]) > 0
      ? String(Number(donation.suggestedAmounts[0]))
      : "";

  return {
    mode,
    currency: (donation?.currency ?? "MXN") as Currency,
    minimumAmount,
    goalLabel:
      typeof donation?.goalLabel === "string" ? donation.goalLabel : "",
  };
}

function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * 0.77;
  return { gross: n, net };
}

function formatMoney(value: number, currency: Currency) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function SpinningGear() {
  return (
    <>
      <style jsx>{`
        @keyframes ownerServicesGearSpin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          animation: "ownerServicesGearSpin 0.9s linear infinite",
          transformOrigin: "50% 50%",
          opacity: 0.9,
        }}
      >
        ⚙
      </span>
    </>
  );
}

function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      title={label}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.08)",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 160ms ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 160ms ease",
        }}
      />
    </button>
  );
}

function DonationModeButton({
  active,
  disabled,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: active
          ? "1px solid rgba(255,255,255,0.92)"
          : "1px solid rgba(255,255,255,0.12)",
        background: active ? "#fff" : "rgba(255,255,255,0.04)",
        color: active ? "#000" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 700,
        fontSize: 12,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        transition: "all 160ms ease",
        minHeight: 42,
      }}
    >
      {label}
    </button>
  );
}

function buildOfferingFromExisting(params: {
  existingOffering: OfferingInput;
  fallbackType: CreatorServiceType;
}): GroupOffering | null {
  const { existingOffering, fallbackType } = params;

  const rawType = (existingOffering?.type ?? fallbackType) as CreatorServiceType;

  if (
    rawType !== "saludo" &&
    rawType !== "consejo" &&
    rawType !== "meet_greet_digital" &&
    rawType !== "mensaje"
  ) {
    return null;
  }

  const memberPrice =
    existingOffering?.memberPrice ?? existingOffering?.price ?? null;

  const publicPrice =
    existingOffering?.publicPrice ?? existingOffering?.price ?? null;

  return {
    type: rawType,
    enabled: existingOffering?.enabled === true,
    visible:
      typeof existingOffering?.visible === "boolean"
        ? existingOffering.visible
        : existingOffering?.enabled === true,
    memberPrice,
    publicPrice,
    currency: existingOffering?.currency ?? null,
    requiresApproval:
      typeof existingOffering?.requiresApproval === "boolean"
        ? existingOffering.requiresApproval
        : true,
    sourceScope:
      existingOffering?.sourceScope === "profile" ||
      existingOffering?.sourceScope === "both" ||
      existingOffering?.sourceScope === "group"
        ? existingOffering.sourceScope
        : "group",
  };
}

function sameDraft(a: ServiceDraft, b: ServiceDraft) {
  return (
    a.subscriptionEnabled === b.subscriptionEnabled &&
    a.subscriptionPrice === b.subscriptionPrice &&
    a.subscriptionCurrency === b.subscriptionCurrency &&
    a.saludoEnabled === b.saludoEnabled &&
    a.saludoPrice === b.saludoPrice &&
    a.saludoCurrency === b.saludoCurrency &&
    a.donationMode === b.donationMode &&
    a.donationCurrency === b.donationCurrency &&
    a.donationMinimumAmount === b.donationMinimumAmount &&
    a.donationGoalLabel === b.donationGoalLabel
  );
}

export default function OwnerAdminServices({
  groupId,
  ownerId,
  currentUserId,
  currentVisibility = null,
  currentMonetization = null,
  currentOfferings = null,
  currentDonation = null,
}: Props) {
  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const isPublic = currentVisibility === "public";

  const [draft, setDraft] = useState<ServiceDraft>({
    subscriptionEnabled: false,
    subscriptionPrice: "",
    subscriptionCurrency: "MXN",
    saludoEnabled: false,
    saludoPrice: "",
    saludoCurrency: "MXN",
    donationMode: "none",
    donationCurrency: "MXN",
    donationMinimumAmount: "",
    donationGoalLabel: "",
  });

  const [savedDraft, setSavedDraft] = useState<ServiceDraft>({
    subscriptionEnabled: false,
    subscriptionPrice: "",
    subscriptionCurrency: "MXN",
    saludoEnabled: false,
    saludoPrice: "",
    saludoCurrency: "MXN",
    donationMode: "none",
    donationCurrency: "MXN",
    donationMinimumAmount: "",
    donationGoalLabel: "",
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const lastHydratedGroupIdRef = useRef<string | null>(null);
  const skipHydrationWhileSavingRef = useRef(false);

  useEffect(() => {
    if (!isOwner) return;

    if (skipHydrationWhileSavingRef.current) {
      return;
    }

    const sub = pickSubscription(currentMonetization);
    const saludo = pickSaludoOffering(currentOfferings);
    const donation = pickDonation(currentDonation);

    const nextDraft: ServiceDraft = {
      subscriptionEnabled: isPublic ? false : sub.enabled,
      subscriptionPrice:
        isPublic || sub.price == null ? "" : String(sub.price),
      subscriptionCurrency: sub.currency ?? "MXN",
      saludoEnabled: saludo.enabled,
      saludoPrice: saludo.price == null ? "" : String(saludo.price),
      saludoCurrency: saludo.currency ?? "MXN",
      donationMode: donation.mode,
      donationCurrency: donation.currency ?? "MXN",
      donationMinimumAmount: donation.minimumAmount,
      donationGoalLabel: donation.goalLabel ?? "",
    };

    const isFirstHydrationForGroup = lastHydratedGroupIdRef.current !== groupId;

    if (isFirstHydrationForGroup) {
      lastHydratedGroupIdRef.current = groupId;
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
      setMsg(null);
      setErr(null);
      return;
    }

    setSavedDraft((prevSaved) => {
      if (sameDraft(prevSaved, nextDraft)) {
        return prevSaved;
      }
      return nextDraft;
    });

    setDraft((prevDraft) => {
      const hasUnsavedChanges = !sameDraft(prevDraft, savedDraft);
      if (hasUnsavedChanges) {
        return prevDraft;
      }
      return nextDraft;
    });
  }, [
    groupId,
    isOwner,
    isPublic,
    currentMonetization,
    currentOfferings,
    currentDonation,
    savedDraft,
  ]);

  useEffect(() => {
    if (!saving) {
      skipHydrationWhileSavingRef.current = false;
    }
  }, [saving]);

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const contentStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
  };

  const panelStyle: React.CSSProperties = {
    padding: "10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
    gap: 9,
  };

  const rowBetweenStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#fff",
    fontWeight: 700,
  };

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  const inputStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    outline: "none",
    fontSize: 12,
    fontFamily: fontStack,
    boxSizing: "border-box",
    appearance: "none",
    WebkitAppearance: "none",
    minHeight: 42,
  };

  const buttonSecondaryStyle: React.CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
    fontFamily: fontStack,
    lineHeight: 1.1,
    width: "100%",
  };

  const noticeStyle: React.CSSProperties = {
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "8px 10px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
  };

  const subChanged =
    draft.subscriptionEnabled !== savedDraft.subscriptionEnabled ||
    draft.subscriptionPrice !== savedDraft.subscriptionPrice ||
    draft.subscriptionCurrency !== savedDraft.subscriptionCurrency;

  const saludoChanged =
    draft.saludoEnabled !== savedDraft.saludoEnabled ||
    draft.saludoPrice !== savedDraft.saludoPrice ||
    draft.saludoCurrency !== savedDraft.saludoCurrency;

  const donationChanged =
    draft.donationMode !== savedDraft.donationMode ||
    draft.donationCurrency !== savedDraft.donationCurrency ||
    draft.donationMinimumAmount !== savedDraft.donationMinimumAmount ||
    draft.donationGoalLabel !== savedDraft.donationGoalLabel;

  const subscriptionCalc =
    draft.subscriptionEnabled && subChanged
      ? calcNetAmount(draft.subscriptionPrice)
      : null;

  const saludoCalc =
    draft.saludoEnabled && saludoChanged
      ? calcNetAmount(draft.saludoPrice)
      : null;

  const donationMinimumCalc =
    draft.donationMode !== "none"
      ? calcNetAmount(draft.donationMinimumAmount)
      : null;

  async function saveServices() {
    setSaving(true);
    setMsg(null);
    setErr(null);

    try {
      const subscriptionPriceNum =
        draft.subscriptionPrice.trim() === ""
          ? null
          : Number(draft.subscriptionPrice);

      const saludoPriceNum =
        draft.saludoPrice.trim() === "" ? null : Number(draft.saludoPrice);

      const donationMinimumNum =
        draft.donationMinimumAmount.trim() === ""
          ? null
          : Number(draft.donationMinimumAmount);

      if (
        draft.subscriptionEnabled &&
        (subscriptionPriceNum == null ||
          Number.isNaN(subscriptionPriceNum) ||
          subscriptionPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para la suscripción mensual.");
        return;
      }

      if (
        draft.saludoEnabled &&
        (saludoPriceNum == null ||
          Number.isNaN(saludoPriceNum) ||
          saludoPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para saludos.");
        return;
      }

      if (isPublic && draft.subscriptionEnabled) {
        setErr(
          "❌ Las comunidades públicas no pueden activar suscripción mensual."
        );
        return;
      }

      if (
        draft.donationMode !== "none" &&
        (donationMinimumNum == null ||
          Number.isNaN(donationMinimumNum) ||
          donationMinimumNum <= 0)
      ) {
        setErr("❌ Debes definir un monto mínimo válido para la donación.");
        return;
      }

      if (
        draft.donationMode === "wedding" &&
        !draft.donationGoalLabel.trim()
      ) {
        setErr("❌ Debes escribir el texto visible para la donación de boda.");
        return;
      }

      const existing = Array.isArray(currentOfferings) ? currentOfferings : [];
      const nextOfferings: GroupOffering[] = [];

      nextOfferings.push({
        type: "saludo",
        enabled: draft.saludoEnabled,
        visible: draft.saludoEnabled,
        memberPrice: draft.saludoEnabled ? saludoPriceNum : null,
        publicPrice: draft.saludoEnabled ? saludoPriceNum : null,
        currency: draft.saludoEnabled ? draft.saludoCurrency : null,
        requiresApproval: true,
        sourceScope: "group",
      });

      const consejoExisting = existing.find(
        (x) => String(x?.type) === "consejo"
      );
      if (consejoExisting) {
        const normalized = buildOfferingFromExisting({
          existingOffering: consejoExisting,
          fallbackType: "consejo",
        });
        if (normalized) nextOfferings.push(normalized);
      }

      const meetGreetExisting = existing.find(
        (x) => String(x?.type) === "meet_greet_digital"
      );
      if (meetGreetExisting) {
        const normalized = buildOfferingFromExisting({
          existingOffering: meetGreetExisting,
          fallbackType: "meet_greet_digital",
        });
        if (normalized) nextOfferings.push(normalized);
      }

      const mensajeExisting = existing.find(
        (x) => String(x?.type) === "mensaje"
      );
      if (mensajeExisting) {
        const normalized = buildOfferingFromExisting({
          existingOffering: mensajeExisting,
          fallbackType: "mensaje",
        });
        if (normalized) nextOfferings.push(normalized);
      }

      const nextDonation: GroupDonationSettings = {
        mode: draft.donationMode,
        enabled: draft.donationMode !== "none",
        visible: draft.donationMode !== "none",
        currency:
          draft.donationMode !== "none" ? draft.donationCurrency : "MXN",
        sourceScope: "group",
        suggestedAmounts:
          draft.donationMode !== "none" && donationMinimumNum != null
            ? [donationMinimumNum]
            : [],
        goalLabel:
          draft.donationMode === "wedding"
            ? draft.donationGoalLabel.trim() || null
            : null,
      };

      skipHydrationWhileSavingRef.current = true;

      await updateDoc(doc(db, "groups", groupId), {
        monetization: {
          isPaid: isPublic ? false : draft.subscriptionEnabled,
          priceMonthly:
            isPublic || !draft.subscriptionEnabled ? null : subscriptionPriceNum,
          currency:
            isPublic || !draft.subscriptionEnabled
              ? null
              : draft.subscriptionCurrency,
        },
      });

      await updateOfferings(groupId, nextOfferings, nextDonation);

      const nextSaved: ServiceDraft = {
        subscriptionEnabled: isPublic ? false : draft.subscriptionEnabled,
        subscriptionPrice:
          isPublic || !draft.subscriptionEnabled ? "" : draft.subscriptionPrice,
        subscriptionCurrency: draft.subscriptionCurrency,
        saludoEnabled: draft.saludoEnabled,
        saludoPrice: draft.saludoEnabled ? draft.saludoPrice : "",
        saludoCurrency: draft.saludoCurrency,
        donationMode: draft.donationMode,
        donationCurrency:
          draft.donationMode !== "none" ? draft.donationCurrency : "MXN",
        donationMinimumAmount:
          draft.donationMode !== "none" ? draft.donationMinimumAmount : "",
        donationGoalLabel:
          draft.donationMode === "wedding" ? draft.donationGoalLabel : "",
      };

      setDraft(nextSaved);
      setSavedDraft(nextSaved);
      setMsg("✅ Servicios y donación guardados.");
    } catch (e: any) {
      skipHydrationWhileSavingRef.current = false;
      setErr(e?.message ?? "❌ No se pudieron guardar los servicios.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={contentStyle}>
      <div style={panelStyle}>
        <div style={rowBetweenStyle}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={titleStyle}>Suscripción mensual</span>
            <span style={subtleStyle}>
              Define si tu comunidad cobra acceso mensual.
            </span>
          </div>

          <Switch
            checked={draft.subscriptionEnabled}
            disabled={saving || isPublic}
            onChange={(next) =>
              setDraft((prev) => ({
                ...prev,
                subscriptionEnabled: next,
                subscriptionPrice: next ? prev.subscriptionPrice : "",
              }))
            }
            label="Activar suscripción mensual"
          />
        </div>

        {draft.subscriptionEnabled && !isPublic && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="number"
                value={draft.subscriptionPrice}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    subscriptionPrice: e.target.value,
                  }))
                }
                placeholder="Precio mensual"
                style={{ ...inputStyle, width: 116 }}
              />

              <select
                value={draft.subscriptionCurrency}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    subscriptionCurrency: e.target.value as Currency,
                  }))
                }
                style={{ ...inputStyle, flex: 1, minWidth: 82 }}
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>

            {subscriptionCalc && (
              <div style={subtleStyle}>
                Por una suscripción de{" "}
                {formatMoney(
                  subscriptionCalc.gross,
                  draft.subscriptionCurrency
                )}
                , tú cobras{" "}
                {formatMoney(subscriptionCalc.net, draft.subscriptionCurrency)}
              </div>
            )}
          </>
        )}

        {isPublic && (
          <div style={subtleStyle}>
            Para activar suscripción mensual tu comunidad debe ser privada u
            oculta.
          </div>
        )}
      </div>

      <div style={panelStyle}>
        <div style={rowBetweenStyle}>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <span style={titleStyle}>Saludos en comunidad</span>
            <span style={subtleStyle}>
              Activa o desactiva la compra de saludos desde esta comunidad.
            </span>
          </div>

          <Switch
            checked={draft.saludoEnabled}
            disabled={saving}
            onChange={(next) =>
              setDraft((prev) => ({
                ...prev,
                saludoEnabled: next,
                saludoPrice: next ? prev.saludoPrice : "",
              }))
            }
            label="Saludos activos en esta comunidad"
          />
        </div>

        {draft.saludoEnabled && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="number"
                value={draft.saludoPrice}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    saludoPrice: e.target.value,
                  }))
                }
                placeholder="Precio"
                style={{ ...inputStyle, width: 100 }}
              />

              <select
                value={draft.saludoCurrency}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    saludoCurrency: e.target.value as Currency,
                  }))
                }
                style={{ ...inputStyle, flex: 1, minWidth: 82 }}
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </div>

            {saludoCalc && (
              <div style={subtleStyle}>
                Por un saludo de{" "}
                {formatMoney(saludoCalc.gross, draft.saludoCurrency)}, tú cobras{" "}
                {formatMoney(saludoCalc.net, draft.saludoCurrency)}
              </div>
            )}
          </>
        )}
      </div>

      <div style={panelStyle}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={titleStyle}>Donación</span>
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
          <DonationModeButton
            active={draft.donationMode === "none"}
            disabled={saving}
            label="Sin donación"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                donationMode: "none",
                donationCurrency: "MXN",
                donationMinimumAmount: "",
                donationGoalLabel: "",
              }))
            }
          />

          <DonationModeButton
            active={draft.donationMode === "general"}
            disabled={saving}
            label="Donación"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                donationMode: "general",
                donationGoalLabel: "",
              }))
            }
          />

          <DonationModeButton
            active={draft.donationMode === "wedding"}
            disabled={saving}
            label="Donación para boda"
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                donationMode: "wedding",
              }))
            }
          />
        </div>

        {draft.donationMode !== "none" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="number"
                min="1"
                step="0.01"
                value={draft.donationMinimumAmount}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    donationMinimumAmount: e.target.value,
                  }))
                }
                placeholder="Monto mínimo"
                style={{ ...inputStyle, width: 130 }}
              />

              <select
                value={draft.donationCurrency}
                onChange={(e) =>
                  setDraft((prev) => ({
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

            {draft.donationMode === "wedding" && (
              <input
                type="text"
                value={draft.donationGoalLabel}
                onChange={(e) =>
                  setDraft((prev) => ({
                    ...prev,
                    donationGoalLabel: e.target.value,
                  }))
                }
                placeholder="Texto visible (ej. Apoyo para nuestra boda)"
                style={{ ...inputStyle, width: "100%" }}
              />
            )}

            {donationMinimumCalc && (
              <div style={subtleStyle}>
                Monto mínimo configurado:{" "}
                {formatMoney(
                  donationMinimumCalc.gross,
                  draft.donationCurrency
                )}
                . El usuario podrá donar ese monto o uno mayor.
              </div>
            )}

            <div style={subtleStyle}>
              El video de agradecimiento o presentación de la donación queda
              pendiente para el hito donde integremos video/live.
            </div>
          </>
        )}

        {donationChanged && (
          <div style={subtleStyle}>
            Estado seleccionado:{" "}
            {draft.donationMode === "none"
              ? "sin donación"
              : draft.donationMode === "general"
              ? "donación"
              : "donación para boda"}
            .
          </div>
        )}
      </div>

      {err && <div style={noticeStyle}>{err}</div>}
      {msg && <div style={noticeStyle}>{msg}</div>}

      <button
        type="button"
        onClick={saveServices}
        disabled={saving}
        style={{
          ...buttonSecondaryStyle,
          opacity: saving ? 0.7 : 1,
          cursor: saving ? "not-allowed" : "pointer",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        {saving ? (
          <>
            <SpinningGear />
            Guardando...
          </>
        ) : (
          "Guardar cambios"
        )}
      </button>
    </div>
  );
}