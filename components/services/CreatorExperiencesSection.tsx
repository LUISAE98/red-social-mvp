"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CreatorService, CreatorServiceType } from "@/types/group";
import { getVisibleServices } from "@/lib/services/normalizeServices";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { FIXED_SERVICE_FEE_MXN } from "@/lib/currency/catalog";
import TaxNote from "@/components/payments/TaxNote";

type ViewerMembershipStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | "kicked"
  | "expelled"
  | null
  | undefined;

type Props = {
  services: CreatorService[] | null | undefined;
  creatorName: string;
  contextType: "group" | "profile";
  groupId?: string | null;
  creatorHandle?: string | null;
  viewerMembershipStatus?: ViewerMembershipStatus;
  viewerCanRequest?: boolean;
};

const ALLOWED: CreatorServiceType[] = [
  "saludo",
  "consejo",
  "meet_greet_digital",
  "clase_personalizada",
];

type ServiceConfig = {
  title: string;
  description: string;
  meta1Fallback: string;
  meta2: string;
  color: string;
};

const COLORS: Record<string, string> = {
  saludo: "#b45cff",
  consejo: "#f7c948",
  meet_greet_digital: "#2563eb",
  clase_personalizada: "#f472b6",
};

function buildHref(
  serviceType: CreatorServiceType,
  contextType: "group" | "profile",
  groupId?: string | null,
  creatorHandle?: string | null
): string {
  if (contextType === "group" && groupId)
    return `/groups/${groupId}?service=${serviceType}`;
  if (contextType === "profile" && creatorHandle)
    return `/u/${creatorHandle}?service=${serviceType}`;
  return "#";
}

function ChevronRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M9 18l6-6-6-6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CreatorExperiencesSection({
  services,
  creatorName,
  contextType,
  groupId = null,
  creatorHandle = null,
  viewerMembershipStatus = null,
  viewerCanRequest = true,
}: Props) {
  const tServices = useTranslations("services");
  const priceFmt = usePriceFormat();

  const CONFIG: Record<string, ServiceConfig> = {
    saludo: {
      title: tServices("cardSaludoTitle"),
      description: tServices("cardSaludoDesc"),
      meta1Fallback: tServices("cardSaludoMeta1"),
      meta2: tServices("cardSaludoMeta2"),
      color: COLORS.saludo,
    },
    consejo: {
      title: tServices("cardConsejoTitle"),
      description: tServices("cardConsejoDesc"),
      meta1Fallback: tServices("cardConsejoMeta1"),
      meta2: tServices("cardConsejoMeta2"),
      color: COLORS.consejo,
    },
    meet_greet_digital: {
      title: tServices("cardMeetGreetTitle"),
      description: tServices("cardMeetGreetDesc"),
      meta1Fallback: tServices("cardMeetGreetMeta1"),
      meta2: tServices("cardMeetGreetMeta2"),
      color: COLORS.meet_greet_digital,
    },
    clase_personalizada: {
      title: tServices("cardSessionTitle"),
      description: tServices("cardSessionDesc"),
      meta1Fallback: tServices("cardSessionMeta1"),
      meta2: tServices("cardSessionMeta2"),
      color: COLORS.clase_personalizada,
    },
  };

  function getMeta1(service: CreatorService): string {
    const conf = CONFIG[service.type];
    if (!conf) return "";
    if (service.type === "meet_greet_digital") {
      const dur = service.meta?.meetGreet?.durationMinutes;
      return dur ? tServices("cardMeetGreetDuration", { minutes: String(dur) }) : conf.meta1Fallback;
    }
    if (service.type === "clase_personalizada") {
      const dur = service.meta?.customClass?.durationMinutes;
      return dur ? tServices("cardSessionDuration", { minutes: String(dur) }) : conf.meta1Fallback;
    }
    return conf.meta1Fallback;
  }

  function formatPrice(service: CreatorService): {
    hasPrice: boolean;
    numberPart: string;
  } {
    const price =
      service.publicPrice ??
      service.memberPrice ??
      (service as CreatorService & { price?: number | null }).price ??
      null;
    const currency = service.currency ?? "MXN";
    if (typeof price !== "number")
      return { hasPrice: false, numberPart: tServices("cardPriceToConfirm") };
    return {
      hasPrice: true,
      // Precio PUBLICADO = (base del creador + cargo fijo $3) con IVA INCLUIDO (lo que
      // ve/paga el comprador, todo-incluido). `.total` = base+impuesto según su país;
      // si no aplica impuesto, total == base (mismo formato que antes).
      numberPart: priceFmt.formatWithTax(price + FIXED_SERVICE_FEE_MXN, { baseCurrency: currency, code: true }).total,
    };
  }

  if (viewerCanRequest === false) return null;

  const rawServices = Array.isArray(services) ? services : [];

  const visibleNormalized = getVisibleServices(rawServices, contextType);

  const activeTypes = visibleNormalized
    .filter((s) => ALLOWED.includes(s.type as CreatorServiceType))
    .filter((s) => {
      if (contextType === "group") {
        if (
          viewerMembershipStatus &&
          viewerMembershipStatus !== "active" &&
          viewerMembershipStatus !== "subscribed"
        )
          return false;
      }
      return true;
    })
    .map((s) => s.type as CreatorServiceType);

  if (activeTypes.length === 0) return null;

  const rawByType = new Map<string, CreatorService>();
  for (const rs of rawServices) {
    if (rs?.type) rawByType.set(rs.type, rs);
  }

  return (
    <div
      style={{
        width: "100%",
        textAlign: "left",
        marginTop: 22,
      }}
    >
      <style jsx>{`
        @media (max-width: 559px) {
          .exp-description { display: none; }
          .exp-chevron { display: none; }
        }
        @media (min-width: 560px) {
          .exp-avatar { width: 56px; height: 56px; }
        }
        /* Zoom sutil SOLO del contenido al pasar el cursor: el contenedor (bg, borde,
           sombra) se queda fijo y el .exp-card-content escala. Solo con hover real.
           :global porque .exp-card va en un <Link> (componente), no en un DOM host. */
        :global(.exp-card-content) {
          transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform;
        }
        @media (hover: hover) and (pointer: fine) {
          :global(.exp-card:hover .exp-card-content) {
            transform: scale(1.02);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          :global(.exp-card-content) {
            transition: none;
          }
          :global(.exp-card:hover .exp-card-content) {
            transform: none;
          }
        }
      `}</style>

      {/* Section header */}
      <div style={{ marginBottom: 14 }}>
        <h2
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: "#fff",
            margin: 0,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
          }}
        >
          {tServices("cardExperiencesWith", { name: creatorName })}
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.50)",
            margin: "5px 0 0",
            lineHeight: 1.4,
          }}
        >
          {tServices("cardDiscoverMore")}
        </p>
        <div
          style={{
            marginTop: 10,
            width: 40,
            height: 2,
            borderRadius: 999,
            background: "#a855f7",
          }}
        />
      </div>

      {/* Service cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {activeTypes.map((type) => {
          const conf = CONFIG[type];
          if (!conf) return null;

          const rawService = rawByType.get(type);
          const meta1 = rawService ? getMeta1(rawService) : conf.meta1Fallback;
          const meta2 = conf.meta2;
          const priceData = rawService
            ? formatPrice(rawService)
            : { hasPrice: false, numberPart: tServices("cardPriceToConfirm"), currencyCode: "" };
          const href = buildHref(type, contextType, groupId, creatorHandle);
          if (href === "#") return null;

          return (
            <Link
              key={type}
              className="exp-card"
              href={href}
              scroll={false}
              style={{
                display: "block",
                padding: "14px 16px",
                borderRadius: 0,
                background: type === "consejo"
                  ? "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/consejo.webp') center 60%/cover no-repeat"
                  : type === "clase_personalizada"
                  ? "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/sesionexclusiva.webp') center 75%/cover no-repeat"
                  : type === "meet_greet_digital"
                  ? "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/encuentroenvivo.webp') center 60%/cover no-repeat"
                  : "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/saludo.webp') center 32%/cover no-repeat",
                border: "none",
                boxShadow: `0 2px 20px rgba(0,0,0,0.38)`,
                textDecoration: "none",
                color: "#fff",
              }}
            >
              <div
                className="exp-card-content"
                style={{ display: "flex", alignItems: "center", gap: 14 }}
              >
              {/* Icon circle placeholder */}
              <img
                className="exp-avatar"
                src={
                  type === "saludo" ? "/avatarsaludo.webp"
                  : type === "consejo" ? "/avatarconsejo.webp"
                  : type === "clase_personalizada" ? "/avatarsesion.webp"
                  : "/avatarencuentro.webp"
                }
                alt=""
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  flexShrink: 0,
                  objectFit: "cover",
                  boxShadow: `0 0 14px ${conf.color}2e`,
                }}
              />

              {/* Info: title + description */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: "#fff",
                    lineHeight: 1.2,
                  }}
                >
                  {conf.title}
                </div>
                <div
                  className="exp-description"
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.50)",
                    marginTop: 3,
                    lineHeight: 1.35,
                  }}
                >
                  {conf.description}
                </div>
              </div>

              {/* Price */}
              <div
                style={{
                  flex: "0 0 108px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 1,
                }}
              >
                {priceData.hasPrice && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 300,
                      color: "rgba(255,255,255,0.42)",
                      whiteSpace: "nowrap",
                      letterSpacing: "0.01em",
                    }}
                  >
                    {type === "clase_personalizada" ? tServices("cardGetItForFeminine") : tServices("cardGetItFor")}
                  </span>
                )}
                {priceData.hasPrice ? (
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 4, whiteSpace: "nowrap" }}>
                      <span
                        style={{
                          fontSize: 22,
                          fontWeight: 600,
                          color: conf.color,
                          lineHeight: 1,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {priceData.numberPart}
                      </span>
                    </span>
                    {/* 🧾 IVA — el precio de arriba ya es total-incluido → "impuestos incluidos".
                        Mismo estilo tenue que el "consíguelo por" (10px, weight 300). */}
                    <TaxNote
                      included
                      color="rgba(255,255,255,0.42)"
                      style={{ marginTop: 2, fontSize: 10, fontWeight: 300, letterSpacing: "0.01em" }}
                    />
                  </span>
                ) : (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: "rgba(255,255,255,0.45)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {priceData.numberPart}
                  </span>
                )}
              </div>

              {/* Chevron */}
              <div className="exp-chevron" style={{ flexShrink: 0, color: conf.color, alignSelf: "center" }}>
                <ChevronRight />
              </div>
              </div>
            </Link>
          );
        })}
      </div>

    </div>
  );
}
