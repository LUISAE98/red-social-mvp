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
      return "Solicitar saludo";
    case "consejo":
      return "Solicitar consejo";
    case "meet_greet_digital":
      return "Agendar encuentro";
    case "clase_personalizada":
      return "Reservar sesión exclusiva";
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
      return "🤝";
    case "clase_personalizada":
      return "👑";
    default:
      return "✨";
  }
}

function getServiceAccent(type: CreatorServiceType): string {
  switch (type) {
    case "saludo":
      return "#7DD3FC";
    case "consejo":
      return "#FACC15";
    case "meet_greet_digital":
      return "#A78BFA";
    case "clase_personalizada":
      return "#F472B6";
    default:
      return "#FFFFFF";
  }
}

function canRenderAction(params: {
  service: NormalizedService;
  contextType: "group" | "profile";
  viewerMembershipStatus?: ViewerMembershipStatus;
  viewerCanRequest?: boolean;
}) {
  const { service, contextType, viewerMembershipStatus, viewerCanRequest } =
    params;

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

  if (contextType === "group" && groupId) {
    return `/groups/${groupId}?service=${service.type}`;
  }

  if (contextType === "profile" && creatorHandle) {
    return `/u/${creatorHandle}?service=${service.type}`;
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

  const allowedServices = visibleServices
    .filter((service) =>
      ["saludo", "consejo", "meet_greet_digital", "clase_personalizada"].includes(
        service.type
      )
    )
    .filter((service) =>
      canRenderAction({
        service,
        contextType,
        viewerMembershipStatus,
        viewerCanRequest,
      })
    );

  if (allowedServices.length === 0) return null;

  return (
    <nav
      className={className}
      aria-label="Servicios del creador"
      style={{
        width: "100%",
        display: "flex",
        justifyContent: "center",
        padding: "4px 0 2px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
          gap: "clamp(14px, 4vw, 28px)",
          flexWrap: "wrap",
        }}
      >
        {allowedServices.map((service) => {
          const href = buildHref({
            service,
            contextType,
            groupId,
            creatorHandle,
          });

          return (
            <Link
              key={`${contextType}-${profileUid ?? "no-profile"}-${
                groupId ?? "no-group"
              }-${service.type}`}
              href={href}
              aria-label={getServiceLabel(service.type)}
              style={{
                width: "clamp(68px, 18vw, 96px)",
                color: "#fff",
                textDecoration: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 7,
                textAlign: "center",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: "clamp(48px, 13vw, 64px)",
                  height: "clamp(48px, 13vw, 64px)",
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: "#000",
                  border: `2.5px solid ${getServiceAccent(service.type)}`,
                  fontSize: "clamp(21px, 5vw, 28px)",
                  lineHeight: 1,
                  boxShadow: `0 8px 24px rgba(0,0,0,0.32), 0 0 18px ${getServiceAccent(
  service.type
)}33`,
                }}
              >
                {getServiceIcon(service.type)}
              </span>

              <span
                style={{
                  maxWidth: "100%",
                  fontSize: "clamp(10.5px, 2.8vw, 12px)",
                  fontWeight: 700,
                  lineHeight: 1.15,
                  color: "rgba(255,255,255,0.92)",
                  textWrap: "balance",
                }}
              >
                {getServiceLabel(service.type)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}