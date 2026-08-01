"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import ServiceInfoIcon from "@/components/services/ServiceInfoIcon";
import ServicePreviewReveal from "@/components/services/ServicePreviewReveal";
import ServicePublishedSuccess from "@/components/services/ServicePublishedSuccess";

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
  activeColor?: string;
};

type OverlayModalProps = {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  confirmDisabled?: boolean;
  hideFooter?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

type Props = {
  draft: ServiceDraft;
  saving: boolean;

  customClassEmoji: string;
  /** Color de acento del servicio; activa el ícono info y oculta el emoji cuando está inactivo (solo perfil). */
  accentColor?: string;

  /** Muestra una descripción del servicio bajo el título (solo perfil). */
  showDescription?: boolean;
  /** Estilo para la descripción (solo perfil). */
  descriptionStyle?: React.CSSProperties;

  /** Rango de duración permitido (minutos). Default 5–90. */
  durationMin?: number;
  durationMax?: number;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;

  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
  formatMoney: (value: number, currency: Currency) => string;

  SwitchComponent: React.ComponentType<SwitchProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;

  /** Si se provee, al publicar con éxito muestra la vista de éxito (no cierra). */
  publishSuccess?: { shareUrl: string; entityKind: "profile" | "community" };

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<boolean | void>;
};

type OverlayMode = null | "activate" | "edit";

export default function CustomClass({
  draft,
  saving,
  customClassEmoji,
  accentColor,
  showDescription = false,
  descriptionStyle,
  durationMin = 5,
  durationMax = 90,
  panelStyle,
  titleStyle,
  subtleStyle,
  inputStyle,
  buttonSecondaryStyle,
  calcNetAmount,
  formatMoney,
  SwitchComponent,
  OverlayModalComponent,
  publishSuccess,
  onSaveDraft,
}: Props) {
  const tServices = useTranslations("services");
  const tCommon = useTranslations("common");
  const { resolveStoredPrice, toDisplayForInput, currency: displayCurrency, formatAnchor } =
    usePriceFormat();

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  const [published, setPublished] = useState(false);

  const customClassCalc = useMemo(() => {
    return draft.customClass.enabled ? calcNetAmount(draft.customClass.price) : null;
  }, [draft.customClass.enabled, draft.customClass.price, calcNetAmount]);

  // Neto que gana el creador con el precio que está escribiendo en el overlay
  // (precio bruto − 25% de comisión de Vibra).
  const overlayCustomClassCalc = useMemo(() => {
    return calcNetAmount(overlayDraft.customClass.price);
  }, [overlayDraft.customClass.price, calcNetAmount]);

  // Validación del rango de duración (minutos) mientras escribe.
  const durationRaw = overlayDraft.customClass.durationMinutes;
  const durationNum = Number(durationRaw);
  const durationHasValue = durationRaw.trim() !== "";
  const durationValid =
    durationHasValue &&
    Number.isInteger(durationNum) &&
    durationNum >= durationMin &&
    durationNum <= durationMax;
  const durationOutOfRange = durationHasValue && !durationValid;

  const isBusy = saving;

  function buildEnabledDraft(baseDraft: ServiceDraft) {
    // Mostrar el precio guardado en la moneda del creador para editarlo.
    const n = Number(baseDraft.customClass.price);
    const shown =
      baseDraft.customClass.price !== "" && Number.isFinite(n) && n > 0
        ? String(
            Math.round(
              toDisplayForInput(n, baseDraft.customClass.currency ?? "MXN") * 100
            ) / 100
          )
        : baseDraft.customClass.price;
    return {
      ...baseDraft,
      customClass: {
        ...baseDraft.customClass,
        enabled: true,
        price: shown,
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
      },
    };
  }

  function openOverlay(mode: OverlayMode, nextDraft?: ServiceDraft) {
    setPublished(false);
    setOverlayMode(mode);
    setOverlayDraft(nextDraft ?? draft);
  }

  function closeOverlay() {
    if (isBusy) return;
    setPublished(false);
    setOverlayMode(null);
    setOverlayDraft(draft);
  }

  async function confirmOverlaySave() {
    // El creador tecleó en su moneda; guardamos en MXN (ancla).
    const n = Number(overlayDraft.customClass.price);
    let customClassToSave = {
      ...overlayDraft.customClass,
      visible: overlayDraft.customClass.enabled,
      visibility: "members" as const,
    };
    if (overlayDraft.customClass.price !== "" && Number.isFinite(n) && n > 0) {
      const { price, currency } = resolveStoredPrice(n);
      customClassToSave = { ...customClassToSave, price: String(price), currency };
    }
    const ok = await onSaveDraft({
      ...overlayDraft,
      customClass: customClassToSave,
    });
    if (ok && publishSuccess?.shareUrl) {
      setPublished(true);
    } else {
      setOverlayMode(null);
    }
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

  function renderSummary() {
    if (!draft.customClass.enabled) return null;

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
          <div style={subtleStyle}>{tServices("meetGreetConfiguredPrice")}</div>
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
          <div style={subtleStyle}>{tServices("meetGreetConfiguredDuration")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.customClass.durationMinutes
              ? `${draft.customClass.durationMinutes} min`
              : tServices("meetGreetNoDuration")}
          </div>
        </div>

        {customClassCalc ? (
          <div style={subtleStyle}>
            {tServices("customClassEarningsDesc", {
              gross: formatMoney(customClassCalc.gross, draft.customClass.currency),
              net: formatMoney(customClassCalc.net, draft.customClass.currency),
            })}
          </div>
        ) : null}

        <div style={subtleStyle}>
          {tServices("meetGreetMembersVisibility")}
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
          {tServices("modify")}
        </button>
      </div>
    );
  }

  return (
    <>
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
              {!accentColor ? `${customClassEmoji} ` : ""}
              {tServices("exclusiveSessionTitle")}
            </span>
            {showDescription && (
              <span
                style={
                  accentColor && !draft.customClass.enabled
                    ? { ...(descriptionStyle ?? subtleStyle), display: "flex", alignItems: "flex-start", gap: 6 }
                    : (descriptionStyle ?? subtleStyle)
                }
              >
                {accentColor && !draft.customClass.enabled ? <ServiceInfoIcon color={accentColor} /> : null}
                <span>{tServices("expSessionDesc")}</span>
              </span>
            )}
          </div>

          <SwitchComponent
            checked={draft.customClass.enabled}
            activeColor={accentColor}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label={tServices("customClassActivateLabel")}
          />
        </div>

        {accentColor && !draft.customClass.enabled ? (
          <ServicePreviewReveal service="customClass" accentColor={accentColor} />
        ) : null}

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={tServices("customClassConfigTitle")}
        loading={saving}
        confirmDisabled={
          !(Number(overlayDraft.customClass.price) > 0 && durationValid)
        }
        confirmLabel={tServices("publishExperience")}
        hideFooter={published}
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        {published && publishSuccess ? (
          <ServicePublishedSuccess
            shareUrl={publishSuccess.shareUrl}
            copyLabel={
              publishSuccess.entityKind === "community"
                ? tCommon("copyGroupLink")
                : tCommon("copyProfileLink")
            }
            copiedLabel={tCommon("linkCopied")}
            message={tServices("publishedSuccessMessage", {
              service: tServices("customClassNoun"),
              entity:
                publishSuccess.entityKind === "community"
                  ? tServices("entityCommunity")
                  : tServices("entityProfile"),
            })}
          />
        ) : (
        <>
        <div style={{ ...subtleStyle, marginBottom: 2 }}>
          {tServices("priceLegend")}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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
            placeholder={tServices("pricePlaceholder")}
            style={{ ...inputStyle, width: 130, flex: "1 1 180px" }}
          />

          <span
            style={{
              color: accentColor || "#f472b6",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {displayCurrency}
          </span>
        </div>
        {displayCurrency !== "USD" &&
        overlayDraft.customClass.price &&
        Number(overlayDraft.customClass.price) > 0 ? (
          <div style={subtleStyle}>
            = {formatAnchor(resolveStoredPrice(Number(overlayDraft.customClass.price)).price)}
          </div>
        ) : null}

        {overlayCustomClassCalc && overlayCustomClassCalc.net > 0 ? (
          <div style={subtleStyle}>
            {tServices.rich("customClassEarningsLegend", {
              // El input del overlay está en la moneda del creador; formatMoney
              // acepta cualquier moneda en runtime (el tipo local es estrecho).
              net: formatMoney(overlayCustomClassCalc.net, displayCurrency as Currency),
              amount: (chunks) => (
                <span style={{ color: accentColor || "#f472b6", fontWeight: 700 }}>
                  {chunks}
                </span>
              ),
            })}
          </div>
        ) : null}

        <div
          style={{
            ...subtleStyle,
            marginTop: 6,
            marginBottom: 2,
            color: durationOutOfRange ? "#ef4444" : subtleStyle.color,
          }}
        >
          {tServices("durationLegendRange", { min: durationMin, max: durationMax })}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            min={durationMin}
            max={durationMax}
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
            placeholder={tServices("durationPlaceholder")}
            style={{
              ...inputStyle,
              width: 160,
              flex: "1 1 180px",
              color: durationOutOfRange ? "#ef4444" : inputStyle.color,
              fontWeight: durationOutOfRange ? 700 : undefined,
            }}
          />
        </div>
        </>
        )}
      </OverlayModalComponent>
    </>
  );
}