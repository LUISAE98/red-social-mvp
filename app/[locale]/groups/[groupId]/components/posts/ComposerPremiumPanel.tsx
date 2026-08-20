"use client";

import type { CSSProperties } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { formatCurrency } from "@/lib/currency/format";
import { LocalPriceHint } from "@/components/services/config/serviceConfigKit";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import {
  FIXED_SERVICE_FEE_USD,
  FIXED_SERVICE_FEE_LABEL,
  FIXED_SERVICE_FEE_NOTE,
  PREMIUM_MIN_PRICE_USD,
} from "@/lib/currency/catalog";
import type {
  PostPremiumAccessMode,
  PostPremiumFreeFor,
  PostContextType,
} from "@/lib/posts/types";
import type { PremiumCapabilities } from "@/lib/posts/premium";

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

  disabled?: boolean;
  isEditMode?: boolean;
};

const fontStack =
  'inherit';

// Estética tomada del composer de live (LiveComposerModal): etiquetas en
// mayúsculas tenues, filas de radio separadas por línea, punto morado en la
// selección y avisos en cajas neutras. Sin contenedor morado.
const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 500,
  color: "rgba(255,255,255,0.5)",
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  marginBottom: 3,
  display: "block",
  fontFamily: fontStack,
};

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

/** Aviso de configuración fija (mismo bloque que el live usa para comunidad oculta). */
function NoteBox({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 2 }}
        aria-hidden="true"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>

      <span
        style={{
          fontSize: 11.5,
          lineHeight: 1.5,
          color: "rgba(255,255,255,0.5)",
          fontFamily: fontStack,
        }}
      >
        {text}
      </span>
    </div>
  );
}

function OptionRow<TValue extends string>({
  value,
  selected,
  disabled,
  isLast,
  title,
  description,
  onSelect,
}: {
  value: TValue;
  selected: boolean;
  disabled?: boolean;
  isLast: boolean;
  title: string;
  description: string;
  onSelect: (value: TValue) => void;
}) {
  return (
    <div
      className="vibra-premium-radio"
      role="radio"
      aria-checked={selected}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onSelect(value)}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(value);
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 2px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.08)",
        userSelect: "none",
        outline: "none",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: fontStack }}>
          {title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.4)",
            fontFamily: fontStack,
            marginTop: 2,
            lineHeight: 1.4,
          }}
        >
          {description}
        </div>
      </div>

      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          border: `2px solid ${selected ? "#a855f7" : "rgba(255,255,255,0.25)"}`,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        {selected && (
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#a855f7" }} />
        )}
      </span>
    </div>
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
  disabled = false,
  isEditMode = false,
}: ComposerPremiumPanelProps) {
  const tPosts = useTranslations("posts");
  const priceFmt = usePriceFormat();

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

  // Sin toasts de validación: configurar todavía NO es un error. Faltar el precio o
  // estar bajo el mínimo se avisa en rojo bajo el propio campo, y publicar ya está
  // bloqueado por `validation.valid` en el composer.

  if (!hasVideos || !premiumEnabled) return null;

  const showAccessModeOptions = !isEditMode && capabilities.allowedAccessModes.length > 1;
  const hasFreeForChoice = !isEditMode && capabilities.allowedFreeForOptions.length > 1;
  const showFixedAccessMode = !isEditMode && capabilities.allowedAccessModes.length === 1;

  const isHiddenGroupContext =
    !isEditMode && showFixedAccessMode && capabilities.allowedAccessModes[0] === "members_only";

  // "Quién lo ve gratis" SOLO tiene sentido con alcance público: si el post es
  // solo para miembros, no hay nadie fuera a quien cobrarle, así que los miembros
  // pagan por definición (lo mismo que valida el backend). El bloque se despliega
  // y se colapsa suave al cambiar el alcance, como en el composer de live.
  const freeForVisible = hasFreeForChoice && accessMode === "public";

  const requiresPrice = true;


  const parsedPrice = parseFloat(priceInput);
  const hasValidPrice =
    priceInput !== "" && Number.isFinite(parsedPrice) && parsedPrice > 0;

  // La base es EXACTAMENTE lo que teclea el creador, en la moneda de liquidación.
  const anchorPrice = hasValidPrice ? parsedPrice : null;

  // ⚠️ NO se usa `priceFmt.format` aquí: ese calcula el precio del COMPRADOR —convierte a
  // su moneda, suma el 2% y redondea al paso—, así que la ganancia del creador salía
  // convertida e inflada. Lo que él fija y lo que cobra viven en la moneda de liquidación.
  const creatorEarnings =
    anchorPrice != null
      ? formatCurrency(anchorPrice * WALLET_NET_RATE, SETTLEMENT_CURRENCY, priceFmt.locale, { code: true })
      : null;

  // Por debajo del mínimo → aviso rojo, no se debe publicar.
  const belowMin = anchorPrice != null && anchorPrice < PREMIUM_MIN_PRICE_USD;
  // Las ganancias se muestran solo con precio válido y por encima del mínimo.
  const earningsVisible = !!creatorEarnings && !belowMin;

  return (
    <div
      style={{
        fontFamily: fontStack,
        // Sin caja: la sección se separa con una línea, como los bloques del
        // composer de live (nada de contenedor morado).
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingTop: 12,
      }}
    >
      <style>{`
        .vibra-premium-radio { transition: transform 160ms ease; }
        @media (hover: hover) {
          .vibra-premium-radio:hover { transform: scale(1.02); }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-premium-radio { transition: none; }
          .vibra-premium-radio:hover { transform: none; }
        }
      `}</style>

      <label style={{ ...labelStyle, marginTop: 2 }}>{tPosts("premiumConfigTitle")}</label>
      <div
        style={{
          fontSize: 11,
          color: "rgba(255,255,255,0.4)",
          lineHeight: 1.4,
          marginBottom: 10,
        }}
      >
        {tPosts("premiumConfigDesc")}
      </div>

      {isEditMode ? (
        <div style={{ marginBottom: 10 }}>
          <NoteBox text={buildReadonlyConfigText(accessMode, freeFor, tPosts)} />
        </div>
      ) : null}

      {isHiddenGroupContext ? (
        <div style={{ marginBottom: 10 }}>
          <NoteBox text={tPosts("premiumHiddenCommunityNote")} />
        </div>
      ) : null}

      {showFixedAccessMode &&
      contextType !== "profile" &&
      capabilities.allowedAccessModes[0] === "public" ? (
        <div style={{ marginBottom: 10 }}>
          <NoteBox text={tPosts("premiumPublicCommunityNote")} />
        </div>
      ) : null}

      {showAccessModeOptions ? (
        <>
          <label style={labelStyle}>{tPosts("premiumReachLabel")}</label>
          <div style={{ marginBottom: 8 }} role="radiogroup" aria-label={tPosts("premiumReachLabel")}>
            {capabilities.allowedAccessModes.map((option, idx) => (
              <OptionRow
                key={option}
                value={option}
                selected={accessMode === option}
                disabled={disabled}
                isLast={idx === capabilities.allowedAccessModes.length - 1}
                title={accessModeLabels[option].title}
                description={accessModeLabels[option].description}
                onSelect={setAccessMode}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Se DESLIZA suave al elegir alcance público y se colapsa al volver a
          "solo miembros" (donde no hay elección posible). */}
      {hasFreeForChoice ? (
        <div
          style={{
            maxHeight: freeForVisible ? 300 : 0,
            opacity: freeForVisible ? 1 : 0,
            overflow: "hidden",
            transition: "max-height 300ms ease, opacity 240ms ease",
          }}
          aria-hidden={!freeForVisible}
        >
          <label style={labelStyle}>{tPosts("premiumFreeViewerLabel")}</label>
          <div style={{ marginBottom: 8 }} role="radiogroup" aria-label={tPosts("premiumFreeViewerLabel")}>
            {capabilities.allowedFreeForOptions.map((option, idx) => (
              <OptionRow
                key={option}
                value={option}
                selected={freeFor === option}
                disabled={disabled || !freeForVisible}
                isLast={idx === capabilities.allowedFreeForOptions.length - 1}
                title={freeForLabels[option].title}
                description={freeForLabels[option].description}
                onSelect={setFreeFor}
              />
            ))}
          </div>
        </div>
      ) : null}

      {requiresPrice ? (
        <>
          <label style={labelStyle}>{tPosts("premiumPriceLabel")}</label>

          {/* En edición el precio es de SOLO LECTURA, como el resto de la
              configuración: lo que se cobra vive en `oneTimePrice`, que las
              reglas no dejan cambiar en una edición. Un campo editable aquí
              solo lograba que la tarjeta mostrara un precio y Stripe cobrara
              otro (ver updatePost). */}

          {/* Presentación IGUAL a experiencias/live: el campo es un input autónomo
              (estilo canónico vibra_style.md); el "+ $3" y la moneda van FUERA,
              como hermanos en la fila (no dentro del placeholder). */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <input
              type="text"
              enterKeyHint="done"
              value={formatThousands(priceInput)}
              disabled={disabled || isEditMode}
              readOnly={isEditMode}
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
              {FIXED_SERVICE_FEE_LABEL}
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
              {/* ⚠️ La moneda en la que TECLEA el creador, no la del visor. Antes salía
                  `displayCurrency` —la moneda de quien mira— junto a un campo cuyo valor
                  va en la de liquidación: el creador escribía 20 y leía "MXN" al lado. */}
              {SETTLEMENT_CURRENCY}
            </span>
          </div>

          {/* Avisos que COLAPSAN suave (como en experiencias/live): mínimo en rojo y
              cuánto ganas por desbloqueo. */}
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
                  fontSize: 12,
                  lineHeight: 1.45,
                  fontFamily: fontStack,
                }}
              >
                {`El mínimo es $${PREMIUM_MIN_PRICE_USD}`}
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
                  color: "rgba(255,255,255,0.55)",
                  fontSize: 12,
                  lineHeight: 1.45,
                  fontFamily: fontStack,
                }}
              >
                {tPosts("premiumEarningsPerUnlock")}{" "}
                <strong style={{ color: "#a855f7", fontWeight: 700 }}>
                  {creatorEarnings}
                </strong>
              </span>
            </div>

            {/* Leyenda del cargo fijo de Stripe (siempre visible), en la misma celda. */}
            <div
              style={{
                color: "rgba(255,255,255,0.4)",
                fontSize: 11,
                lineHeight: 1.4,
                fontFamily: fontStack,
                marginTop: 3,
              }}
            >
              {FIXED_SERVICE_FEE_NOTE}
            </div>
          </div>

          {/* Referencia en la moneda del creador, igual que en el resto de experiencias.
              El precio SIEMPRE se fija en la de liquidación; esto solo lo ayuda a ubicarse. */}
          <LocalPriceHint value={anchorPrice} netRate={WALLET_NET_RATE} />
        </>
      ) : null}
    </div>
  );
}
