"use client";

import React, { useEffect, useMemo, useState } from "react";
import OwnerAdminServices from "./owner-admin-panel/OwnerAdminServices";
import OwnerAdminGeneral from "./owner-admin-panel/OwnerAdminGeneral";
import OwnerAdminStatus from "./owner-admin-panel/OwnerAdminStatus";

type Currency = "MXN" | "USD";
type OwnerAdminViewKey = "services" | "general" | "status";
type PostingMode = "members" | "owner_only";

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;

  currentName?: string | null;
  currentDescription?: string | null;
  currentCategory?: string | null;
  currentTags?: string[] | null;

  currentAvatarUrl?: string | null;
  currentCoverUrl?: string | null;

  currentVisibility?: "public" | "private" | "hidden" | string | null;
  currentMonetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: Currency | null;
  } | null;
  currentOfferings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: Currency | null;
  }> | null;

  currentPostingMode?: PostingMode | string | null;
  currentCommentsEnabled?: boolean | null;
};

export default function OwnerAdminPanel(props: Props) {
  const {
    groupId,
    ownerId,
    currentUserId,
    currentName = "",
    currentDescription = "",
    currentCategory = null,
    currentTags = null,
    currentVisibility = null,
    currentMonetization = null,
    currentOfferings = null,
    currentPostingMode = "members",
    currentCommentsEnabled = true,
  } = props;

  const isOwner = useMemo(
    () => ownerId === currentUserId,
    [ownerId, currentUserId]
  );

  const [activeView, setActiveView] =
    useState<OwnerAdminViewKey>("services");

  useEffect(() => {
    setActiveView("services");
  }, [groupId]);

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const shellStyle: React.CSSProperties = {
    width: "100%",
    marginTop: 14,
    fontFamily: fontStack,
  };

  const cardStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.028)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    color: "#fff",
    overflow: "hidden",
    boxSizing: "border-box",
  };

  const headerStyle: React.CSSProperties = {
    padding: "14px 14px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: "clamp(15px, 1.8vw, 17px)",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: 1.08,
    color: "#fff",
  };

  const subtitleStyle: React.CSSProperties = {
    margin: "4px 0 0 0",
    fontSize: 12,
    color: "rgba(255,255,255,0.64)",
    lineHeight: 1.35,
  };

  const bodyStyle: React.CSSProperties = {
    padding: 12,
    display: "grid",
    gap: 12,
  };

  const tabsRowStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  };

  const tabBaseStyle: React.CSSProperties = {
    minHeight: 34,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "rgba(255,255,255,0.88)",
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: fontStack,
    lineHeight: 1,
    cursor: "pointer",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const tabActiveStyle: React.CSSProperties = {
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.16)",
  };

  function getTabStyle(view: OwnerAdminViewKey): React.CSSProperties {
    return {
      ...tabBaseStyle,
      ...(activeView === view ? tabActiveStyle : {}),
    };
  }

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>Administración de la comunidad</h3>
          <p style={subtitleStyle}>
            Divide la administración en servicios, configuración general y estatus del grupo.
          </p>
        </div>

        <div style={bodyStyle}>
          <div style={tabsRowStyle}>
            <button
              type="button"
              onClick={() => setActiveView("services")}
              style={getTabStyle("services")}
            >
              Servicios
            </button>

            <button
              type="button"
              onClick={() => setActiveView("general")}
              style={getTabStyle("general")}
            >
              Configuración general
            </button>

            <button
              type="button"
              onClick={() => setActiveView("status")}
              style={getTabStyle("status")}
            >
              Estatus del grupo
            </button>
          </div>

          {activeView === "services" && (
            <OwnerAdminServices
              groupId={groupId}
              ownerId={ownerId}
              currentUserId={currentUserId}
              currentVisibility={currentVisibility}
              currentMonetization={currentMonetization}
              currentOfferings={currentOfferings}
            />
          )}

          {activeView === "general" && (
            <OwnerAdminGeneral
              groupId={groupId}
              ownerId={ownerId}
              currentUserId={currentUserId}
              currentName={currentName}
              currentDescription={currentDescription}
              currentCategory={currentCategory}
              currentTags={currentTags}
            />
          )}

          {activeView === "status" && (
            <OwnerAdminStatus
              groupId={groupId}
              ownerId={ownerId}
              currentUserId={currentUserId}
              currentPostingMode={currentPostingMode}
              currentCommentsEnabled={currentCommentsEnabled}
            />
          )}
        </div>
      </div>
    </div>
  );
}