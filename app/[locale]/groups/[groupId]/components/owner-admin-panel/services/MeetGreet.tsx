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

  meetGreetEmoji: string;
  /** Color de acento del servicio; activa el ícono info y oculta el emoji cuando está inactivo (solo perfil). */
  accentColor?: string;

  /** Muestra una descripción del servicio bajo el título (solo perfil). */
  showDescription?: boolean;
  /** Estilo para la descripción (solo perfil). */
  descriptionStyle?: React.CSSProperties;

  /** Título alternativo para el servicio (solo perfil). */
  titleOverride?: string;

  /** Rango de duración permitido (minutos). Default 5–25. */
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

export default function MeetGreet({
  draft,
  saving,
  meetGreetEmoji,
  accentColor,
  showDescription = false,
  descriptionStyle,
  titleOverride,
  durationMin = 5,
  durationMax = 25,
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

  const meetGreetCalc = useMemo(() => {
    return draft.meetGreet.enabled ? calcNetAmount(draft.meetGreet.price) : null;
  }, [draft.meetGreet.enabled, draft.meetGreet.price, calcNetAmount]);

  // Neto que gana el creador con el precio que está escribiendo en el overlay
  // (precio bruto − 23% de comisión de Vibra).
  const overlayMeetGreetCalc = useMemo(() => {
    return calcNetAmount(overlayDraft.meetGreet.price);
  }, [overlayDraft.meetGreet.price, calcNetAmount]);

  // Validación del rango de duración (minutos) mientras escribe.
  const durationRaw = overlayDraft.meetGreet.durationMinutes;
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
    const n = Number(baseDraft.meetGreet.price);
    const shown =
      baseDraft.meetGreet.price !== "" && Number.isFinite(n) && n > 0
        ? String(
            Math.round(
              toDisplayForInput(n, baseDraft.meetGreet.currency ?? "MXN") * 100
            ) / 100
          )
        : baseDraft.meetGreet.price;
    return {
      ...baseDraft,
      meetGreet: {
        ...baseDraft.meetGreet,
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
    const n = Number(overlayDraft.meetGreet.price);
    let meetGreetToSave = {
      ...overlayDraft.meetGreet,
      visible: overlayDraft.meetGreet.enabled,
      visibility: "members" as const,
    };
    if (overlayDraft.meetGreet.price !== "" && Number.isFinite(n) && n > 0) {
      const { price, currency } = resolveStoredPrice(n);
      meetGreetToSave = { ...meetGreetToSave, price: String(price), currency };
    }
    const ok = await onSaveDraft({
      ...overlayDraft,
      meetGreet: meetGreetToSave,
    });
    if (ok && publishSuccess?.shareUrl) {
      setPublished(true);
    } else {
      setOverlayMode(null);
    }
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
          <div style={subtleStyle}>{tServices("meetGreetConfiguredPrice")}</div>
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
          <div style={subtleStyle}>{tServices("meetGreetConfiguredDuration")}</div>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>
            {draft.meetGreet.durationMinutes
              ? `${draft.meetGreet.durationMinutes} min`
              : tServices("meetGreetNoDuration")}
          </div>
        </div>

        {meetGreetCalc ? (
          <div style={subtleStyle}>
            {tServices("meetGreetEarningsDesc", {
              gross: formatMoney(meetGreetCalc.gross, draft.meetGreet.currency),
              net: formatMoney(meetGreetCalc.net, draft.meetGreet.currency),
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
              {!accentColor ? `${meetGreetEmoji} ` : ""}
              {titleOverride ?? tServices("liveSessionTitle")}
            </span>
            {showDescription && (
              <span
                style={
                  accentColor && !draft.meetGreet.enabled
                    ? { ...(descriptionStyle ?? subtleStyle), display: "flex", alignItems: "flex-start", gap: 6 }
                    : (descriptionStyle ?? subtleStyle)
                }
              >
                {accentColor && !draft.meetGreet.enabled ? <ServiceInfoIcon color={accentColor} /> : null}
                <span>{tServices("expMeetGreetDesc")}</span>
              </span>
            )}
          </div>

          <SwitchComponent
            checked={draft.meetGreet.enabled}
            activeColor={accentColor}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label={tServices("meetGreetActivateLabel")}
          />
        </div>

        {accentColor && !draft.meetGreet.enabled ? (
          <ServicePreviewReveal service="meetGreet" accentColor={accentColor} />
        ) : null}

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={tServices("meetGreetConfigTitle")}
        loading={saving}
        confirmDisabled={
          !(Number(overlayDraft.meetGreet.price) > 0 && durationValid)
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
              service: tServices("meetGreetNoun"),
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
            placeholder={tServices("pricePlaceholder")}
            style={{ ...inputStyle, width: 130, flex: "1 1 180px" }}
          />

          <span
            style={{
              color: accentColor || "#2563eb",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {displayCurrency}
          </span>
        </div>
        {displayCurrency !== "MXN" &&
        overlayDraft.meetGreet.price &&
        Number(overlayDraft.meetGreet.price) > 0 ? (
          <div style={subtleStyle}>
            = {formatAnchor(resolveStoredPrice(Number(overlayDraft.meetGreet.price)).price)}
          </div>
        ) : null}

        {overlayMeetGreetCalc && overlayMeetGreetCalc.net > 0 ? (
          <div style={subtleStyle}>
            {tServices.rich("meetGreetEarningsLegend", {
              // El input del overlay está en la moneda del creador; formatMoney
              // acepta cualquier moneda en runtime (el tipo local es estrecho).
              net: formatMoney(overlayMeetGreetCalc.net, displayCurrency as Currency),
              amount: (chunks) => (
                <span style={{ color: accentColor || "#2563eb", fontWeight: 700 }}>
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