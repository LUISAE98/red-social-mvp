"use client";

import Link from "next/link";
import type { CreatorService, CreatorServiceType } from "@/types/group";
import { getVisibleServices } from "@/lib/services/normalizeServices";

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

const CONFIG: Record<string, ServiceConfig> = {
  saludo: {
    title: "Saludo personalizado",
    description: "Recibe un video exclusivo con un mensaje para ti.",
    meta1Fallback: "Entrega 48–72 h",
    meta2: "Video hasta 1 min",
    color: "#b45cff",
  },
  consejo: {
    title: "Consejo personalizado",
    description: "Haz una pregunta y recibe una respuesta personalizada.",
    meta1Fallback: "Entrega 3–5 días",
    meta2: "Respuesta por escrito",
    color: "#f7c948",
  },
  meet_greet_digital: {
    title: "Encuentro en vivo",
    description: "Videollamada privada uno a uno.",
    meta1Fallback: "Duración 30 minutos",
    meta2: "Plataforma Google Meet",
    color: "#45b8ff",
  },
  clase_personalizada: {
    title: "Sesión exclusiva",
    description: "Experiencia 1 a 1 diseñada especialmente para ti.",
    meta1Fallback: "Duración 60 minutos",
    meta2: "Totalmente personalizada",
    color: "#f472b6",
  },
};

function getMeta1(service: CreatorService): string {
  const conf = CONFIG[service.type];
  if (!conf) return "";
  if (service.type === "meet_greet_digital") {
    const dur = service.meta?.meetGreet?.durationMinutes;
    return dur ? `Duración ${dur} minutos` : conf.meta1Fallback;
  }
  if (service.type === "clase_personalizada") {
    const dur = service.meta?.customClass?.durationMinutes;
    return dur ? `Duración ${dur} minutos` : conf.meta1Fallback;
  }
  return conf.meta1Fallback;
}

function formatPrice(service: CreatorService): {
  hasPrice: boolean;
  numberPart: string;
  currencyCode: string;
} {
  const price =
    service.publicPrice ??
    service.memberPrice ??
    (service as CreatorService & { price?: number | null }).price ??
    null;
  const currency = service.currency ?? "MXN";
  if (typeof price !== "number")
    return { hasPrice: false, numberPart: "Precio por confirmar", currencyCode: "" };
  try {
    return {
      hasPrice: true,
      numberPart: new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(price),
      currencyCode: currency,
    };
  } catch {
    return { hasPrice: true, numberPart: `$${price}`, currencyCode: currency };
  }
}

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
          Experiencias con {creatorName}
        </h2>
        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.50)",
            margin: "5px 0 0",
            lineHeight: 1.4,
          }}
        >
          Descubre nuevas formas de conectar conmigo.
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
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {activeTypes.map((type) => {
          const conf = CONFIG[type];
          if (!conf) return null;

          const rawService = rawByType.get(type);
          const meta1 = rawService ? getMeta1(rawService) : conf.meta1Fallback;
          const meta2 = conf.meta2;
          const priceData = rawService
            ? formatPrice(rawService)
            : { hasPrice: false, numberPart: "Precio por confirmar", currencyCode: "" };
          const href = buildHref(type, contextType, groupId, creatorHandle);
          if (href === "#") return null;

          return (
            <Link
              key={type}
              href={href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 16px",
                borderRadius: 16,
                background: type === "consejo"
                  ? "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/consejo.png') center 60%/cover no-repeat"
                  : type === "clase_personalizada"
                  ? "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/sesionexclusiva.png') center 75%/cover no-repeat"
                  : type === "meet_greet_digital"
                  ? "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/encuentroenvivo.png') center 60%/cover no-repeat"
                  : type === "saludo"
                  ? "linear-gradient(rgba(11,11,15,0.80), rgba(11,11,15,0.80)), url('/saludo.png') center 32%/cover no-repeat"
                  : "linear-gradient(135deg, #0f0f13 0%, #0b0b0f 100%)",
                border: "none",
                boxShadow: `0 2px 20px rgba(0,0,0,0.38), 0 0 0 1px ${conf.color}10`,
                textDecoration: "none",
                color: "#fff",
              }}
            >
              {/* Icon circle placeholder */}
              {type === "saludo" ? (
                <img
                  src="/avatarsaludo.png"
                  alt=""
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: "50%",
                    flexShrink: 0,
                    objectFit: "cover",
                    border: `1.5px solid ${conf.color}`,
                    boxShadow: `0 0 14px ${conf.color}2e`,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: "50%",
                    flexShrink: 0,
                    border: `1.5px solid ${conf.color}`,
                    boxShadow: `0 0 14px ${conf.color}2e`,
                    background: "rgba(0,0,0,0.45)",
                  }}
                />
              )}

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
                    Consíguelo por
                  </span>
                )}
                {priceData.hasPrice ? (
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
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 400,
                        color: conf.color,
                      }}
                    >
                      {priceData.currencyCode}
                    </span>
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
              <div className="exp-chevron" style={{ flexShrink: 0, color: "#fff", alignSelf: "center" }}>
                <ChevronRight />
              </div>
            </Link>
          );
        })}
      </div>

    </div>
  );
}
