"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { SERVICE_MIN_PRICE_MXN } from "@/lib/currency/catalog";
import ServiceInfoIcon from "@/components/services/ServiceInfoIcon";
import ServicePreviewReveal from "@/components/services/ServicePreviewReveal";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";
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
  donationSuggestedAmounts: string[];
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
  const { currency: displayCurrency } = usePriceFormat();

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

  // Precio mínimo permitido (MXN) para este servicio.
  const minPrice = SERVICE_MIN_PRICE_MXN.clase_personalizada;
  const priceBelowMin =
    overlayDraft.customClass.price.trim() !== "" &&
    Number(overlayDraft.customClass.price) < minPrice;

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
    // El precio se guarda CRUDO en MXN; se muestra tal cual para editarlo.
    const shown = baseDraft.customClass.price;
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
    // El creador teclea en MXN; se guarda CRUDO en MXN (sin round-trip USD).
    const n = Number(overlayDraft.customClass.price);
    let customClassToSave = {
      ...overlayDraft.customClass,
      visible: overlayDraft.customClass.enabled,
      visibility: "members" as const,
    };
    if (overlayDraft.customClass.price !== "" && Number.isFinite(n) && n > 0) {
      customClassToSave = { ...customClassToSave, price: String(n), currency: "MXN" };
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
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          // El precio va a 31px, con moneda y el "+ 3 MXN" al lado, y su bloque
          // tiene flexShrink: 0. En un teléfono angosto esa fila no cabe junto al
          // botón de la izquierda y se salía por la derecha. Con wrap, el precio
          // baja a su propia línea en vez de desbordar la tarjeta.
          flexWrap: "wrap",
        }}
      >
        {/* Izquierda: botón Modificar (texto plano, color del precio). */}
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <button
            type="button"
            onClick={handleModify}
            disabled={isBusy}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              justifySelf: "flex-start",
              color: accentColor ?? "#f472b6",
              fontSize: 14,
              fontWeight: 600,
              cursor: isBusy ? "not-allowed" : "pointer",
              opacity: isBusy ? 0.7 : 1,
            }}
          >
            {tServices("modify")}
          </button>
        </div>

        {/* Esquina inferior derecha: precio grande (estilo del feed, +40%) + 3 MXN. */}
        <div style={{ display: "grid", gap: 2, justifyItems: "end", textAlign: "end", flexShrink: 0 }}>
          <div style={subtleStyle}>Configuración de sesión exclusiva</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            {draft.customClass.durationMinutes ? (
              <>
                <span style={{ fontSize: 31, fontWeight: 600, color: "#fff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {`${draft.customClass.durationMinutes} min`}
                </span>
                <span aria-hidden="true" style={{ width: 1, height: 26, background: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
              </>
            ) : null}
            <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 31, fontWeight: 600, color: accentColor ?? "#f472b6", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {draft.customClass.price
                  ? formatMoney(
                      Number(draft.customClass.price),
                      draft.customClass.currency
                    )
                  : `0 ${draft.customClass.currency}`}
              </span>
              <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>+ 3 MXN</span>
            </span>
          </div>
          {customClassCalc ? (
            <div style={{ ...subtleStyle, textAlign: "end", whiteSpace: "nowrap", marginTop: 2 }}>
              {tServices("customClassEarningsDesc", {
                gross: formatMoney(customClassCalc.gross, draft.customClass.currency),
                net: formatMoney(customClassCalc.net, draft.customClass.currency),
              })}
            </div>
          ) : null}
        </div>
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

        {/* Activado: los mismos items del preview, ahora fijos bajo la descripción
            (con la duración ya configurada por el creador). */}
        {accentColor && draft.customClass.enabled ? (
          <ServiceFeaturePreview
            service="customClass"
            accentColor={accentColor}
            durationDescription={
              draft.customClass.durationMinutes
                ? `${draft.customClass.durationMinutes} min`
                : undefined
            }
          />
        ) : null}

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={tServices("customClassConfigTitle")}
        loading={saving}
        confirmDisabled={
          !(Number(overlayDraft.customClass.price) > 0 && durationValid) ||
          priceBelowMin
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

          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            + $3
          </span>

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
        <div>{/* una sola celda del grid: agrupa los textos bajo el input */}
        <div
          style={{
            maxHeight: priceBelowMin ? 30 : 0,
            opacity: priceBelowMin ? 1 : 0,
            transform: priceBelowMin ? "translateY(0)" : "translateY(4px)",
            overflow: "hidden",
            transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
          }}
        >
          <div style={{ color: "#f87171", fontSize: 12, marginTop: 2 }}>
            {tCommon("priceMin", { min: minPrice })}
          </div>
        </div>
        <div
          style={{
            maxHeight: overlayCustomClassCalc && overlayCustomClassCalc.net > 0 ? 60 : 0,
            opacity: overlayCustomClassCalc && overlayCustomClassCalc.net > 0 ? 1 : 0,
            transform:
              overlayCustomClassCalc && overlayCustomClassCalc.net > 0
                ? "translateY(0)"
                : "translateY(4px)",
            overflow: "hidden",
            transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
          }}
        >
          <div style={{ ...subtleStyle, marginTop: 3 }}>
            {tServices.rich("customClassEarningsLegend", {
              // El input del overlay está en la moneda del creador; formatMoney
              // acepta cualquier moneda en runtime (el tipo local es estrecho).
              net: formatMoney(overlayCustomClassCalc?.net ?? 0, displayCurrency as Currency),
              amount: (chunks) => (
                <span style={{ color: accentColor || "#f472b6", fontWeight: 700 }}>
                  {chunks}
                </span>
              ),
            })}
          </div>
        </div>
        <div style={{ ...subtleStyle, opacity: 0.7, fontSize: 11, marginTop: 3 }}>
          A todas las experiencias se les suman $3 MXN por el cargo de procesamiento de Stripe.
        </div>
        </div>

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