"use client";

import React, { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import ServiceInfoIcon from "@/components/services/ServiceInfoIcon";
import ServicePreviewReveal from "@/components/services/ServicePreviewReveal";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";
import { SUBSCRIPTION_MIN_PRICE_USD } from "@/lib/currency/catalog";

// Color de acento del servicio de suscripción: azul celeste. Tiñe todos sus iconos
// (info de la descripción, aviso de comunidad pública e items informativos).
const SUBSCRIPTION_ACCENT = "#38bdf8";

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
  onConfirm: () => void;
  onCancel: () => void;
};

type ConfirmModalProps = {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

type Props = {
  draft: ServiceDraft;
  savedDraft: ServiceDraft;
  isPublic: boolean;
  /** Cambia la comunidad a privada. Ausente = sin switch. */
  onChangeVisibility?: (next: "public" | "private") => Promise<void>;
  saving: boolean;
  removingLegacyMembers: boolean;
  activeLegacyFreeMembersCount: number;
  canRemoveLegacyFreeMembersLater: boolean;

  panelStyle: React.CSSProperties;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
  descriptionStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
  /** Ya no se usa: las acciones de esta card son texto plano en el color del
   *  servicio. Se conserva en el tipo porque el padre lo sigue pasando. */
  buttonSecondaryStyle?: React.CSSProperties;

  calcNetAmount: (raw: string) => { gross: number; net: number } | null;
  formatMoney: (value: number, currency: Currency) => string;

  SwitchComponent: React.ComponentType<SwitchProps>;
  OverlayModalComponent: React.ComponentType<OverlayModalProps>;
  ConfirmModalComponent: React.ComponentType<ConfirmModalProps>;
  SpinningGearComponent: React.ComponentType;

  onSaveDraft: (nextDraft: ServiceDraft) => Promise<void>;
  onRemoveLegacyMembers: () => Promise<void>;
};

type SubscriptionOverlayMode =
  | null
  | "activate"
  | "edit"
  | "deactivate"
  | "price_increase";

function TransitionPolicyPanel({
  mode,
  value,
  onChange,
  saving,
  titleStyle,
  subtleStyle,
}: {
  mode:
    | "free_to_subscription"
    | "subscription_to_free"
    | "subscription_price_increase";
  value: string;
  onChange: (next: string) => void;
  saving: boolean;
  titleStyle: React.CSSProperties;
  subtleStyle: React.CSSProperties;
}) {
  const tServices = useTranslations("services");

  // Contenedor transparente (sin borde ni relleno).
  const panelStyle: React.CSSProperties = { display: "grid", gap: 16 };

  // Encabezado de la decisión: qué está por pasar + la pregunta.
  const header = (title: string, desc: string) => (
    <div style={{ display: "grid", gap: 3 }}>
      <span style={{ ...titleStyle, color: "#fff", fontSize: 14 }}>{title}</span>
      <span style={subtleStyle}>{desc}</span>
    </div>
  );

  // Opción tipo "radio": fondo transparente, un aro que se llena al elegir. Sin cajas.
  const renderOption = (optionValue: string, title: string, desc: string) => {
    const active = value === optionValue;
    return (
      <button
        key={optionValue}
        type="button"
        disabled={saving}
        onClick={() => onChange(optionValue)}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 11,
          background: "transparent",
          border: "none",
          padding: 0,
          textAlign: "start",
          width: "100%",
          cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            flexShrink: 0,
            marginTop: 2,
            border: `2px solid ${active ? SUBSCRIPTION_ACCENT : "rgba(255,255,255,0.3)"}`,
            display: "grid",
            placeItems: "center",
            transition: "border-color 0.2s ease",
          }}
        >
          {active && (
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: SUBSCRIPTION_ACCENT }} />
          )}
        </span>
        <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
          <span style={{ ...titleStyle, color: active ? "#fff" : "rgba(255,255,255,0.92)" }}>{title}</span>
          <span style={subtleStyle}>{desc}</span>
        </span>
      </button>
    );
  };

  if (mode === "free_to_subscription") {
    return (
      <div style={panelStyle}>
        {header(
          tServices("freeToSubscriptionPolicyTitle"),
          tServices("freeToSubscriptionPolicyDescription")
        )}
        {renderOption(
          "legacy_free",
          tServices("freeToSubscriptionOptionLegacyFreeTitle"),
          tServices("freeToSubscriptionOptionLegacyFreeDesc")
        )}
        {renderOption(
          "require_subscription",
          tServices("freeToSubscriptionOptionRequireTitle"),
          tServices("freeToSubscriptionOptionRequireDesc")
        )}
      </div>
    );
  }

  if (mode === "subscription_price_increase") {
    return (
      <div style={panelStyle}>
        {header(
          tServices("priceIncreasePolicyTitle"),
          tServices("priceIncreasePolicyDescription")
        )}
        {renderOption(
          "keep_legacy_price",
          tServices("priceIncreaseOptionKeepLegacyTitle"),
          tServices("priceIncreaseOptionKeepLegacyDesc")
        )}
        {renderOption(
          "require_resubscribe_new_price",
          tServices("priceIncreaseOptionRequireResubscribeTitle"),
          tServices("priceIncreaseOptionRequireResubscribeDesc")
        )}
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {header(
        tServices("subscriptionToFreePolicyTitle"),
        tServices("subscriptionToFreePolicyDescription")
      )}
      {renderOption(
        "keep_members_free",
        tServices("subscriptionToFreeOptionKeepTitle"),
        tServices("subscriptionToFreeOptionKeepDesc")
      )}
      {renderOption(
        "remove_all_members",
        tServices("subscriptionToFreeOptionRemoveTitle"),
        tServices("subscriptionToFreeOptionRemoveDesc")
      )}
    </div>
  );
}

export default function Subscription({
  draft,
  savedDraft,
  isPublic,
  onChangeVisibility,
  saving,
  removingLegacyMembers,
  activeLegacyFreeMembersCount,
  canRemoveLegacyFreeMembersLater,
  panelStyle,
  titleStyle,
  subtleStyle,
  descriptionStyle,
  inputStyle,
  calcNetAmount,
  formatMoney,
  SwitchComponent,
  OverlayModalComponent,
  ConfirmModalComponent,
  SpinningGearComponent,
  onSaveDraft,
  onRemoveLegacyMembers,
}: Props) {
  const tServices = useTranslations("services");
  const tCommon = useTranslations("common");
  const { currency: displayCurrency } = usePriceFormat();
  const [overlayMode, setOverlayMode] = useState<SubscriptionOverlayMode>(null);
  const [overlayDraft, setOverlayDraft] = useState<ServiceDraft>(draft);
  const [showRemoveLegacyMembersModal, setShowRemoveLegacyMembersModal] =
    useState(false);
  const { toast: subToast, showToast: showSubToast } = useVibraToast();
  const [changingVisibility, setChangingVisibility] = useState(false);
  const [popping, setPopping] = useState(false);

 const disabledByVisibility = isPublic;

  // Switch para pasar la comunidad a privada. Solo cuando es pública y el padre
  // provee el callback. Al pasar a privada, isPublic → false y el switch desaparece;
  // para volver a pública se hace desde Configuración.
  const canMakePrivate = isPublic && typeof onChangeVisibility === "function";

  async function handleMakePrivate() {
    if (!onChangeVisibility || changingVisibility || saving || removingLegacyMembers) return;
    setPopping(true); // dispara la animación de salida (pop) del panel
    setChangingVisibility(true);
    try {
      await onChangeVisibility("private");
      // Ya privada: abrir el panel de configuración para poner el costo (flujo de
      // activación de la suscripción). isPublic se refleja solo por el snapshot.
      openOverlay("activate", {
        ...draft,
        subscription: { ...draft.subscription, enabled: true },
      });
    } catch {
      setPopping(false);
      showSubToast(tServices("communityPrivacyChangeError"), "error");
    } finally {
      setChangingVisibility(false);
    }
  }

  const subscriptionCalc = useMemo(() => {
    return draft.subscription.enabled ? calcNetAmount(draft.subscription.price) : null;
  }, [draft.subscription.enabled, draft.subscription.price, calcNetAmount]);

  // Neto que gana el creador con el precio que escribe en el overlay (bruto − 25%).
  const overlaySubscriptionCalc = useMemo(() => {
    return calcNetAmount(overlayDraft.subscription.price);
  }, [overlayDraft.subscription.price, calcNetAmount]);

  // Precio mínimo permitido (MXN) para la suscripción mensual.
  const minPrice = SUBSCRIPTION_MIN_PRICE_USD;
  const priceBelowMin =
    overlayDraft.subscription.price.trim() !== "" &&
    Number(overlayDraft.subscription.price) < minPrice;

  const isBusy = saving || removingLegacyMembers;

  const savedPrevSubscriptionPrice =
    savedDraft.subscription.price.trim() === ""
      ? null
      : Number(savedDraft.subscription.price);

  const overlayNextSubscriptionPrice =
    overlayDraft.subscription.price.trim() === ""
      ? null
      : Number(overlayDraft.subscription.price);

  const shouldShowFreeToSubscriptionPolicy =
    !savedDraft.subscription.enabled &&
    overlayDraft.subscription.enabled &&
    !isPublic;

  const shouldShowSubscriptionToFreePolicy =
    savedDraft.subscription.enabled && !overlayDraft.subscription.enabled;

  // APAGAR la suscripción no es "configurar un precio": no se pide monto, solo
  // decidir qué pasa con los integrantes actuales (se quedan gratis o salen).
  // Antes el overlay seguía exigiendo precio > 0 y, como al apagar el precio se
  // vacía, el botón de guardar quedaba deshabilitado para siempre.
  const isDeactivating = overlayMode === "deactivate";

  const shouldShowPriceIncreasePolicy =
    !isPublic &&
    savedDraft.subscription.enabled &&
    overlayDraft.subscription.enabled &&
    savedDraft.subscription.currency === overlayDraft.subscription.currency &&
    savedDraft.subscription.price.trim() !== "" &&
    overlayDraft.subscription.price.trim() !== "" &&
    savedPrevSubscriptionPrice != null &&
    overlayNextSubscriptionPrice != null &&
    !Number.isNaN(savedPrevSubscriptionPrice) &&
    !Number.isNaN(overlayNextSubscriptionPrice) &&
    overlayNextSubscriptionPrice > savedPrevSubscriptionPrice;

  function openOverlay(mode: SubscriptionOverlayMode, nextDraft?: ServiceDraft) {
    const src = nextDraft ?? draft;
    // El precio se guarda CRUDO en MXN; se muestra tal cual para editarlo.
    const shown = src.subscription.price;
    setOverlayMode(mode);
    setOverlayDraft({
      ...src,
      subscription: { ...src.subscription, price: shown },
    });
  }

  function closeOverlay() {
    if (isBusy) return;
    setOverlayMode(null);
    setOverlayDraft(draft);
  }

  async function confirmOverlaySave() {
    // El creador teclea en MXN; se guarda CRUDO en MXN (sin round-trip USD).
    const n = Number(overlayDraft.subscription.price);
    let toSave = overlayDraft;
    if (overlayDraft.subscription.price !== "" && Number.isFinite(n) && n > 0) {
      toSave = {
        ...overlayDraft,
        subscription: { ...overlayDraft.subscription, price: String(n), currency: "MXN" },
      };
    }
    await onSaveDraft(toSave);
    setOverlayMode(null);
  }

  function handleToggle(next: boolean) {
    if (isBusy) return;

    if (disabledByVisibility && next) {
      return;
    }

    const nextDraft: ServiceDraft = {
      ...draft,
      subscription: {
        ...draft.subscription,
        enabled: next,
        price: next ? draft.subscription.price : "",
      },
    };

    if (!draft.subscription.enabled && next) {
      openOverlay("activate", nextDraft);
      return;
    }

    if (draft.subscription.enabled && !next) {
      openOverlay("deactivate", nextDraft);
      return;
    }
  }

function handleModify() {
  if (isBusy || disabledByVisibility) return;
  openOverlay("edit", draft);
}

  // Miembros heredados gratuitos: vive DENTRO del card de suscripción, entre los
  // items informativos y el precio configurado. Solo existe mientras queden
  // miembros con acceso gratis heredado; al sacarlos, desaparece solo.
  // Formato compacto (una fila de título + conteo) para no romper el card.
  function renderLegacyMembers() {
    if (!canRemoveLegacyFreeMembersLater) return null;

    return (
      <div
        style={{
          display: "grid",
          gap: 5,
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span style={{ ...titleStyle, fontSize: 13 }}>
          {tServices("removeLegacyMembersTitle")}
        </span>

        <span style={{ ...subtleStyle, fontSize: 11.5 }}>
          {tServices("removeLegacyMembersDescription")}
        </span>

        {/* La acción es texto plano en el azul del servicio, igual que "Modificar",
            y lleva el conteo dentro para que se entienda a quién afecta. */}
        <button
          type="button"
          onClick={() => setShowRemoveLegacyMembersModal(true)}
          disabled={isBusy}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            marginTop: 2,
            justifySelf: "flex-start",
            textAlign: "start",
            color: SUBSCRIPTION_ACCENT,
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 1.35,
            cursor: isBusy ? "not-allowed" : "pointer",
            opacity: isBusy ? 0.7 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {removingLegacyMembers ? (
            <>
              <SpinningGearComponent />
              {tServices("removingLegacyMembersButton")}
            </>
          ) : (
            tServices("removeLegacyMembersCta", { count: activeLegacyFreeMembersCount })
          )}
        </button>
      </div>
    );
  }

  // Resumen de la suscripción activa: MISMO patrón que saludos/consejos/meet&greet
  // (sin caja alrededor) — "Modificar" como texto plano a la izquierda y el precio
  // grande abajo a la derecha. Aquí el acento es el azul de suscripción.
  function renderSummary() {
    if (!draft.subscription.enabled || disabledByVisibility) return null;

    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          // Mismo desborde que en las tarjetas de servicio: el precio grande no
          // se encoge ni se parte, y en un teléfono angosto empujaba la tarjeta
          // fuera del margen. Con wrap baja a su propia línea.
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
              color: SUBSCRIPTION_ACCENT,
              fontSize: 14,
              fontWeight: 600,
              cursor: isBusy ? "not-allowed" : "pointer",
              opacity: isBusy ? 0.7 : 1,
            }}
          >
            {tServices("subscriptionModifyButton")}
          </button>
        </div>

        {/* Esquina inferior derecha: precio grande (estilo del feed, +40%) + 3 MXN. */}
        <div style={{ display: "grid", gap: 2, justifyItems: "end", textAlign: "end", flexShrink: 0 }}>
          <div style={subtleStyle}>{tServices("subscriptionSummaryPriceLabel")}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
            <span
              style={{
                fontSize: 31,
                fontWeight: 600,
                color: SUBSCRIPTION_ACCENT,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {draft.subscription.price
                ? formatMoney(Number(draft.subscription.price), draft.subscription.currency)
                : `0 ${draft.subscription.currency}`}
            </span>
            <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,0.5)" }}>+ 3 MXN</span>
          </div>
          {subscriptionCalc ? (
            <div style={{ ...subtleStyle, textAlign: "end", whiteSpace: "nowrap", marginTop: 2 }}>
              {tServices("subscriptionCalculationMessage", {
                price: formatMoney(subscriptionCalc.gross, draft.subscription.currency),
                netAmount: formatMoney(subscriptionCalc.net, draft.subscription.currency),
              })}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "grid", gap: 10 }}>
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
                {tServices("subscriptionTitle")}
              </span>
              <span
                style={
                  !draft.subscription.enabled
                    ? { ...descriptionStyle, display: "flex", alignItems: "flex-start", gap: 6 }
                    : descriptionStyle
                }
              >
                {!draft.subscription.enabled ? (
                  <ServiceInfoIcon color={SUBSCRIPTION_ACCENT} />
                ) : null}
                <span>{tServices("expSubscriptionDesc")}</span>
              </span>
            </div>

<div
  onClick={() => {
    if (disabledByVisibility) {
      showSubToast(tServices("subscriptionPublicDisabledToast"), "warning");
    }
  }}
  style={{
    cursor: disabledByVisibility ? "not-allowed" : "default",
  }}
>
  <SwitchComponent
    checked={disabledByVisibility ? false : draft.subscription.enabled}
    disabled={isBusy || disabledByVisibility}
    onChange={handleToggle}
    activeColor={SUBSCRIPTION_ACCENT}
    label={
      disabledByVisibility
        ? tServices("subscriptionDisabledLabel")
        : tServices("subscriptionToggleLabel")
    }
  />
</div>
          </div>

          {/* Items informativos: mismo patrón que las demás experiencias
              (hover en laptop / "ver más" en celular cuando está inactiva; fijos
              cuando está activa). */}
          {!draft.subscription.enabled ? (
            <ServicePreviewReveal service="subscription" accentColor={SUBSCRIPTION_ACCENT} />
          ) : (
            <ServiceFeaturePreview service="subscription" accentColor={SUBSCRIPTION_ACCENT} />
          )}

{disabledByVisibility && (
  <>
    <style>{`
      @keyframes vibraSubPrivacyPop {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.92); }
      }
    `}</style>
    <div
      style={{
        display: "grid",
        gap: 12,
        padding: "12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "transparent",
        marginTop: 14,
        animation: popping ? "vibraSubPrivacyPop 200ms ease-in forwards" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ marginTop: 1 }}>
          <ServiceInfoIcon color={SUBSCRIPTION_ACCENT} size={16} />
        </span>
        <span style={descriptionStyle}>
          {tServices("subscriptionPublicDisabledWarning")}
        </span>
      </div>

      {canMakePrivate && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              paddingTop: 10,
              borderTop: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <span style={titleStyle}>
              {tServices("communityPrivacyToggleLabel")}
            </span>
            <SwitchComponent
              checked={false}
              disabled={changingVisibility || saving || removingLegacyMembers}
              onChange={() => void handleMakePrivate()}
              label={tServices("communityPrivacyToggleAria")}
            />
          </div>
          <span style={subtleStyle}>
            {tServices("subscriptionBackToPublicNote")}
          </span>
        </>
      )}
    </div>
  </>
)}

          {renderLegacyMembers()}

          {renderSummary()}
        </div>
      </div>

      <OverlayModalComponent
        open={overlayMode !== null}
        title={
          isDeactivating
            ? tServices("subscriptionDeactivateModalTitle")
            : tServices("subscriptionConfigModalTitle")
        }
        loading={saving}
        confirmDisabled={
          isDeactivating
            ? // Solo hace falta haber elegido qué pasa con los integrantes.
              !overlayDraft.subscriptionToFreePolicy
            : !(Number(overlayDraft.subscription.price) > 0) || priceBelowMin
        }
        onCancel={closeOverlay}
        onConfirm={() => void confirmOverlaySave()}
      >
        {/* Todo el bloque de precio desaparece al apagar la suscripción. */}
        {!isDeactivating && (
        <>
        <div style={{ ...subtleStyle, marginBottom: 2 }}>
          {tServices("priceLegend")}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            min="1"
            step="0.01"
            value={overlayDraft.subscription.price}
            onChange={(e) =>
              setOverlayDraft((prev) => ({
                ...prev,
                subscription: {
                  ...prev.subscription,
                  price: e.target.value,
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
              color: SUBSCRIPTION_ACCENT,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            {displayCurrency}
          </span>
        </div>
        <div>
          {/* Leyenda: error de mínimo (rojo, animada). */}
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
          {/* Leyenda: cuánto ganas al mes (net), animada, solo si net > 0. */}
          <div
            style={{
              maxHeight: overlaySubscriptionCalc && overlaySubscriptionCalc.net > 0 ? 60 : 0,
              opacity: overlaySubscriptionCalc && overlaySubscriptionCalc.net > 0 ? 1 : 0,
              transform:
                overlaySubscriptionCalc && overlaySubscriptionCalc.net > 0
                  ? "translateY(0)"
                  : "translateY(4px)",
              overflow: "hidden",
              transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
            }}
          >
            <div style={{ ...subtleStyle, marginTop: 3 }}>
              {tServices.rich("subscriptionEarningsLegend", {
                net: formatMoney(overlaySubscriptionCalc?.net ?? 0, displayCurrency as Currency),
                amount: (chunks) => (
                  <span style={{ color: SUBSCRIPTION_ACCENT, fontWeight: 700 }}>
                    {chunks}
                  </span>
                ),
              })}
            </div>
          </div>
          {/* Leyenda fija del cargo de Stripe (mismo patrón que las demás experiencias). */}
          <div style={{ ...subtleStyle, opacity: 0.7, fontSize: 11, marginTop: 3 }}>
            A la suscripción se le suman $3 MXN por el cargo de procesamiento de Stripe.
          </div>
        </div>
        </>
        )}

        {shouldShowFreeToSubscriptionPolicy ? (
          <TransitionPolicyPanel
            mode="free_to_subscription"
            value={overlayDraft.freeToSubscriptionPolicy}
            onChange={(next) =>
              setOverlayDraft((prev) => ({
                ...prev,
                freeToSubscriptionPolicy: next as FreeToSubscriptionPolicy,
              }))
            }
            saving={saving}
            titleStyle={titleStyle}
            subtleStyle={subtleStyle}
          />
        ) : null}

        {shouldShowSubscriptionToFreePolicy ? (
          <TransitionPolicyPanel
            mode="subscription_to_free"
            value={overlayDraft.subscriptionToFreePolicy}
            onChange={(next) =>
              setOverlayDraft((prev) => ({
                ...prev,
                subscriptionToFreePolicy: next as SubscriptionToFreePolicy,
              }))
            }
            saving={saving}
            titleStyle={titleStyle}
            subtleStyle={subtleStyle}
          />
        ) : null}

        {shouldShowPriceIncreasePolicy ? (
          <TransitionPolicyPanel
            mode="subscription_price_increase"
            value={overlayDraft.subscriptionPriceIncreasePolicy}
            onChange={(next) =>
              setOverlayDraft((prev) => ({
                ...prev,
                subscriptionPriceIncreasePolicy:
                  next as SubscriptionPriceIncreasePolicy,
              }))
            }
            saving={saving}
            titleStyle={titleStyle}
            subtleStyle={subtleStyle}
          />
        ) : null}
      </OverlayModalComponent>

      <ConfirmModalComponent
        open={showRemoveLegacyMembersModal}
        title={tServices("confirmRemoveLegacyMembersTitle")}
        description={
          <>
            {tServices("confirmRemoveLegacyMembersDescription")}
            <br />
            <br />
            <strong style={{ color: "#fff" }}>
              {tServices("confirmRemoveLegacyMembersCount")} {activeLegacyFreeMembersCount}
            </strong>
          </>
        }
        confirmLabel={tServices("confirmRemoveLegacyMembersButton")}
        loading={removingLegacyMembers}
        onCancel={() => {
          if (removingLegacyMembers) return;
          setShowRemoveLegacyMembersModal(false);
        }}
        onConfirm={async () => {
          await onRemoveLegacyMembers();
          setShowRemoveLegacyMembersModal(false);
        }}
      />
      <VibraToast toast={subToast} />
    </>
  );
}