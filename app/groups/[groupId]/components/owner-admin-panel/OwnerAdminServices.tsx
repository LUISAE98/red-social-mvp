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
  ServiceVisibility,
  GroupDonationSettings,
  DonationMode,
  CreatorServiceMeta,
} from "@/types/group";

type Visibility = "public" | "private" | "hidden" | string | null;

type MonetizationInput = {
  isPaid?: boolean;
  priceMonthly?: number | null;
  currency?: Currency | null;
  subscriptionsEnabled?: boolean;
  paidPostsEnabled?: boolean;
  paidLivesEnabled?: boolean;
  paidVodEnabled?: boolean;
  paidLiveCommentsEnabled?: boolean;
  greetingsEnabled?: boolean;
  adviceEnabled?: boolean;
  customClassEnabled?: boolean;
  digitalMeetGreetEnabled?: boolean;
} | null;

type OfferingInput = {
  type?: CreatorServiceType | string;
  enabled?: boolean;
  visible?: boolean;
  visibility?: ServiceVisibility | string;
  displayOrder?: number | null;
  memberPrice?: number | null;
  publicPrice?: number | null;
  currency?: Currency | null;
  requiresApproval?: boolean;
  sourceScope?: ServiceSourceScope | string;
  meta?: CreatorServiceMeta | null;
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

type ServiceBlockDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
  visible: boolean;
  visibility: ServiceVisibility;
};

type ServiceDraft = {
  subscription: ServiceBlockDraft;
  saludo: ServiceBlockDraft;
  consejo: ServiceBlockDraft;
  meetGreet: ServiceBlockDraft & {
    durationMinutes: string;
  };
  customClass: ServiceBlockDraft & {
    durationMinutes: string;
  };
  donationMode: DonationMode;
  donationCurrency: Currency;
  donationMinimumAmount: string;
  donationGoalLabel: string;
};

function pickSubscription(
  monetization: MonetizationInput,
  offerings: OfferingInput[] | null | undefined
) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const subscriptionOffering = arr.find((o) => String(o?.type) === "suscripcion");

  const enabled =
    typeof monetization?.subscriptionsEnabled === "boolean"
      ? monetization.subscriptionsEnabled
      : monetization?.isPaid === true || subscriptionOffering?.enabled === true;

  return {
    enabled,
    price:
      monetization?.priceMonthly ??
      subscriptionOffering?.memberPrice ??
      subscriptionOffering?.publicPrice ??
      subscriptionOffering?.price ??
      null,
    currency: monetization?.currency ?? subscriptionOffering?.currency ?? "MXN",
    visible:
      typeof subscriptionOffering?.visible === "boolean"
        ? subscriptionOffering.visible
        : enabled,
    visibility:
      subscriptionOffering?.visibility === "members" ||
      subscriptionOffering?.visibility === "public" ||
      subscriptionOffering?.visibility === "hidden"
        ? subscriptionOffering.visibility
        : enabled
        ? "public"
        : "hidden",
  };
}

function pickOffering(
  offerings: OfferingInput[] | null | undefined,
  type: CreatorServiceType
) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === type);

  const resolvedPrice =
    found?.memberPrice ?? found?.publicPrice ?? found?.price ?? null;

  const meta = found?.meta ?? null;

  return {
    enabled: found?.enabled === true,
    price: resolvedPrice,
    currency: (found?.currency ?? "MXN") as Currency,
    visible:
      typeof found?.visible === "boolean"
        ? found.visible
        : found?.enabled === true,
    visibility:
      found?.visibility === "members" ||
      found?.visibility === "public" ||
      found?.visibility === "hidden"
        ? found.visibility
        : found?.enabled === true
        ? "public"
        : "hidden",
    meta,
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
    goalLabel: typeof donation?.goalLabel === "string" ? donation.goalLabel : "",
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

function normalizeServiceVisibility(
  value: unknown,
  fallback: ServiceVisibility
): ServiceVisibility {
  if (value === "hidden" || value === "members" || value === "public") {
    return value;
  }
  return fallback;
}

function normalizeDurationMeta(
  meta: CreatorServiceMeta | null | undefined,
  mode: "meetGreet" | "customClass"
): string {
  const raw =
    mode === "meetGreet"
      ? meta?.meetGreet?.durationMinutes
      : meta?.customClass?.durationMinutes;

  if (raw == null) return "";

  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? String(n) : "";
}

function buildServiceBlockDraft(input: {
  enabled: boolean;
  price: number | null;
  currency: Currency;
  visible: boolean;
  visibility: ServiceVisibility;
}): ServiceBlockDraft {
  return {
    enabled: input.enabled,
    price: input.price == null ? "" : String(input.price),
    currency: input.currency,
    visible: input.visible,
    visibility: input.visibility,
  };
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

function sameServiceBlock(a: ServiceBlockDraft, b: ServiceBlockDraft) {
  return (
    a.enabled === b.enabled &&
    a.price === b.price &&
    a.currency === b.currency &&
    a.visible === b.visible &&
    a.visibility === b.visibility
  );
}

function sameDraft(a: ServiceDraft, b: ServiceDraft) {
  return (
    sameServiceBlock(a.subscription, b.subscription) &&
    sameServiceBlock(a.saludo, b.saludo) &&
    sameServiceBlock(a.consejo, b.consejo) &&
    sameServiceBlock(a.meetGreet, b.meetGreet) &&
    a.meetGreet.durationMinutes === b.meetGreet.durationMinutes &&
    sameServiceBlock(a.customClass, b.customClass) &&
    a.customClass.durationMinutes === b.customClass.durationMinutes &&
    a.donationMode === b.donationMode &&
    a.donationCurrency === b.donationCurrency &&
    a.donationMinimumAmount === b.donationMinimumAmount &&
    a.donationGoalLabel === b.donationGoalLabel
  );
}

function buildOffering(params: {
  type: CreatorServiceType;
  draft: ServiceBlockDraft;
  displayOrder: number;
  meta?: CreatorServiceMeta | null;
}): GroupOffering {
  const { type, draft, displayOrder, meta = null } = params;
  const priceNum = draft.price.trim() === "" ? null : Number(draft.price);

  return {
    type,
    enabled: draft.enabled,
    visible: draft.visible,
    visibility: draft.visibility,
    displayOrder,
    memberPrice: draft.enabled ? priceNum : null,
    publicPrice: draft.enabled ? priceNum : null,
    currency: draft.enabled ? draft.currency : null,
    requiresApproval: type !== "suscripcion",
    sourceScope: "group",
    meta,
    price: draft.enabled ? priceNum : null,
  };
}

function ServiceEditorBlock({
  title,
  description,
  draft,
  onChange,
  saving,
  showDuration = false,
  durationLabel = "Duración (minutos)",
  netText,
}: {
  title: string;
  description: string;
  draft: ServiceBlockDraft & { durationMinutes?: string };
  onChange: (
    updater:
      | Partial<ServiceBlockDraft & { durationMinutes?: string }>
      | ((
          prev: ServiceBlockDraft & { durationMinutes?: string }
        ) => ServiceBlockDraft & { durationMinutes?: string })
  ) => void;
  saving: boolean;
  showDuration?: boolean;
  durationLabel?: string;
  netText?: string | null;
}) {
  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

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

  const applyChange = (
    updater:
      | Partial<ServiceBlockDraft & { durationMinutes?: string }>
      | ((
          prev: ServiceBlockDraft & { durationMinutes?: string }
        ) => ServiceBlockDraft & { durationMinutes?: string })
  ) => {
    onChange(updater);
  };

  return (
    <div style={panelStyle}>
      <div style={rowBetweenStyle}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={titleStyle}>{title}</span>
          <span style={subtleStyle}>{description}</span>
        </div>

        <Switch
          checked={draft.enabled}
          disabled={saving}
          onChange={(next) =>
            applyChange((prev) => ({
              ...prev,
              enabled: next,
              price: next ? prev.price : "",
              visible: next ? prev.visible : false,
              visibility: next ? prev.visibility : "hidden",
            }))
          }
          label={`Activar ${title}`}
        />
      </div>

      {draft.enabled && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="number"
              min="1"
              step="0.01"
              value={draft.price}
              onChange={(e) =>
                applyChange((prev) => ({
                  ...prev,
                  price: e.target.value,
                }))
              }
              placeholder="Precio"
              style={{ ...inputStyle, width: 110 }}
            />

            <select
              value={draft.currency}
              onChange={(e) =>
                applyChange((prev) => ({
                  ...prev,
                  currency: e.target.value as Currency,
                }))
              }
              style={{ ...inputStyle, width: 92 }}
            >
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>

            <select
              value={draft.visibility}
              onChange={(e) =>
                applyChange((prev) => ({
                  ...prev,
                  visibility: e.target.value as ServiceVisibility,
                  visible: e.target.value !== "hidden",
                }))
              }
              style={{ ...inputStyle, flex: 1, minWidth: 130 }}
            >
              <option value="public">Visible público</option>
              <option value="members">Visible solo miembros</option>
              <option value="hidden">Oculto</option>
            </select>
          </div>

          {showDuration && (
            <input
              type="number"
              min="1"
              step="1"
              value={draft.durationMinutes ?? ""}
              onChange={(e) =>
                applyChange((prev) => ({
                  ...prev,
                  durationMinutes: e.target.value,
                }))
              }
              placeholder={durationLabel}
              style={{ ...inputStyle, width: 180 }}
            />
          )}

          {netText ? (
            <div style={subtleStyle}>{netText}</div>
          ) : (
            <div style={subtleStyle}>
              Este servicio se mostrará en el menú del grupo según su visibilidad.
            </div>
          )}
        </>
      )}
    </div>
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
    subscription: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
    },
    saludo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
    },
    consejo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
    },
    meetGreet: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
      durationMinutes: "",
    },
    customClass: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
      durationMinutes: "",
    },
    donationMode: "none",
    donationCurrency: "MXN",
    donationMinimumAmount: "",
    donationGoalLabel: "",
  });

  const [savedDraft, setSavedDraft] = useState<ServiceDraft>({
    subscription: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
    },
    saludo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
    },
    consejo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
    },
    meetGreet: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
      durationMinutes: "",
    },
    customClass: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "hidden",
      durationMinutes: "",
    },
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
    if (skipHydrationWhileSavingRef.current) return;

    const sub = pickSubscription(currentMonetization, currentOfferings);
    const saludo = pickOffering(currentOfferings, "saludo");
    const consejo = pickOffering(currentOfferings, "consejo");
    const meetGreet = pickOffering(currentOfferings, "meet_greet_digital");
    const customClass = pickOffering(currentOfferings, "clase_personalizada");
    const donation = pickDonation(currentDonation);

    const nextDraft: ServiceDraft = {
      subscription: buildServiceBlockDraft({
        enabled: isPublic ? false : sub.enabled,
        price: isPublic ? null : sub.price,
        currency: sub.currency ?? "MXN",
        visible: isPublic ? false : sub.visible,
        visibility: isPublic
          ? "hidden"
          : normalizeServiceVisibility(
              sub.visibility,
              sub.enabled ? "public" : "hidden"
            ),
      }),
      saludo: buildServiceBlockDraft({
        enabled: saludo.enabled,
        price: saludo.price,
        currency: saludo.currency ?? "MXN",
        visible: saludo.visible,
        visibility: normalizeServiceVisibility(
          saludo.visibility,
          saludo.enabled ? "public" : "hidden"
        ),
      }),
      consejo: buildServiceBlockDraft({
        enabled: consejo.enabled,
        price: consejo.price,
        currency: consejo.currency ?? "MXN",
        visible: consejo.visible,
        visibility: normalizeServiceVisibility(
          consejo.visibility,
          consejo.enabled ? "public" : "hidden"
        ),
      }),
      meetGreet: {
        ...buildServiceBlockDraft({
          enabled: meetGreet.enabled,
          price: meetGreet.price,
          currency: meetGreet.currency ?? "MXN",
          visible: meetGreet.visible,
          visibility: normalizeServiceVisibility(
            meetGreet.visibility,
            meetGreet.enabled ? "public" : "hidden"
          ),
        }),
        durationMinutes: normalizeDurationMeta(meetGreet.meta, "meetGreet"),
      },
      customClass: {
        ...buildServiceBlockDraft({
          enabled: customClass.enabled,
          price: customClass.price,
          currency: customClass.currency ?? "MXN",
          visible: customClass.visible,
          visibility: normalizeServiceVisibility(
            customClass.visibility,
            customClass.enabled ? "public" : "hidden"
          ),
        }),
        durationMinutes: normalizeDurationMeta(
          customClass.meta,
          "customClass"
        ),
      },
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
      if (sameDraft(prevSaved, nextDraft)) return prevSaved;
      return nextDraft;
    });

    setDraft((prevDraft) => {
      const hasUnsavedChanges = !sameDraft(prevDraft, savedDraft);
      if (hasUnsavedChanges) return prevDraft;
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

  const subtleStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    lineHeight: 1.35,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#fff",
    fontWeight: 700,
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

  const noticeStyle: React.CSSProperties = {
    borderRadius: 9,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.035)",
    padding: "8px 10px",
    fontSize: 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.84)",
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

  const subscriptionCalc =
    draft.subscription.enabled ? calcNetAmount(draft.subscription.price) : null;
  const saludoCalc =
    draft.saludo.enabled ? calcNetAmount(draft.saludo.price) : null;
  const consejoCalc =
    draft.consejo.enabled ? calcNetAmount(draft.consejo.price) : null;
  const meetGreetCalc =
    draft.meetGreet.enabled ? calcNetAmount(draft.meetGreet.price) : null;
  const customClassCalc =
    draft.customClass.enabled ? calcNetAmount(draft.customClass.price) : null;
  const donationMinimumCalc =
    draft.donationMode !== "none"
      ? calcNetAmount(draft.donationMinimumAmount)
      : null;

  function updateBlock<K extends keyof Pick<
    ServiceDraft,
    "subscription" | "saludo" | "consejo" | "meetGreet" | "customClass"
  >>(
    key: K,
    updater: Partial<ServiceDraft[K]> | ((prev: ServiceDraft[K]) => ServiceDraft[K])
  ) {
    setDraft((prev) => ({
      ...prev,
      [key]:
        typeof updater === "function"
          ? (updater as (prevValue: ServiceDraft[K]) => ServiceDraft[K])(prev[key])
          : { ...prev[key], ...updater },
    }));
  }

  async function saveServices() {
    setSaving(true);
    setMsg(null);
    setErr(null);

    try {
      const subscriptionPriceNum =
        draft.subscription.price.trim() === ""
          ? null
          : Number(draft.subscription.price);

      const saludoPriceNum =
        draft.saludo.price.trim() === "" ? null : Number(draft.saludo.price);

      const consejoPriceNum =
        draft.consejo.price.trim() === "" ? null : Number(draft.consejo.price);

      const meetGreetPriceNum =
        draft.meetGreet.price.trim() === ""
          ? null
          : Number(draft.meetGreet.price);

      const customClassPriceNum =
        draft.customClass.price.trim() === ""
          ? null
          : Number(draft.customClass.price);

      const meetGreetDurationNum =
        draft.meetGreet.durationMinutes.trim() === ""
          ? null
          : Number(draft.meetGreet.durationMinutes);

      const customClassDurationNum =
        draft.customClass.durationMinutes.trim() === ""
          ? null
          : Number(draft.customClass.durationMinutes);

      const donationMinimumNum =
        draft.donationMinimumAmount.trim() === ""
          ? null
          : Number(draft.donationMinimumAmount);

      if (
        draft.subscription.enabled &&
        (subscriptionPriceNum == null ||
          Number.isNaN(subscriptionPriceNum) ||
          subscriptionPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para la suscripción mensual.");
        return;
      }

      if (
        draft.saludo.enabled &&
        (saludoPriceNum == null ||
          Number.isNaN(saludoPriceNum) ||
          saludoPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para saludos.");
        return;
      }

      if (
        draft.consejo.enabled &&
        (consejoPriceNum == null ||
          Number.isNaN(consejoPriceNum) ||
          consejoPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para consejos.");
        return;
      }

      if (
        draft.meetGreet.enabled &&
        (meetGreetPriceNum == null ||
          Number.isNaN(meetGreetPriceNum) ||
          meetGreetPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para meet & greet digital.");
        return;
      }

      if (
        draft.customClass.enabled &&
        (customClassPriceNum == null ||
          Number.isNaN(customClassPriceNum) ||
          customClassPriceNum <= 0)
      ) {
        setErr("❌ Precio inválido para clase personalizada.");
        return;
      }

      if (
        draft.meetGreet.enabled &&
        (meetGreetDurationNum == null ||
          Number.isNaN(meetGreetDurationNum) ||
          meetGreetDurationNum <= 0 ||
          !Number.isInteger(meetGreetDurationNum))
      ) {
        setErr("❌ Debes definir una duración válida en minutos para meet & greet.");
        return;
      }

      if (
        draft.customClass.enabled &&
        (customClassDurationNum == null ||
          Number.isNaN(customClassDurationNum) ||
          customClassDurationNum <= 0 ||
          !Number.isInteger(customClassDurationNum))
      ) {
        setErr("❌ Debes definir una duración válida en minutos para la clase personalizada.");
        return;
      }

      if (isPublic && draft.subscription.enabled) {
        setErr("❌ Las comunidades públicas no pueden activar suscripción mensual.");
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

      if (draft.donationMode === "wedding" && !draft.donationGoalLabel.trim()) {
        setErr("❌ Debes escribir el texto visible para la donación de boda.");
        return;
      }

      const nextOfferings: GroupOffering[] = [
        buildOffering({
          type: "suscripcion",
          draft: {
            ...draft.subscription,
            enabled: isPublic ? false : draft.subscription.enabled,
            visible: isPublic ? false : draft.subscription.visible,
            visibility: isPublic ? "hidden" : draft.subscription.visibility,
          },
          displayOrder: 0,
          meta: {
            subscription: {
              billingPeriod: "monthly",
            },
          },
        }),
        buildOffering({
          type: "saludo",
          draft: draft.saludo,
          displayOrder: 1,
        }),
        buildOffering({
          type: "consejo",
          draft: draft.consejo,
          displayOrder: 2,
        }),
        buildOffering({
          type: "meet_greet_digital",
          draft: draft.meetGreet,
          displayOrder: 3,
          meta: {
            meetGreet: {
              durationMinutes: draft.meetGreet.enabled
                ? meetGreetDurationNum
                : null,
            },
          },
        }),
        buildOffering({
          type: "clase_personalizada",
          draft: draft.customClass,
          displayOrder: 4,
          meta: {
            customClass: {
              durationMinutes: draft.customClass.enabled
                ? customClassDurationNum
                : null,
            },
          },
        }),
      ];

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

      const preservedPaidPostsEnabled =
        typeof currentMonetization?.paidPostsEnabled === "boolean"
          ? currentMonetization.paidPostsEnabled
          : false;

      const preservedPaidLivesEnabled =
        typeof currentMonetization?.paidLivesEnabled === "boolean"
          ? currentMonetization.paidLivesEnabled
          : false;

      const preservedPaidVodEnabled =
        typeof currentMonetization?.paidVodEnabled === "boolean"
          ? currentMonetization.paidVodEnabled
          : false;

      const preservedPaidLiveCommentsEnabled =
        typeof currentMonetization?.paidLiveCommentsEnabled === "boolean"
          ? currentMonetization.paidLiveCommentsEnabled
          : false;

      const nextMonetization = {
        isPaid: isPublic ? false : draft.subscription.enabled,
        priceMonthly:
          isPublic || !draft.subscription.enabled ? null : subscriptionPriceNum,
        currency:
          isPublic || !draft.subscription.enabled
            ? null
            : draft.subscription.currency,

        subscriptionsEnabled: isPublic ? false : draft.subscription.enabled,
        paidPostsEnabled: preservedPaidPostsEnabled,
        paidLivesEnabled: preservedPaidLivesEnabled,
        paidVodEnabled: preservedPaidVodEnabled,
        paidLiveCommentsEnabled: preservedPaidLiveCommentsEnabled,

        greetingsEnabled: draft.saludo.enabled,
        adviceEnabled: draft.consejo.enabled,
        customClassEnabled: draft.customClass.enabled,
        digitalMeetGreetEnabled: draft.meetGreet.enabled,
      };

      skipHydrationWhileSavingRef.current = true;

      await updateDoc(doc(db, "groups", groupId), {
        monetization: nextMonetization,
        greetingsEnabled: draft.saludo.enabled,
      });

      await updateOfferings(groupId, nextOfferings, nextDonation);

      const nextSaved: ServiceDraft = {
        subscription: {
          ...draft.subscription,
          enabled: isPublic ? false : draft.subscription.enabled,
          price:
            isPublic || !draft.subscription.enabled
              ? ""
              : draft.subscription.price,
          visible: isPublic ? false : draft.subscription.visible,
          visibility: isPublic ? "hidden" : draft.subscription.visibility,
        },
        saludo: {
          ...draft.saludo,
          price: draft.saludo.enabled ? draft.saludo.price : "",
          visible: draft.saludo.enabled ? draft.saludo.visible : false,
          visibility: draft.saludo.enabled ? draft.saludo.visibility : "hidden",
        },
        consejo: {
          ...draft.consejo,
          price: draft.consejo.enabled ? draft.consejo.price : "",
          visible: draft.consejo.enabled ? draft.consejo.visible : false,
          visibility: draft.consejo.enabled ? draft.consejo.visibility : "hidden",
        },
        meetGreet: {
          ...draft.meetGreet,
          price: draft.meetGreet.enabled ? draft.meetGreet.price : "",
          visible: draft.meetGreet.enabled ? draft.meetGreet.visible : false,
          visibility: draft.meetGreet.enabled
            ? draft.meetGreet.visibility
            : "hidden",
          durationMinutes: draft.meetGreet.enabled
            ? draft.meetGreet.durationMinutes
            : "",
        },
        customClass: {
          ...draft.customClass,
          price: draft.customClass.enabled ? draft.customClass.price : "",
          visible: draft.customClass.enabled ? draft.customClass.visible : false,
          visibility: draft.customClass.enabled
            ? draft.customClass.visibility
            : "hidden",
          durationMinutes: draft.customClass.enabled
            ? draft.customClass.durationMinutes
            : "",
        },
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
      setMsg("✅ Catálogo de servicios y donación guardados.");
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
        <div style={{ display: "grid", gap: 2 }}>
          <span style={titleStyle}>Catálogo de servicios del grupo</span>
          <span style={subtleStyle}>
            Aquí defines qué servicios del menú estarán activos, cuánto cuestan
            y cómo se muestran. Donación sigue separada porque no pertenece al
            menú principal.
          </span>
        </div>
      </div>

      <ServiceEditorBlock
        title="Suscripción mensual"
        description="Define si tu comunidad cobra acceso mensual."
        draft={draft.subscription}
        saving={saving || isPublic}
        onChange={(updater) => updateBlock("subscription", updater)}
        netText={
          subscriptionCalc
            ? `Por una suscripción de ${formatMoney(
                subscriptionCalc.gross,
                draft.subscription.currency
              )}, tú cobras ${formatMoney(
                subscriptionCalc.net,
                draft.subscription.currency
              )}.`
            : isPublic
            ? "Para activar suscripción mensual tu comunidad debe ser privada u oculta."
            : null
        }
      />

      <ServiceEditorBlock
        title="Saludos"
        description="Activa o desactiva la compra de saludos desde esta comunidad."
        draft={draft.saludo}
        saving={saving}
        onChange={(updater) => updateBlock("saludo", updater)}
        netText={
          saludoCalc
            ? `Por un saludo de ${formatMoney(
                saludoCalc.gross,
                draft.saludo.currency
              )}, tú cobras ${formatMoney(
                saludoCalc.net,
                draft.saludo.currency
              )}.`
            : null
        }
      />

      <ServiceEditorBlock
        title="Consejos"
        description="Permite vender consejos personalizados desde esta comunidad."
        draft={draft.consejo}
        saving={saving}
        onChange={(updater) => updateBlock("consejo", updater)}
        netText={
          consejoCalc
            ? `Por un consejo de ${formatMoney(
                consejoCalc.gross,
                draft.consejo.currency
              )}, tú cobras ${formatMoney(
                consejoCalc.net,
                draft.consejo.currency
              )}.`
            : null
        }
      />

      <ServiceEditorBlock
        title="Meet & Greet digital"
        description="Servicio visible del menú. El creador define duración y precio."
        draft={draft.meetGreet}
        saving={saving}
        onChange={(updater) =>
          updateBlock(
            "meetGreet",
            updater as
              | Partial<ServiceDraft["meetGreet"]>
              | ((
                  prev: ServiceDraft["meetGreet"]
                ) => ServiceDraft["meetGreet"])
          )
        }
        showDuration
        durationLabel="Duración en minutos"
        netText={
          meetGreetCalc
            ? `Por un meet & greet de ${formatMoney(
                meetGreetCalc.gross,
                draft.meetGreet.currency
              )}, tú cobras ${formatMoney(
                meetGreetCalc.net,
                draft.meetGreet.currency
              )}.`
            : null
        }
      />

      <ServiceEditorBlock
        title="Clase personalizada"
        description="Se prepara como servicio visible del catálogo aunque su ejecución se apoye después en live/evento."
        draft={draft.customClass}
        saving={saving}
        onChange={(updater) =>
          updateBlock(
            "customClass",
            updater as
              | Partial<ServiceDraft["customClass"]>
              | ((
                  prev: ServiceDraft["customClass"]
                ) => ServiceDraft["customClass"])
          )
        }
        showDuration
        durationLabel="Duración en minutos"
        netText={
          customClassCalc
            ? `Por una clase de ${formatMoney(
                customClassCalc.gross,
                draft.customClass.currency
              )}, tú cobras ${formatMoney(
                customClassCalc.net,
                draft.customClass.currency
              )}.`
            : null
        }
      />

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