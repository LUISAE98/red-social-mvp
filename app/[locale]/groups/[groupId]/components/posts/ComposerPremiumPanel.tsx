"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import { FIXED_SERVICE_FEE_MXN, PREMIUM_MIN_PRICE_MXN } from "@/lib/currency/catalog";
import type {
  PostPremiumAccessMode,
  PostPremiumFreeFor,
  PostContextType,
} from "@/lib/posts/types";
import type {
  PremiumCapabilities,
  PremiumValidationResult,
} from "@/lib/posts/premium";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type ComposerPremiumPanelProps = {
  hasVideos: boolean;
  contextType: PostContextType;

  premiumEnabled: boolean;
  setPremiumEnabled: (enabled: boolean) => void;

  accessMode: PostPremiumAccessMode;
  setAccessMode: (accessMode: PostPremiumAccessMode) => void;

  freeFor: PostPremiumFreeFor;
  setFreeFor: (freeFor: PostPremiumFreeFor) => void;

  priceInput: string;
  setPriceInput: (value: string) => void;

  capabilities: PremiumCapabilities;
  validation: PremiumValidationResult;
  premiumErrorMessage: string | null;

  disabled?: boolean;
  isEditMode?: boolean;
};

const fontStack =
  'inherit';

function buildReadonlyConfigText(
  accessMode: PostPremiumAccessMode,
  freeFor: PostPremiumFreeFor,
  t: (key: string) => string,
): string {
  if (accessMode === "public" && freeFor === "none") {
    return t("premiumReadonlyPublicPaid");
  }
  if (accessMode === "public" && freeFor === "members_and_subscribers") {
    return t("premiumReadonlyPublicMembersFree");
  }
  if (accessMode === "members_only" && freeFor === "none") {
    return t("premiumReadonlyMembersOnlyPaid");
  }
  return t("premiumReadonlyMembersOnlySubscribersFree");
}

function formatThousands(raw: string): string {
  if (!raw) return raw;
  const [intPart, decPart] = raw.split(".");
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
}

function OptionRow<TValue extends string>({
  value,
  selected,
  disabled,
  title,
  description,
  onSelect,
}: {
  value: TValue;
  selected: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onSelect: (value: TValue) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(value)}
      style={{
        width: "100%",
        background: "none",
        border: "none",
        padding: "3px 0",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: fontStack,
        textAlign: "left",
      }}
    >
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.25,
            color: selected ? "#fff" : "rgba(255,255,255,0.65)",
          }}
        >
          {title}
        </span>

        <span
          style={{
            fontSize: 11.5,
            lineHeight: 1.35,
            color: "rgba(196,168,255,0.55)",
          }}
        >
          {description}
        </span>
      </span>

      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 22,
          borderRadius: 11,
          background: selected ? "#a855f7" : "transparent",
          boxShadow: selected
            ? "none"
            : "inset 0 0 0 1.5px rgba(168,85,255,0.3)",
          position: "relative",
          flexShrink: 0,
          display: "inline-block",
          transition: "background 0.18s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: selected ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: selected ? "#fff" : "rgba(196,168,255,0.45)",
            boxShadow: selected ? "0 1px 3px rgba(0,0,0,0.35)" : "none",
            transition: "left 0.18s, background 0.18s",
          }}
        />
      </span>
    </button>
  );
}

export default function ComposerPremiumPanel({
  hasVideos,
  contextType,
  premiumEnabled,
  accessMode,
  setAccessMode,
  freeFor,
  setFreeFor,
  priceInput,
  setPriceInput,
  capabilities,
  validation,
  premiumErrorMessage,
  disabled = false,
  isEditMode = false,
}: ComposerPremiumPanelProps) {
  const tPosts = useTranslations("posts");
  const priceFmt = usePriceFormat();
  const { toast: premiumToast, showToast: showPremiumToast } = useVibraToast();

  const accessModeLabels: Record<
    PostPremiumAccessMode,
    { title: string; description: string }
  > = {
    members_only: {
      title: tPosts("premiumReachMembersTitle"),
      description: tPosts("premiumReachMembersDesc"),
    },
    public: {
      title: tPosts("premiumReachPublicTitle"),
      description: tPosts("premiumReachPublicDesc"),
    },
  };

  const freeForLabels: Record<
    PostPremiumFreeFor,
    { title: string; description: string }
  > = {
    members_and_subscribers: {
      title: tPosts("premiumAccessFreeTitle"),
      description: tPosts("premiumAccessFreeDesc"),
    },
    none: {
      title: tPosts("premiumAccessPaidTitle"),
      description: tPosts("premiumAccessPaidDesc"),
    },
  };

  useEffect(() => {
    // El aviso de "precio mínimo" ya se muestra en rojo bajo el campo; no lo repetimos como toast.
    if (premiumErrorMessage && validation.errors[0]?.code !== "premium_price_below_min") {
      showPremiumToast(premiumErrorMessage, "error");
    }
  }, [premiumErrorMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!capabilities.canEnablePremium && capabilities.disabledReason) {
      showPremiumToast(capabilities.disabledReason, "warning");
    }
  }, [capabilities.canEnablePremium, capabilities.disabledReason]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasVideos || !premiumEnabled) return null;

  const showAccessModeOptions = !isEditMode && capabilities.allowedAccessModes.length > 1;
  const showFreeForOptions = !isEditMode && capabilities.allowedFreeForOptions.length > 1;
  const showFixedAccessMode = !isEditMode && capabilities.allowedAccessModes.length === 1;
  const showFixedFreeFor = !isEditMode && capabilities.allowedFreeForOptions.length === 1;

  const isHiddenGroupContext =
    !isEditMode && showFixedAccessMode && capabilities.allowedAccessModes[0] === "members_only";

  const requiresPrice = true;

  const priceError = !validation.valid ? premiumErrorMessage : null;
  const capabilityError = !capabilities.canEnablePremium
    ? capabilities.disabledReason
    : null;

  const { currency: displayCurrency } = priceFmt;

  const parsedPrice = parseFloat(priceInput);
  const hasValidPrice =
    priceInput !== "" && Number.isFinite(parsedPrice) && parsedPrice > 0;

  // Mexico-only: la base es EXACTAMENTE lo que teclea el creador, en MXN (sin conversión).
  const anchorPrice = hasValidPrice ? parsedPrice : null;

  const creatorEarnings =
    anchorPrice != null
      ? priceFmt.format(anchorPrice * WALLET_NET_RATE, { baseCurrency: "MXN", code: true })
      : null;

  // Por debajo del mínimo ($25 base) → aviso rojo, no se debe publicar.
  const belowMin = anchorPrice != null && anchorPrice < PREMIUM_MIN_PRICE_MXN;
  // Las ganancias se muestran solo con precio válido y por encima del mínimo.
  const earningsVisible = !!creatorEarnings && !belowMin;

  return (
    <section
      style={{
        border: "1px solid rgba(168,85,255,0.07)",
        background: "linear-gradient(160deg, #100c1c, #12092a 55%, #0f0818)",
        boxShadow: "0 2px 12px rgba(79,70,255,0.07)",
        borderRadius: 10,
        padding: 14,
        display: "grid",
        gap: 14,
        fontFamily: fontStack,
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <div
          style={{
            color: "#a855f7",
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            fontFamily: fontStack,
          }}
        >
          {tPosts("premiumConfigTitle")}
        </div>

        <div
          style={{
            color: "rgba(196,168,255,0.7)",
            fontSize: 12.5,
            lineHeight: 1.35,
          }}
        >
          {tPosts("premiumConfigDesc")}
        </div>
      </div>

      {isEditMode ? (
        <p
          style={{
            margin: 0,
            color: "#fff",
            fontSize: 11.5,
            lineHeight: 1.55,
            fontFamily: fontStack,
            textAlign: "justify",
          }}
        >
          {buildReadonlyConfigText(accessMode, freeFor, tPosts)}
        </p>
      ) : null}

      {!isEditMode && contextType === "profile" ? (
        <p
          style={{
            margin: 0,
            color: "#fff",
            fontSize: 11.5,
            lineHeight: 1.55,
            fontFamily: fontStack,
            textAlign: "justify",
          }}
        >
          {tPosts("premiumProfilePublicNote")}
        </p>
      ) : null}

      {isHiddenGroupContext ? (
        <p
          style={{
            margin: 0,
            color: "#fff",
            fontSize: 11.5,
            lineHeight: 1.55,
            fontFamily: fontStack,
            textAlign: "justify",
          }}
        >
          {tPosts("premiumHiddenCommunityNote")}
        </p>
      ) : null}

      {showAccessModeOptions ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              color: "rgba(196,168,255,0.82)",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {tPosts("premiumReachLabel")}
          </div>

          {capabilities.allowedAccessModes.map((option) => (
            <OptionRow
              key={option}
              value={option}
              selected={accessMode === option}
              disabled={disabled}
              title={accessModeLabels[option].title}
              description={accessModeLabels[option].description}
              onSelect={setAccessMode}
            />
          ))}
        </div>
      ) : null}

      {showFixedAccessMode && contextType !== "profile" ? (
        capabilities.allowedAccessModes[0] === "public" ? (
          <p
            style={{
              margin: 0,
              color: "#fff",
              fontSize: 11.5,
              lineHeight: 1.55,
              fontFamily: fontStack,
              textAlign: "justify",
            }}
          >
            {tPosts("premiumPublicCommunityNote")}
          </p>
        ) : null
      ) : null}

      {showFreeForOptions ? (
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          <div
            style={{
              color: "rgba(196,168,255,0.82)",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {tPosts("premiumFreeViewerLabel")}
          </div>

          {capabilities.allowedFreeForOptions.map((option) => (
            <OptionRow
              key={option}
              value={option}
              selected={freeFor === option}
              disabled={disabled}
              title={freeForLabels[option].title}
              description={freeForLabels[option].description}
              onSelect={setFreeFor}
            />
          ))}
        </div>
      ) : null}

      {showFixedFreeFor && contextType !== "profile" && !isHiddenGroupContext ? (
        <div
          style={{
            marginTop: 8,
            border: "1px solid rgba(168,85,255,0.18)",
            background: "rgba(79,70,255,0.08)",
            borderRadius: 12,
            padding: "11px 12px",
            display: "grid",
            gap: 3,
          }}
        >
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>
            {freeForLabels[capabilities.allowedFreeForOptions[0]].title}
          </div>

          <div
            style={{
              color: "rgba(196,168,255,0.65)",
              fontSize: 12.5,
              lineHeight: 1.35,
            }}
          >
            {freeForLabels[capabilities.allowedFreeForOptions[0]].description}
          </div>
        </div>
      ) : null}

      {requiresPrice ? (
        <div style={{ display: "grid", gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                color: "rgba(196,168,255,0.82)",
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {tPosts("premiumPriceLabel")}
            </span>
          </span>

          {/* Presentación IGUAL a experiencias: el campo es un input autónomo
              (estilo canónico vibra_style.md); el "+ $3" y la moneda van FUERA,
              como hermanos en la fila (no dentro del placeholder). */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              enterKeyHint="done"
              value={formatThousands(priceInput)}
              disabled={disabled}
              onChange={(event) =>
                setPriceInput(event.target.value.replace(/,/g, ""))
              }
              inputMode="decimal"
              placeholder="0.00"
              style={{
                flex: "1 1 180px",
                minWidth: 0,
                background: "rgba(255,255,255,0.06)",
                border: "none",
                borderRadius: 12,
                padding: "10px 12px",
                color: "#fff",
                outline: "none",
                fontSize: 15,
                fontWeight: 400,
                fontFamily: fontStack,
                boxSizing: "border-box",
                minHeight: 44,
              }}
            />

            <span
              style={{
                color: "rgba(255,255,255,0.55)",
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              + $3
            </span>

            <span
              style={{
                color: "#a855f7",
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
              }}
            >
              {displayCurrency}
            </span>
          </div>

          {/* Avisos que COLAPSAN suave (como en experiencias): mínimo en rojo y
              cuánto ganas por desbloqueo. Se animan (max-height + opacity) en vez
              de aparecer/desaparecer de golpe y empujar el panel bruscamente. */}
          <div>
            <div
              style={{
                maxHeight: belowMin ? 24 : 0,
                opacity: belowMin ? 1 : 0,
                transform: belowMin ? "translateY(0)" : "translateY(4px)",
                overflow: "hidden",
                transition:
                  "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
              }}
            >
              <span
                style={{
                  display: "block",
                  color: "#f87171",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  fontFamily: fontStack,
                }}
              >
                {`El mínimo es $${PREMIUM_MIN_PRICE_MXN}`}
              </span>
            </div>

            <div
              style={{
                maxHeight: earningsVisible ? 24 : 0,
                opacity: earningsVisible ? 1 : 0,
                transform: earningsVisible ? "translateY(0)" : "translateY(4px)",
                overflow: "hidden",
                transition:
                  "max-height 220ms ease, opacity 220ms ease, transform 220ms ease",
              }}
            >
              <span
                style={{
                  display: "block",
                  color: "rgba(196,168,255,0.65)",
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  fontFamily: fontStack,
                }}
              >
                {tPosts("premiumEarningsPerUnlock")}{" "}
                <strong style={{ color: "#a855f7", fontWeight: 600 }}>
                  {creatorEarnings}
                </strong>
              </span>
            </div>

            {/* Leyenda del cargo fijo de Stripe (siempre visible), en la misma celda. */}
            <div
              style={{
                color: "rgba(196,168,255,0.5)",
                fontSize: 11,
                lineHeight: 1.4,
                fontFamily: fontStack,
                marginTop: 3,
              }}
            >
              Se suman ${FIXED_SERVICE_FEE_MXN} MXN por el cargo de procesamiento de Stripe.
            </div>
          </div>
        </div>
      ) : null}

      <VibraToast toast={premiumToast} />
    </section>
  );
}
