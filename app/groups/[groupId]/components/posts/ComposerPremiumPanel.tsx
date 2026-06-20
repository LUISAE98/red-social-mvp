"use client";

import type {
  PostPremiumAccessMode,
  PostPremiumFreeFor,
  PostContextType,
} from "@/lib/posts/types";
import type {
  PremiumCapabilities,
  PremiumValidationResult,
} from "@/lib/posts/premium";

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

const accessModeLabels: Record<
  PostPremiumAccessMode,
  { title: string; description: string }
> = {
  members_only: {
    title: "Solo miembros del grupo",
    description: "Solo los miembros de tu comunidad podrán ver esta publicación y pagar para desbloquear su contenido.",
  },
  public: {
    title: "Público",
    description: "Cualquier persona, incluso sin tener una cuenta en Vibra, podrá pagar para desbloquear esta publicación. El resto de tus publicaciones seguirán siendo privadas y solo estarán disponibles para los miembros de tu comunidad.",
  },
};

const freeForLabels: Record<
  PostPremiumFreeFor,
  { title: string; description: string }
> = {
  members_and_subscribers: {
    title: "Gratis para miembros",
    description: "Los miembros y suscriptores del grupo lo ven gratis; otros usuarios pagan para acceder.",
  },
  none: {
    title: "Pago para todos",
    description: "Todo usuario debe comprar acceso al video.",
  },
};

const fontStack =
  'inherit';

function buildReadonlyConfigText(
  accessMode: PostPremiumAccessMode,
  freeFor: PostPremiumFreeFor,
): string {
  if (accessMode === "public" && freeFor === "none") {
    return "El acceso a este video premium es público. Cualquier persona dentro y fuera de Vibra puede pagar para desbloquearlo.";
  }
  if (accessMode === "public" && freeFor === "members_and_subscribers") {
    return "El acceso es público. Los miembros y suscriptores del grupo lo ven gratis; cualquier otra persona puede pagar para desbloquearlo.";
  }
  if (accessMode === "members_only" && freeFor === "none") {
    return "El acceso está limitado a los miembros del grupo, quienes deben pagar para desbloquear el video.";
  }
  return "El acceso está limitado a los miembros del grupo. Los suscriptores lo ven gratis; el resto de los miembros paga para desbloquearlo.";
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
          background: selected ? "#a855ff" : "transparent",
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

  const parsedPrice = parseFloat(priceInput);
  const creatorEarnings =
    priceInput !== "" && Number.isFinite(parsedPrice) && parsedPrice > 0
      ? (parsedPrice * 0.77).toFixed(2)
      : null;

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
            color: "#a855ff",
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            lineHeight: 1.2,
            fontFamily: fontStack,
          }}
        >
          Configurar monetización
        </div>

        <div
          style={{
            color: "rgba(196,168,255,0.7)",
            fontSize: 12.5,
            lineHeight: 1.35,
          }}
        >
          Define cómo se cobrará el acceso a este video.
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
          {buildReadonlyConfigText(accessMode, freeFor)}
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
          Las publicaciones premium creadas desde perfiles siempre serán
          públicas. Cualquier persona podrá verlas dentro de Vibra, incluso sin
          iniciar sesión. Además, tanto usuarios registrados como visitantes sin
          cuenta podrán pagar para desbloquear el contenido premium.
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
          Las publicaciones premium de comunidades ocultas solo están
          disponibles para los miembros del grupo. Al ser una comunidad oculta,
          el contenido no es visible desde fuera; todos los miembros que deseen
          acceder deberán pagar para desbloquearlo.
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
            Alcance del acceso
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
            Las publicaciones premium creadas desde comunidades públicas siempre
            serán públicas. Cualquier persona podrá verlas dentro de Vibra,
            incluso sin iniciar sesión. Además, tanto los usuarios registrados
            como los visitantes sin cuenta podrán pagar para desbloquear el
            contenido premium.
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
            Quién lo ve gratis
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
              Precio
            </span>
            {priceError ? (
              <span
                style={{
                  color: "rgba(255,90,90,0.9)",
                  fontSize: 10.5,
                  fontWeight: 500,
                  lineHeight: 1.3,
                }}
              >
                {priceError}
              </span>
            ) : null}
          </span>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "1px solid rgba(168,85,255,0.28)",
              background: "rgba(12,8,22,0.7)",
              borderRadius: 12,
              padding: "0 12px",
            }}
          >
            <span
              style={{
                color: "#a855ff",
                fontSize: 15,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              $
            </span>

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
                width: "100%",
                minWidth: 0,
                height: 44,
                border: 0,
                outline: "none",
                background: "transparent",
                color: "#fff",
                fontSize: 15,
                fontWeight: 400,
                fontFamily: fontStack,
              }}
            />

            <span
              style={{
                color: "rgba(168,85,255,0.58)",
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.06em",
                flexShrink: 0,
              }}
            >
              MXN
            </span>
          </div>

          {creatorEarnings ? (
            <span
              style={{
                color: "rgba(196,168,255,0.65)",
                fontSize: 11.5,
                lineHeight: 1.45,
                fontFamily: fontStack,
              }}
            >
              Por cada desbloqueo de tu publicación premium cobrarás{" "}
              <strong style={{ color: "#a855ff", fontWeight: 600 }}>
                ${formatThousands(creatorEarnings)} MXN
              </strong>
            </span>
          ) : null}
        </div>
      ) : null}

      {capabilityError ? (
        <p
          role="alert"
          style={{
            margin: 0,
            color: "rgba(255,90,90,0.88)",
            fontSize: 11.5,
            lineHeight: 1.35,
            fontFamily: fontStack,
          }}
        >
          {capabilityError}
        </p>
      ) : null}
    </section>
  );
}
