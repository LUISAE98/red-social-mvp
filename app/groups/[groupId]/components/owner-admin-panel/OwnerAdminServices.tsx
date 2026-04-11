"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildNormalizedGroupCommerceState } from "@/lib/groups/groupServiceCatalog";
import {
  applyGroupSubscriptionTransition,
  removeLegacyFreeMembersAfterSubscriptionTransition,
} from "@/lib/groups/subscriptionTransitions";
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

type FreeToSubscriptionPolicy = "legacy_free" | "require_subscription" | "";
type SubscriptionToFreePolicy = "keep_members_free" | "remove_all_members" | "";
type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price"
  | "";

type MonetizationTransitionsInput =
  | {
      freeToSubscriptionPolicy?: "legacy_free" | "require_subscription" | null;
      subscriptionToFreePolicy?:
        | "keep_members_free"
        | "remove_all_members"
        | null;
      subscriptionPriceIncreasePolicy?:
        | "keep_legacy_price"
        | "require_resubscribe_new_price"
        | null;
      previousSubscriptionPriceMonthly?: number | null;
      nextSubscriptionPriceMonthly?: number | null;
      subscriptionPriceChangeCurrency?: Currency | null;
      lastMonetizationChangeAt?: unknown;
      lastMonetizationChangeBy?: string | null;
    }
  | null;

type MonetizationInput =
  | {
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
      subscriptionPriceMonthly?: number | null;
      subscriptionCurrency?: Currency | null;
      transitions?: MonetizationTransitionsInput;
    }
  | null;

type OfferingInput =
  | {
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
    }
  | null;

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

type EditableServiceVisibility = "public" | "members";

type ServiceBlockDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
  visible: boolean;
  visibility: EditableServiceVisibility;
};

type SubscriptionDraft = {
  enabled: boolean;
  price: string;
  currency: Currency;
};

type MeetGreetDraft = ServiceBlockDraft & {
  durationMinutes: string;
};

type CustomClassDraft = ServiceBlockDraft & {
  durationMinutes: string;
};

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

function pickSubscription(monetization: MonetizationInput) {
  const enabled =
    typeof monetization?.subscriptionsEnabled === "boolean"
      ? monetization.subscriptionsEnabled
      : monetization?.isPaid === true;

  const price =
    monetization?.subscriptionPriceMonthly ??
    monetization?.priceMonthly ??
    null;

  const currency =
    monetization?.subscriptionCurrency ??
    monetization?.currency ??
    "MXN";

  return {
    enabled,
    price,
    currency,
  };
}

function pickTransitions(monetization: MonetizationInput): {
  freeToSubscriptionPolicy: FreeToSubscriptionPolicy;
  subscriptionToFreePolicy: SubscriptionToFreePolicy;
  subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy;
} {
  const transitions = monetization?.transitions ?? null;

  const freeToSubscriptionPolicy: FreeToSubscriptionPolicy =
    transitions?.freeToSubscriptionPolicy === "legacy_free" ||
    transitions?.freeToSubscriptionPolicy === "require_subscription"
      ? transitions.freeToSubscriptionPolicy
      : "";

  const subscriptionToFreePolicy: SubscriptionToFreePolicy =
    transitions?.subscriptionToFreePolicy === "keep_members_free" ||
    transitions?.subscriptionToFreePolicy === "remove_all_members"
      ? transitions.subscriptionToFreePolicy
      : "";

  const subscriptionPriceIncreasePolicy: SubscriptionPriceIncreasePolicy =
    transitions?.subscriptionPriceIncreasePolicy === "keep_legacy_price" ||
    transitions?.subscriptionPriceIncreasePolicy ===
      "require_resubscribe_new_price"
      ? transitions.subscriptionPriceIncreasePolicy
      : "";

  return {
    freeToSubscriptionPolicy,
    subscriptionToFreePolicy,
    subscriptionPriceIncreasePolicy,
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
      found?.visibility === "members" || found?.visibility === "public"
        ? found.visibility
        : "public",
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
  fallback: EditableServiceVisibility
): EditableServiceVisibility {
  if (value === "members" || value === "public") return value;
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
  visibility: EditableServiceVisibility;
}): ServiceBlockDraft {
  return {
    enabled: input.enabled,
    price: input.price == null ? "" : String(input.price),
    currency: input.currency,
    visible: input.visible,
    visibility: input.visibility,
  };
}

function buildSubscriptionDraft(input: {
  enabled: boolean;
  price: number | null;
  currency: Currency;
}): SubscriptionDraft {
  return {
    enabled: input.enabled,
    price: input.price == null ? "" : String(input.price),
    currency: input.currency,
  };
}

function createEmptyDraft(): ServiceDraft {
  return {
    subscription: {
      enabled: false,
      price: "",
      currency: "MXN",
    },
    saludo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
    },
    consejo: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
    },
    meetGreet: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
      durationMinutes: "",
    },
    customClass: {
      enabled: false,
      price: "",
      currency: "MXN",
      visible: false,
      visibility: "public",
      durationMinutes: "",
    },
    donationMode: "none",
    donationCurrency: "MXN",
    donationMinimumAmount: "",
    donationGoalLabel: "",
    freeToSubscriptionPolicy: "",
    subscriptionToFreePolicy: "",
    subscriptionPriceIncreasePolicy: "",
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

function sameSubscriptionBlock(a: SubscriptionDraft, b: SubscriptionDraft) {
  return (
    a.enabled === b.enabled &&
    a.price === b.price &&
    a.currency === b.currency
  );
}

function sameDraft(a: ServiceDraft, b: ServiceDraft) {
  return (
    sameSubscriptionBlock(a.subscription, b.subscription) &&
    sameServiceBlock(a.saludo, b.saludo) &&
    sameServiceBlock(a.consejo, b.consejo) &&
    sameServiceBlock(a.meetGreet, b.meetGreet) &&
    a.meetGreet.durationMinutes === b.meetGreet.durationMinutes &&
    sameServiceBlock(a.customClass, b.customClass) &&
    a.customClass.durationMinutes === b.customClass.durationMinutes &&
    a.donationMode === b.donationMode &&
    a.donationCurrency === b.donationCurrency &&
    a.donationMinimumAmount === b.donationMinimumAmount &&
    a.donationGoalLabel === b.donationGoalLabel &&
    a.freeToSubscriptionPolicy === b.freeToSubscriptionPolicy &&
    a.subscriptionToFreePolicy === b.subscriptionToFreePolicy &&
    a.subscriptionPriceIncreasePolicy === b.subscriptionPriceIncreasePolicy
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
    requiresApproval: true,
    sourceScope: "group",
    meta,
    price: draft.enabled ? priceNum : null,
  };
}

function buildTransitionSuccessMessage(params: {
  direction:
    | "free_to_subscription"
    | "subscription_to_free"
    | "subscription_price_increase";
  policy:
    | "legacy_free"
    | "require_subscription"
    | "keep_members_free"
    | "remove_all_members"
    | "keep_legacy_price"
    | "require_resubscribe_new_price";
  alreadyApplied: boolean;
  updatedMembers: number;
  legacyGrantedMembers: number;
  legacyPricedMembers?: number;
  removedMembers: number;
  skippedMembers: number;
}) {
  const {
    direction,
    policy,
    alreadyApplied,
    updatedMembers,
    legacyGrantedMembers,
    legacyPricedMembers = 0,
    removedMembers,
    skippedMembers,
  } = params;

  if (alreadyApplied) {
    return "✅ Configuración guardada. Esta transición ya había sido aplicada anteriormente y no se duplicó.";
  }

  if (direction === "free_to_subscription" && policy === "legacy_free") {
    return `✅ Configuración guardada. Se mantuvo gratis a ${legacyGrantedMembers} integrante(s) existentes. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (direction === "free_to_subscription" && policy === "require_subscription") {
    return `✅ Configuración guardada. Se retiró el acceso a ${removedMembers} integrante(s) para que deban suscribirse de nuevo. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_to_free" &&
    policy === "keep_members_free"
  ) {
    return `✅ Configuración guardada. La comunidad volvió a gratis y ${updatedMembers} integrante(s) conservaron acceso normal. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_to_free" &&
    policy === "remove_all_members"
  ) {
    return `✅ Configuración guardada. La comunidad volvió a gratis y se retiró el acceso a ${removedMembers} integrante(s). Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_price_increase" &&
    policy === "keep_legacy_price"
  ) {
    return `✅ Configuración guardada. Se aumentó el precio para nuevas suscripciones y ${legacyPricedMembers} suscriptor(es) actuales conservaron su precio anterior. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  if (
    direction === "subscription_price_increase" &&
    policy === "require_resubscribe_new_price"
  ) {
    return `✅ Configuración guardada. Se retiró el acceso a ${removedMembers} suscriptor(es) actuales para que deban suscribirse de nuevo con el nuevo precio. Actualizados: ${updatedMembers}. Omitidos: ${skippedMembers}.`;
  }

  return "✅ Configuración guardada.";
}

function buildManualLegacyRemovalSuccessMessage(params: {
  removedMembers: number;
  reminderMembers: number;
  skippedMembers: number;
}) {
  const { removedMembers, reminderMembers, skippedMembers } = params;

  if (removedMembers <= 0) {
    return "✅ No había miembros gratuitos activos para retirar en este momento.";
  }

  return `✅ Se retiró a ${removedMembers} miembro(s) gratuito(s) y se generó el recordatorio correspondiente para ${reminderMembers} cuenta(s). Omitidos: ${skippedMembers}.`;
}

function ServiceEditorBlock<TDraft extends ServiceBlockDraft>({
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
  draft: TDraft;
  onChange: (
    updater: Partial<TDraft> | ((prev: TDraft) => TDraft)
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
    updater: Partial<TDraft> | ((prev: TDraft) => TDraft)
  ) => {
    onChange(updater);
  };

  const hasDurationField = "durationMinutes" in draft;
  const durationDraft = hasDurationField
    ? (draft as TDraft & { durationMinutes: string })
    : null;

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
              visible: next ? true : false,
              visibility: next ? prev.visibility : "public",
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
                  visibility: e.target.value as EditableServiceVisibility,
                  visible: true,
                }))
              }
              style={{ ...inputStyle, flex: 1, minWidth: 130 }}
            >
              <option value="public">Visible público</option>
              <option value="members">Visible solo miembros</option>
            </select>
          </div>

          {showDuration && durationDraft && (
            <input
              type="number"
              min="1"
              step="1"
              value={durationDraft.durationMinutes}
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
              Este servicio se mostrará en el menú del grupo según el acceso configurado.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SubscriptionEditorBlock({
  draft,
  saving,
  disabledByVisibility,
  onChange,
  netText,
}: {
  draft: SubscriptionDraft;
  saving: boolean;
  disabledByVisibility: boolean;
  onChange: (
    updater:
      | Partial<SubscriptionDraft>
      | ((prev: SubscriptionDraft) => SubscriptionDraft)
  ) => void;
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
      | Partial<SubscriptionDraft>
      | ((prev: SubscriptionDraft) => SubscriptionDraft)
  ) => {
    onChange(updater);
  };

  return (
    <div style={panelStyle}>
      <div style={rowBetweenStyle}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={titleStyle}>Suscripción mensual</span>
          <span style={subtleStyle}>
            Configura el acceso mensual del grupo. Esta suscripción no se muestra
            dentro del menú de servicios visibles.
          </span>
        </div>

        <Switch
          checked={draft.enabled}
          disabled={saving || disabledByVisibility}
          onChange={(next) =>
            applyChange((prev) => ({
              ...prev,
              enabled: next,
              price: next ? prev.price : "",
            }))
          }
          label="Activar suscripción mensual"
        />
      </div>

      {draft.enabled && !disabledByVisibility && (
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
              placeholder="Precio mensual"
              style={{ ...inputStyle, width: 140 }}
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
          </div>

          {netText ? (
            <div style={subtleStyle}>{netText}</div>
          ) : (
            <div style={subtleStyle}>
              Al activar suscripción, el CTA del grupo cambiará a “Suscribirme”
              en los flujos correspondientes.
            </div>
          )}
        </>
      )}

      {disabledByVisibility && (
        <div style={subtleStyle}>
          Para activar suscripción mensual, la comunidad debe ser privada u oculta.
        </div>
      )}
    </div>
  );
}

function TransitionPolicyPanel({
  mode,
  value,
  onChange,
  saving,
}: {
  mode:
    | "free_to_subscription"
    | "subscription_to_free"
    | "subscription_price_increase";
  value: string;
  onChange: (next: string) => void;
  saving: boolean;
}) {
  const panelStyle: React.CSSProperties = {
    padding: "10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    display: "grid",
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
          <span style={titleStyle}>
            Mantener a cada quien como ya estaba
          </span>
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

function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancelar",
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-services-confirm-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={loading ? undefined : onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "#111",
          boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <h3
            id="owner-services-confirm-title"
            style={{
              margin: 0,
              color: "#fff",
              fontSize: 18,
              lineHeight: 1.2,
              fontWeight: 800,
              fontFamily: fontStack,
            }}
          >
            {title}
          </h3>

          <div
            style={{
              color: "rgba(255,255,255,0.72)",
              fontSize: 13,
              lineHeight: 1.5,
              fontFamily: fontStack,
            }}
          >
            {description}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            style={{
              minWidth: 120,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700,
              fontSize: 13,
              fontFamily: fontStack,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            style={{
              minWidth: 190,
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.92)",
              background: "#fff",
              color: "#000",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 800,
              fontSize: 13,
              fontFamily: fontStack,
              opacity: loading ? 0.75 : 1,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {loading ? (
              <>
                <SpinningGear />
                Procesando...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
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

  const [draft, setDraft] = useState<ServiceDraft>(createEmptyDraft());
  const [savedDraft, setSavedDraft] = useState<ServiceDraft>(createEmptyDraft());

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [removingLegacyMembers, setRemovingLegacyMembers] = useState(false);
  const [showRemoveLegacyMembersModal, setShowRemoveLegacyMembersModal] =
      useState(false);
  const [activeLegacyFreeMembersCount, setActiveLegacyFreeMembersCount] =
      useState(0);

  const hasActiveLegacyFreeMembers = activeLegacyFreeMembersCount > 0;

  const canRemoveLegacyFreeMembersLater =
    !isPublic &&
    (currentMonetization?.subscriptionsEnabled === true ||
      currentMonetization?.isPaid === true) &&
    hasActiveLegacyFreeMembers;

  const lastHydratedGroupIdRef = useRef<string | null>(null);
  const skipHydrationWhileSavingRef = useRef(false);

  useEffect(() => {
    if (!isOwner) return;
    if (skipHydrationWhileSavingRef.current) return;

    const sub = pickSubscription(currentMonetization);
    const transitions = pickTransitions(currentMonetization);
    const saludo = pickOffering(currentOfferings, "saludo");
    const consejo = pickOffering(currentOfferings, "consejo");
    const meetGreet = pickOffering(currentOfferings, "meet_greet_digital");
    const customClass = pickOffering(currentOfferings, "clase_personalizada");
    const donation = pickDonation(currentDonation);

    const nextDraft: ServiceDraft = {
      subscription: buildSubscriptionDraft({
        enabled: isPublic ? false : sub.enabled,
        price: isPublic ? null : sub.price,
        currency: sub.currency ?? "MXN",
      }),
      saludo: buildServiceBlockDraft({
        enabled: saludo.enabled,
        price: saludo.price,
        currency: saludo.currency ?? "MXN",
        visible: saludo.visible,
        visibility: normalizeServiceVisibility(saludo.visibility, "public"),
      }),
      consejo: buildServiceBlockDraft({
        enabled: consejo.enabled,
        price: consejo.price,
        currency: consejo.currency ?? "MXN",
        visible: consejo.visible,
        visibility: normalizeServiceVisibility(consejo.visibility, "public"),
      }),
      meetGreet: {
        ...buildServiceBlockDraft({
          enabled: meetGreet.enabled,
          price: meetGreet.price,
          currency: meetGreet.currency ?? "MXN",
          visible: meetGreet.visible,
          visibility: normalizeServiceVisibility(meetGreet.visibility, "public"),
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
            "public"
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
      freeToSubscriptionPolicy: transitions.freeToSubscriptionPolicy,
      subscriptionToFreePolicy: transitions.subscriptionToFreePolicy,
      subscriptionPriceIncreasePolicy:
        transitions.subscriptionPriceIncreasePolicy,
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
    if (!isOwner) {
      setActiveLegacyFreeMembersCount(0);
      return;
    }

    const subscriptionIsPersistedActive =
      currentMonetization?.subscriptionsEnabled === true ||
      currentMonetization?.isPaid === true;

    if (isPublic || !subscriptionIsPersistedActive) {
      setActiveLegacyFreeMembersCount(0);
      return;
    }

    const membersRef = collection(db, "groups", groupId, "members");

    const unsubscribe = onSnapshot(
      membersRef,
      (snapshot) => {
        let count = 0;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as {
            status?: string;
            roleInGroup?: string;
            role?: string;
            accessType?: string | null;
            legacyComplimentary?: boolean;
            subscriptionActive?: boolean;
            requiresSubscription?: boolean;
          };

          const roleRaw =
  typeof data.roleInGroup === "string"
    ? data.roleInGroup
    : typeof data.role === "string"
    ? data.role
    : "";

const normalizedRole = roleRaw.trim().toLowerCase();

if (
  normalizedRole === "owner" ||
  normalizedRole === "mod" ||
  normalizedRole === "moderator"
) {
  return;
}

          const status =
            typeof data.status === "string"
              ? data.status.trim().toLowerCase()
              : "active";

          if (status !== "active") return;

          const accessType =
            typeof data.accessType === "string"
              ? data.accessType.trim().toLowerCase()
              : "";

          const isLegacyFree =
            accessType === "legacy_free" ||
            data.legacyComplimentary === true ||
            (
              accessType !== "subscription" &&
              data.subscriptionActive !== true &&
              data.requiresSubscription !== true
            );

          if (isLegacyFree) {
            count += 1;
          }
        });

        setActiveLegacyFreeMembersCount(count);
      },
      () => {
        setActiveLegacyFreeMembersCount(0);
      }
    );

    return () => unsubscribe();
  }, [
    groupId,
    isOwner,
    isPublic,
    currentMonetization?.subscriptionsEnabled,
    currentMonetization?.isPaid,
  ]);

    const wasSubscriptionEnabled = savedDraft.subscription.enabled;
  const willEnableSubscription =
    !wasSubscriptionEnabled && draft.subscription.enabled && !isPublic;
  const willDisableSubscription =
    wasSubscriptionEnabled && !draft.subscription.enabled;

  const previousSubscriptionPrice =
    savedDraft.subscription.price.trim() === ""
      ? null
      : Number(savedDraft.subscription.price);

  const nextSubscriptionPrice =
    draft.subscription.price.trim() === ""
      ? null
      : Number(draft.subscription.price);

  const willIncreaseSubscriptionPrice =
    !isPublic &&
    wasSubscriptionEnabled &&
    draft.subscription.enabled &&
    savedDraft.subscription.currency === draft.subscription.currency &&
    previousSubscriptionPrice != null &&
    nextSubscriptionPrice != null &&
    !Number.isNaN(previousSubscriptionPrice) &&
    !Number.isNaN(nextSubscriptionPrice) &&
    nextSubscriptionPrice > previousSubscriptionPrice;

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

  function updateBlock<
    K extends "subscription" | "saludo" | "consejo" | "meetGreet" | "customClass"
  >(
    key: K,
    updater:
      | Partial<ServiceDraft[K]>
      | ((prev: ServiceDraft[K]) => ServiceDraft[K])
  ) {
    setDraft((prev) => {
      const currentValue = prev[key];

      const nextValue =
        typeof updater === "function"
          ? (updater as (prev: ServiceDraft[K]) => ServiceDraft[K])(currentValue)
          : ({ ...currentValue, ...updater } as ServiceDraft[K]);

      return {
        ...prev,
        [key]: nextValue,
      };
    });
  }
  function openRemoveLegacyMembersModal() {
  if (!canRemoveLegacyFreeMembersLater || saving || removingLegacyMembers) return;
  setShowRemoveLegacyMembersModal(true);
}

async function handleConfirmRemoveLegacyFreeMembersLater() {
  if (!canRemoveLegacyFreeMembersLater) return;

  setRemovingLegacyMembers(true);
  setMsg(null);
  setErr(null);

  try {
    const response =
      await removeLegacyFreeMembersAfterSubscriptionTransition({
        groupId,
      });

    setShowRemoveLegacyMembersModal(false);
    setMsg(
      buildManualLegacyRemovalSuccessMessage({
        removedMembers: response.removedMembers,
        reminderMembers: response.reminderMembers,
        skippedMembers: response.skippedMembers,
      })
    );
  } catch (e: any) {
    setErr(
      e?.message ??
        "❌ No se pudo retirar a los miembros gratuitos."
    );
  } finally {
    setRemovingLegacyMembers(false);
  }
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
        setErr(
          "❌ Debes definir una duración válida en minutos para meet & greet."
        );
        return;
      }

      if (
        draft.customClass.enabled &&
        (customClassDurationNum == null ||
          Number.isNaN(customClassDurationNum) ||
          customClassDurationNum <= 0 ||
          !Number.isInteger(customClassDurationNum))
      ) {
        setErr(
          "❌ Debes definir una duración válida en minutos para la clase personalizada."
        );
        return;
      }

      if (isPublic && draft.subscription.enabled) {
        setErr(
          "❌ Las comunidades públicas no pueden activar suscripción mensual."
        );
        return;
      }

      if (willEnableSubscription && !draft.freeToSubscriptionPolicy) {
        setErr(
          "❌ Debes definir qué pasa con los miembros actuales al cambiar de gratis a suscripción."
        );
        return;
      }

            if (willDisableSubscription && !draft.subscriptionToFreePolicy) {
        setErr(
          "❌ Debes definir qué pasa con los integrantes al cambiar de suscripción a gratis."
        );
        return;
      }

      if (
        willIncreaseSubscriptionPrice &&
        !draft.subscriptionPriceIncreasePolicy
      ) {
        setErr(
          "❌ Debes definir qué pasa con los suscriptores actuales al subir el precio."
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

      if (draft.donationMode === "wedding" && !draft.donationGoalLabel.trim()) {
        setErr("❌ Debes escribir el texto visible para la donación de boda.");
        return;
      }

      const nextOfferings: GroupOffering[] = [
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

      const isTransitioningSubscriptionModel =
        willEnableSubscription ||
        willDisableSubscription ||
        willIncreaseSubscriptionPrice;

            const nextTransitions = {
        freeToSubscriptionPolicy:
          willEnableSubscription && draft.freeToSubscriptionPolicy
            ? draft.freeToSubscriptionPolicy
            : currentMonetization?.transitions?.freeToSubscriptionPolicy ?? null,
        subscriptionToFreePolicy:
          willDisableSubscription && draft.subscriptionToFreePolicy
            ? draft.subscriptionToFreePolicy
            : currentMonetization?.transitions?.subscriptionToFreePolicy ?? null,
        subscriptionPriceIncreasePolicy:
          willIncreaseSubscriptionPrice && draft.subscriptionPriceIncreasePolicy
            ? draft.subscriptionPriceIncreasePolicy
            : currentMonetization?.transitions?.subscriptionPriceIncreasePolicy ??
              null,
        previousSubscriptionPriceMonthly: willIncreaseSubscriptionPrice
          ? previousSubscriptionPrice
          : currentMonetization?.transitions?.previousSubscriptionPriceMonthly ??
            null,
        nextSubscriptionPriceMonthly: willIncreaseSubscriptionPrice
          ? nextSubscriptionPrice
          : currentMonetization?.transitions?.nextSubscriptionPriceMonthly ??
            null,
        subscriptionPriceChangeCurrency: willIncreaseSubscriptionPrice
          ? draft.subscription.currency
          : currentMonetization?.transitions?.subscriptionPriceChangeCurrency ??
            null,
        lastMonetizationChangeAt: isTransitioningSubscriptionModel
          ? Date.now()
          : currentMonetization?.transitions?.lastMonetizationChangeAt ?? null,
        lastMonetizationChangeBy: isTransitioningSubscriptionModel
          ? currentUserId
          : currentMonetization?.transitions?.lastMonetizationChangeBy ?? null,
      };

      const nextMonetization = {
        isPaid: isPublic ? false : draft.subscription.enabled,
        priceMonthly:
          isPublic || !draft.subscription.enabled ? null : subscriptionPriceNum,
        currency:
          isPublic || !draft.subscription.enabled
            ? null
            : draft.subscription.currency,

        subscriptionsEnabled: isPublic ? false : draft.subscription.enabled,
        subscriptionPriceMonthly:
          isPublic || !draft.subscription.enabled ? null : subscriptionPriceNum,
        subscriptionCurrency:
          isPublic || !draft.subscription.enabled
            ? null
            : draft.subscription.currency,

        paidPostsEnabled: preservedPaidPostsEnabled,
        paidLivesEnabled: preservedPaidLivesEnabled,
        paidVodEnabled: preservedPaidVodEnabled,
        paidLiveCommentsEnabled: preservedPaidLiveCommentsEnabled,

        greetingsEnabled: draft.saludo.enabled,
        adviceEnabled: draft.consejo.enabled,
        customClassEnabled: draft.customClass.enabled,
        digitalMeetGreetEnabled: draft.meetGreet.enabled,

        transitions: nextTransitions,
      };

      const commerce = buildNormalizedGroupCommerceState({
        offerings: nextOfferings,
        monetization: nextMonetization,
        donation: nextDonation,
        legacyGreetingsEnabled: draft.saludo.enabled,
        currency:
          (!isPublic && draft.subscription.enabled
            ? draft.subscription.currency
            : draft.saludo.currency) ?? "MXN",
      });

      skipHydrationWhileSavingRef.current = true;

      await updateDoc(doc(db, "groups", groupId), {
        monetization: {
          ...commerce.monetization,
          transitions: nextTransitions,
        },
        offerings: commerce.offerings,
        donation: commerce.donation,
        greetingsEnabled: commerce.monetization.greetingsEnabled,
      });

      let successMessage =
        "✅ Configuración de suscripción, transición, catálogo y donación guardados.";

      if (isTransitioningSubscriptionModel) {
        try {
                    const transitionResponse = await applyGroupSubscriptionTransition({
            groupId,
            nextSubscriptionEnabled: !isPublic && draft.subscription.enabled,
            freeToSubscriptionPolicy:
              willEnableSubscription && draft.freeToSubscriptionPolicy
                ? draft.freeToSubscriptionPolicy
                : undefined,
            subscriptionToFreePolicy:
              willDisableSubscription && draft.subscriptionToFreePolicy
                ? draft.subscriptionToFreePolicy
                : undefined,
            subscriptionPriceIncreasePolicy:
              willIncreaseSubscriptionPrice &&
              draft.subscriptionPriceIncreasePolicy
                ? draft.subscriptionPriceIncreasePolicy
                : undefined,
            previousSubscriptionPriceMonthly:
              willIncreaseSubscriptionPrice ? previousSubscriptionPrice : undefined,
            nextSubscriptionPriceMonthly:
              willIncreaseSubscriptionPrice ? nextSubscriptionPrice : undefined,
            subscriptionPriceChangeCurrency:
              willIncreaseSubscriptionPrice
                ? draft.subscription.currency
                : undefined,
          });

          successMessage = buildTransitionSuccessMessage(transitionResponse);
        } catch (transitionError: any) {
          const transitionMessage =
            transitionError?.message ??
            "La transición de miembros no pudo completarse.";

          const nextSavedAfterPartialSuccess: ServiceDraft = {
            subscription: {
              enabled: isPublic ? false : draft.subscription.enabled,
              price:
                isPublic || !draft.subscription.enabled
                  ? ""
                  : draft.subscription.price,
              currency:
                isPublic || !draft.subscription.enabled
                  ? "MXN"
                  : draft.subscription.currency,
            },
            saludo: {
              ...draft.saludo,
              price: draft.saludo.enabled ? draft.saludo.price : "",
              visible: draft.saludo.enabled ? draft.saludo.visible : false,
              visibility: draft.saludo.enabled
                ? draft.saludo.visibility
                : "public",
            },
            consejo: {
              ...draft.consejo,
              price: draft.consejo.enabled ? draft.consejo.price : "",
              visible: draft.consejo.enabled ? draft.consejo.visible : false,
              visibility: draft.consejo.enabled
                ? draft.consejo.visibility
                : "public",
            },
            meetGreet: {
              ...draft.meetGreet,
              price: draft.meetGreet.enabled ? draft.meetGreet.price : "",
              visible: draft.meetGreet.enabled ? draft.meetGreet.visible : false,
              visibility: draft.meetGreet.enabled
                ? draft.meetGreet.visibility
                : "public",
              durationMinutes: draft.meetGreet.enabled
                ? draft.meetGreet.durationMinutes
                : "",
            },
            customClass: {
              ...draft.customClass,
              price: draft.customClass.enabled ? draft.customClass.price : "",
              visible: draft.customClass.enabled
                ? draft.customClass.visible
                : false,
              visibility: draft.customClass.enabled
                ? draft.customClass.visibility
                : "public",
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
            freeToSubscriptionPolicy: draft.freeToSubscriptionPolicy,
            subscriptionToFreePolicy: draft.subscriptionToFreePolicy,
            subscriptionPriceIncreasePolicy:
              draft.subscriptionPriceIncreasePolicy,
          };

          setDraft(nextSavedAfterPartialSuccess);
          setSavedDraft(nextSavedAfterPartialSuccess);
          setErr(
            `⚠️ La configuración del grupo sí se guardó, pero la transición de miembros no terminó correctamente: ${transitionMessage}`
          );
          return;
        }
      }

      const nextSaved: ServiceDraft = {
        subscription: {
          enabled: isPublic ? false : draft.subscription.enabled,
          price:
            isPublic || !draft.subscription.enabled
              ? ""
              : draft.subscription.price,
          currency:
            isPublic || !draft.subscription.enabled
              ? "MXN"
              : draft.subscription.currency,
        },
        saludo: {
          ...draft.saludo,
          price: draft.saludo.enabled ? draft.saludo.price : "",
          visible: draft.saludo.enabled ? draft.saludo.visible : false,
          visibility: draft.saludo.enabled ? draft.saludo.visibility : "public",
        },
        consejo: {
          ...draft.consejo,
          price: draft.consejo.enabled ? draft.consejo.price : "",
          visible: draft.consejo.enabled ? draft.consejo.visible : false,
          visibility: draft.consejo.enabled ? draft.consejo.visibility : "public",
        },
        meetGreet: {
          ...draft.meetGreet,
          price: draft.meetGreet.enabled ? draft.meetGreet.price : "",
          visible: draft.meetGreet.enabled ? draft.meetGreet.visible : false,
          visibility: draft.meetGreet.enabled
            ? draft.meetGreet.visibility
            : "public",
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
            : "public",
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
        freeToSubscriptionPolicy: draft.freeToSubscriptionPolicy,
        subscriptionToFreePolicy: draft.subscriptionToFreePolicy,
        subscriptionPriceIncreasePolicy:
          draft.subscriptionPriceIncreasePolicy,
      };

      setDraft(nextSaved);
      setSavedDraft(nextSaved);
      setMsg(successMessage);
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
          <span style={titleStyle}>Configuración comercial del grupo</span>
          <span style={subtleStyle}>
            La suscripción mensual se configura como una capa estructural del
            grupo. Si el precio sube, el sistema pedirá una política para los
            suscriptores actuales. El menú visible solo incluye servicios
            activos como saludo, consejo, meet & greet digital y clase
            personalizada. Donación sigue separada porque no pertenece al menú principal.
          </span>
        </div>
      </div>

            <div style={{ display: "grid", gap: 10 }}>
        <SubscriptionEditorBlock
          draft={draft.subscription}
          saving={saving || removingLegacyMembers}
          disabledByVisibility={isPublic}
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

                        {canRemoveLegacyFreeMembersLater && (
  <div style={panelStyle}>
    <div style={{ display: "grid", gap: 2 }}>
      <span style={titleStyle}>
        Retirar miembros gratuitos
      </span>
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
      onClick={openRemoveLegacyMembersModal}
      disabled={saving || removingLegacyMembers}
      style={{
        ...buttonSecondaryStyle,
        opacity: saving || removingLegacyMembers ? 0.7 : 1,
        cursor:
          saving || removingLegacyMembers ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {removingLegacyMembers ? (
        <>
          <SpinningGear />
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

      {willEnableSubscription && (
        <TransitionPolicyPanel
          mode="free_to_subscription"
          value={draft.freeToSubscriptionPolicy}
          onChange={(next) =>
            setDraft((prev) => ({
              ...prev,
              freeToSubscriptionPolicy: next as FreeToSubscriptionPolicy,
            }))
          }
          saving={saving}
        />
      )}

            {willDisableSubscription && (
        <TransitionPolicyPanel
          mode="subscription_to_free"
          value={draft.subscriptionToFreePolicy}
          onChange={(next) =>
            setDraft((prev) => ({
              ...prev,
              subscriptionToFreePolicy: next as SubscriptionToFreePolicy,
            }))
          }
          saving={saving}
        />
      )}

      {willIncreaseSubscriptionPrice && (
        <TransitionPolicyPanel
          mode="subscription_price_increase"
          value={draft.subscriptionPriceIncreasePolicy}
          onChange={(next) =>
            setDraft((prev) => ({
              ...prev,
              subscriptionPriceIncreasePolicy:
                next as SubscriptionPriceIncreasePolicy,
            }))
          }
          saving={saving}
        />
      )}

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
        onChange={(updater) => updateBlock("meetGreet", updater)}
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
        onChange={(updater) => updateBlock("customClass", updater)}
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

      <ConfirmModal
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
        onConfirm={handleConfirmRemoveLegacyFreeMembersLater}
      />

      <button
        type="button"
        onClick={saveServices}
        disabled={saving || removingLegacyMembers}
        style={{
          ...buttonSecondaryStyle,
          opacity: saving || removingLegacyMembers ? 0.7 : 1,
          cursor: 
          saving || removingLegacyMembers ? "not-allowed" : "pointer",
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