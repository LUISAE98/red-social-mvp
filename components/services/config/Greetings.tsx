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

  saludoEmoji: string;
  /** Color de acento del servicio; activa el ícono info y oculta el emoji cuando está inactivo (solo perfil). */
  accentColor?: string;

  /** Muestra una descripción del servicio bajo el título (solo perfil). */
  showDescription?: boolean;
  /** Estilo para la descripción (solo perfil). */
  descriptionStyle?: React.CSSProperties;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  buttonSecondaryStyle: React.CSSProperties;

  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
  formatMoney: (value: number, currency: Currency) => string;

  SwitchComponent: React.ComponentType<SwitchProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;

  /**
   * Si se provee, al publicar con éxito el panel NO se cierra: muestra una
   * vista de éxito con el link para compartir (perfil o comunidad).
   */
  publishSuccess?: { shareUrl: string; entityKind: "profile" | "community" };

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<boolean | void>;

  /**
   * Abre el grabador de muestras. Sin esto el botón "+" no se pinta, así que
   * el panel sigue funcionando igual donde todavía no se haya conectado.
   */
  onAddSample?: () => void;
};

type OverlayMode = null | "activate" | "edit";

export default function Saludos({
  draft,
  saving,
  saludoEmoji,
  accentColor,
  showDescription = false,
  descriptionStyle,
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
  onAddSample,
}: Props) {
  const tServices = useTranslations("services");
  const tCommon = useTranslations("common");
  const { currency: displayCurrency } = usePriceFormat();

  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  // Vista de éxito tras publicar (panel abierto, sin formulario).
  const [published, setPublished] = useState(false);

  const saludoCalc = useMemo(() => {
    return draft.saludo.enabled ? calcNetAmount(draft.saludo.price) : null;
  }, [draft.saludo.enabled, draft.saludo.price, calcNetAmount]);

  // Neto que gana el creador con el precio que está escribiendo en el overlay
  // (precio bruto − 25% de comisión de Vibra).
  const overlaySaludoCalc = useMemo(() => {
    return calcNetAmount(overlayDraft.saludo.price);
  }, [overlayDraft.saludo.price, calcNetAmount]);

  // Precio mínimo permitido (MXN) para este servicio.
  const minPrice = SERVICE_MIN_PRICE_MXN.saludo;
  const priceBelowMin =
    overlayDraft.saludo.price.trim() !== "" &&
    Number(overlayDraft.saludo.price) < minPrice;

  const isBusy = saving;

  function buildEnabledDraft(baseDraft: ServiceDraft) {
    // El precio se guarda CRUDO en MXN; se muestra tal cual para editarlo.
    const shown = baseDraft.saludo.price;
    return {
      ...baseDraft,
      saludo: {
        ...baseDraft.saludo,
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
      saludo: {
        ...baseDraft.saludo,
        enabled: false,
        price: "",
        visible: false,
        visibility: "members" as const,
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
    const n = Number(overlayDraft.saludo.price);
    let saludoToSave = {
      ...overlayDraft.saludo,
      visible: overlayDraft.saludo.enabled,
      visibility: "members" as const,
    };
    if (overlayDraft.saludo.price !== "" && Number.isFinite(n) && n > 0) {
      saludoToSave = { ...saludoToSave, price: String(n), currency: "MXN" };
    }
    const ok = await onSaveDraft({
      ...overlayDraft,
      saludo: saludoToSave,
    });
    // Si el guardado fue exitoso y hay config para compartir, mostramos la
    // vista de éxito sin cerrar el panel; si no, cerramos como antes.
    if (ok && publishSuccess?.shareUrl) {
      setPublished(true);
    } else {
      setOverlayMode(null);
    }
  }

  async function handleToggle(next: boolean) {
    if (isBusy) return;

    if (!draft.saludo.enabled && next) {
      openOverlay("activate", buildEnabledDraft(draft));
      return;
    }

    if (draft.saludo.enabled && !next) {
      await onSaveDraft(buildDisabledDraft(draft));
    }
  }

  function handleModify() {
    if (isBusy) return;
    openOverlay("edit", buildEnabledDraft(draft));
  }

  function renderSummary() {
    if (!draft.saludo.enabled) return null;

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
              color: accentColor ?? "#b45cff",
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
          <div style={subtleStyle}>{tServices("meetGreetConfiguredPrice")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 31, fontWeight: 600, color: accentColor ?? "#b45cff", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {draft.saludo.price
                ? formatMoney(Number(draft.saludo.price), draft.saludo.currency)
                : `0 ${draft.saludo.currency}`}
            </span>
            <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>+ 3 MXN</span>
          </div>
          {saludoCalc ? (
            <div style={{ ...subtleStyle, textAlign: "end", whiteSpace: "nowrap", marginTop: 2 }}>
              {tServices("greetingEarningsDesc", {
                gross: formatMoney(saludoCalc.gross, draft.saludo.currency),
                net: formatMoney(saludoCalc.net, draft.saludo.currency),
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
              {!accentColor ? `${saludoEmoji} ` : ""}
              {tServices("greetingsTitle")}
            </span>
            {showDescription && (
              <span
                style={
                  accentColor && !draft.saludo.enabled
                    ? { ...(descriptionStyle ?? subtleStyle), display: "flex", alignItems: "flex-start", gap: 6 }
                    : (descriptionStyle ?? subtleStyle)
                }
              >
                {accentColor && !draft.saludo.enabled ? <ServiceInfoIcon color={accentColor} /> : null}
                <span>{tServices("expSaludoDesc")}</span>
              </span>
            )}
          </div>

          <SwitchComponent
            checked={draft.saludo.enabled}
            activeColor={accentColor}
            disabled={isBusy}
            onChange={(next) => {
              void handleToggle(next);
            }}
            label={tServices("greetingsActivateLabel")}
          />
        </div>

        {accentColor && !draft.saludo.enabled ? (
          <ServicePreviewReveal service="saludo" accentColor={accentColor} />
        ) : null}

        {/* Activado: los mismos items del preview, ahora fijos bajo la descripción. */}
        {accentColor && draft.saludo.enabled ? (
          <ServiceFeaturePreview service="saludo" accentColor={accentColor} />
        ) : null}

        {renderSummary()}
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={tServices("greetingsConfigTitle")}
        loading={saving}
        confirmDisabled={!(Number(overlayDraft.saludo.price) > 0) || priceBelowMin}
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
              service: tServices("greetingsNoun"),
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
            value={overlayDraft.saludo.price}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                saludo: {
                  ...prev.saludo,
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
              color: accentColor || "#b45cff",
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
            {`El precio mínimo es $${minPrice}`}
          </div>
        </div>
        <div
          style={{
            maxHeight: overlaySaludoCalc && overlaySaludoCalc.net > 0 ? 60 : 0,
            opacity: overlaySaludoCalc && overlaySaludoCalc.net > 0 ? 1 : 0,
            transform:
              overlaySaludoCalc && overlaySaludoCalc.net > 0
                ? "translateY(0)"
                : "translateY(4px)",
            overflow: "hidden",
            transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
          }}
        >
          <div style={{ ...subtleStyle, marginTop: 3 }}>
            {tServices.rich("greetingEarningsLegend", {
              // El input del overlay está en la moneda del creador; formatMoney
              // acepta cualquier moneda en runtime (el tipo local es estrecho).
              net: formatMoney(overlaySaludoCalc?.net ?? 0, displayCurrency as Currency),
              amount: (chunks) => (
                <span style={{ color: accentColor || "#b45cff", fontWeight: 700 }}>
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

        {/* Muestras: el creador graba ejemplos para que su vitrina no esté en
            cero y el comprador vea qué va a recibir. Solo aparece si quien monta
            este panel sabe qué hacer con el botón. */}
        {onAddSample ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
              marginTop: 18,
            }}
          >
            <button
              type="button"
              onClick={onAddSample}
              aria-label={tServices("addSampleAriaLabel")}
              title={tServices("addSampleAriaLabel")}
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                border: "none",
                background: "rgba(255,255,255,0.10)",
                color: "rgba(255,255,255,0.72)",
                fontSize: 28,
                fontWeight: 300,
                lineHeight: 1,
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                fontFamily: "inherit",
                WebkitTapHighlightColor: "transparent",
                transition: "background 160ms ease",
              }}
            >
              +
            </button>

            <span
              style={{
                ...subtleStyle,
                fontSize: 11.5,
                textAlign: "center",
                maxWidth: 260,
              }}
            >
              {tServices("addSampleHint")}
            </span>
          </div>
        ) : null}
        </>
        )}
      </OverlayModalComponent>
    </>
  );
}