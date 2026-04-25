"use client";

import React from "react";
import Link from "next/link";
import type { CreatorServiceType } from "@/types/group";
import {
  getVisibleServices,
  type NormalizedService,
} from "@/lib/services/normalizeServices";

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
  services: any[] | null | undefined;
  contextType: "group" | "profile";
  groupId?: string | null;
  profileUid?: string | null;
  creatorHandle?: string | null;
  viewerMembershipStatus?: ViewerMembershipStatus;
  viewerCanRequest?: boolean;
  className?: string;
};

function getServiceLabel(type: CreatorServiceType): string {
  switch (type) {
    case "saludo":
      return "Saludo";
    case "consejo":
      return "Consejo";
    case "meet_greet_digital":
      return "Meet & Greet";
    case "clase_personalizada":
      return "Sesión exclusiva";
    case "mensaje":
      return "Mensaje";
    default:
      return "Servicio";
  }
}

function getServiceIcon(type: CreatorServiceType): string {
  switch (type) {
    case "saludo":
      return "👋";
    case "consejo":
      return "💡";
    case "meet_greet_digital":
      return "🎥";
    case "clase_personalizada":
      return "👑";
    case "mensaje":
      return "✉️";
    default:
      return "👑";
  }
}

function formatPrice(
  service: NormalizedService,
  contextType: "group" | "profile"
): string | null {
  const price =
    contextType === "group" ? service.memberPrice : service.publicPrice;

  if (price == null || !service.currency) return null;

  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: service.currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${service.currency} ${price.toFixed(2)}`;
  }
}

function canRenderAction(params: {
  service: NormalizedService;
  contextType: "group" | "profile";
  viewerMembershipStatus?: ViewerMembershipStatus;
  viewerCanRequest?: boolean;
}) {
  const { service, contextType, viewerMembershipStatus, viewerCanRequest } = params;

  if (!service.enabled || !service.visible) return false;

  if (viewerCanRequest === false) return false;

  if (contextType === "group") {
    if (
      viewerMembershipStatus &&
      viewerMembershipStatus !== "active" &&
      viewerMembershipStatus !== "subscribed"
    ) {
      return false;
    }
  }

  return true;
}

function buildHref(params: {
  service: NormalizedService;
  contextType: "group" | "profile";
  groupId?: string | null;
  creatorHandle?: string | null;
}) {
  const { service, contextType, groupId, creatorHandle } = params;

  if (service.type === "saludo") {
    if (contextType === "group" && groupId) {
      return `/groups/${groupId}?service=saludo`;
    }
    if (contextType === "profile" && creatorHandle) {
      return `/u/${creatorHandle}?service=saludo`;
    }
  }

  if (service.type === "consejo") {
    if (contextType === "group" && groupId) {
      return `/groups/${groupId}?service=consejo`;
    }
    if (contextType === "profile" && creatorHandle) {
      return `/u/${creatorHandle}?service=consejo`;
    }
  }

  if (service.type === "meet_greet_digital") {
    if (contextType === "group" && groupId) {
      return `/groups/${groupId}?service=meet_greet_digital`;
    }
    if (contextType === "profile" && creatorHandle) {
      return `/u/${creatorHandle}?service=meet_greet_digital`;
    }
  }

  if (service.type === "clase_personalizada") {
    if (contextType === "group" && groupId) {
      return `/groups/${groupId}?service=clase_personalizada`;
    }
    if (contextType === "profile" && creatorHandle) {
      return `/u/${creatorHandle}?service=clase_personalizada`;
    }
  }

  if (service.type === "mensaje") {
    if (contextType === "group" && groupId) {
      return `/groups/${groupId}?service=mensaje`;
    }
    if (contextType === "profile" && creatorHandle) {
      return `/u/${creatorHandle}?service=mensaje`;
    }
  }

  if (contextType === "group" && groupId) {
    return `/groups/${groupId}`;
  }

  if (contextType === "profile" && creatorHandle) {
    return `/u/${creatorHandle}`;
  }

  return "#";
}

export default function CreatorServicesMenu({
  services,
  contextType,
  groupId = null,
  profileUid = null,
  creatorHandle = null,
  viewerMembershipStatus = null,
  viewerCanRequest = true,
  className,
}: Props) {
  const visibleServices = getVisibleServices(services);

  const allowedServices = visibleServices.filter((service) =>
    canRenderAction({
      service,
      contextType,
      viewerMembershipStatus,
      viewerCanRequest,
    })
  );

  if (allowedServices.length === 0) return null;

  const wrapperStyle: React.CSSProperties = {
    display: "grid",
    gap: 10,
  };

  const railStyle: React.CSSProperties = {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    paddingBottom: 2,
    scrollbarWidth: "thin",
  };

  const cardStyle: React.CSSProperties = {
    minWidth: 156,
    maxWidth: 190,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    padding: "12px 12px 11px 12px",
    color: "#fff",
    textDecoration: "none",
    display: "grid",
    gap: 8,
    boxSizing: "border-box",
  };

  const topRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  };

  const iconStyle: React.CSSProperties = {
    width: 30,
    height: 30,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,0.08)",
    fontSize: 15,
    flexShrink: 0,
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.15,
    color: "#fff",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const subtitleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 11,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.35,
  };

  const priceStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    lineHeight: 1.2,
  };

  const badgeRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  };

  const badgeStyle: React.CSSProperties = {
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    color: "rgba(255,255,255,0.84)",
    background: "rgba(255,255,255,0.08)",
    lineHeight: 1.1,
  };

  return (
    <div className={className} style={wrapperStyle}>
      <div style={railStyle}>
        {allowedServices.map((service) => {
          const href = buildHref({
            service,
            contextType,
            groupId,
            creatorHandle,
          });

          const priceLabel = formatPrice(service, contextType);
          const sourceLabel =
            contextType === "group" ? "Disponible en comunidad" : "Disponible en perfil";

          return (
            <Link
              key={`${contextType}-${profileUid ?? "no-profile"}-${groupId ?? "no-group"}-${service.type}`}
              href={href}
              style={cardStyle}
            >
              <div style={topRowStyle}>
                <div style={iconStyle}>{getServiceIcon(service.type)}</div>

                <div style={{ minWidth: 0 }}>
                  <p style={titleStyle}>{getServiceLabel(service.type)}</p>
                  <p style={subtitleStyle}>{sourceLabel}</p>
                </div>
              </div>

              <div style={badgeRowStyle}>
                {service.requiresApproval && (
                  <span style={badgeStyle}>Requiere aprobación</span>
                )}
                <span style={badgeStyle}>
                  {contextType === "group" ? "Contexto comunidad" : "Contexto perfil"}
                </span>
              </div>

              <div>
                <p style={priceStyle}>{priceLabel ?? "Precio por definir"}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}