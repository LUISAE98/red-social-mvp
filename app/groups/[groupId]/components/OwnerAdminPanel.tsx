"use client";

import { useMemo, useState } from "react";
import OwnerAdminGeneral from "./owner-admin-panel/OwnerAdminGeneral";
import OwnerAdminServices from "./owner-admin-panel/OwnerAdminServices";
import OwnerAdminStatus from "./owner-admin-panel/OwnerAdminStatus";
import type {
  Currency,
  CreatorServiceType,
  ServiceSourceScope,
  GroupDonationSettings,
  DonationMode,
  DonationSourceScope,
} from "@/types/group";

type Visibility = "public" | "private" | "hidden" | string | null;
type PostingMode = "members" | "owner_only";

type MonetizationInput = {
  isPaid?: boolean;
  priceMonthly?: number | null;
  currency?: Currency | null;
} | null;

type OfferingInput = {
  type?: CreatorServiceType | string;
  enabled?: boolean;
  visible?: boolean;
  memberPrice?: number | null;
  publicPrice?: number | null;
  currency?: Currency | null;
  requiresApproval?: boolean;
  sourceScope?: ServiceSourceScope | string;
  price?: number | null;
} | null;

type DonationInput = {
  mode?: DonationMode | string;
  enabled?: boolean;
  visible?: boolean;
  currency?: Currency | null;
  sourceScope?: DonationSourceScope | string;
  suggestedAmounts?: number[] | null;
  goalLabel?: string | null;
} | Partial<GroupDonationSettings> | null;

type Props = {
  groupId: string;
  ownerId: string;
  currentUserId: string;

  currentName: string;
  currentDescription: string;
  currentCategory?: string | null;
  currentTags?: string[] | null;
  currentAvatarUrl?: string | null;
  currentCoverUrl?: string | null;
  currentVisibility?: Visibility;

  currentMonetization?: MonetizationInput;
  currentOfferings?: OfferingInput[] | null;
  currentDonation?: DonationInput;

  currentPostingMode?: PostingMode;
  currentCommentsEnabled?: boolean;
};

type AdminTab = "general" | "services" | "status";

export default function OwnerAdminPanel({
  groupId,
  ownerId,
  currentUserId,

  currentName,
  currentDescription,
  currentCategory = null,
  currentTags = [],
  currentAvatarUrl = null,
  currentCoverUrl = null,
  currentVisibility = null,

  currentMonetization = null,
  currentOfferings = [],
  currentDonation = null,

  currentPostingMode = "members",
  currentCommentsEnabled = true,
}: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>("general");

  const isOwner = useMemo(() => {
    return !!ownerId && !!currentUserId && ownerId === currentUserId;
  }, [ownerId, currentUserId]);

  if (!isOwner) return null;

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const shellStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
    width: "100%",
    minWidth: 0,
  };

  const tabsWrapStyle: React.CSSProperties = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  };

  const baseTabStyle: React.CSSProperties = {
    minHeight: 40,
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: fontStack,
    cursor: "pointer",
    transition: "all 160ms ease",
  };

  const activeTabStyle: React.CSSProperties = {
    ...baseTabStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.94)",
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
    minWidth: 0,
  };

  return (
    <section style={shellStyle}>
      <div style={tabsWrapStyle}>
        <button
          type="button"
          onClick={() => setActiveTab("general")}
          style={activeTab === "general" ? activeTabStyle : baseTabStyle}
        >
          General
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("services")}
          style={activeTab === "services" ? activeTabStyle : baseTabStyle}
        >
          Servicios
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("status")}
          style={activeTab === "status" ? activeTabStyle : baseTabStyle}
        >
          Estado
        </button>
      </div>

      <div style={panelStyle}>
        {activeTab === "general" && (
          <OwnerAdminGeneral
            groupId={groupId}
            ownerId={ownerId}
            currentUserId={currentUserId}
            currentName={currentName}
            currentDescription={currentDescription}
            currentCategory={currentCategory}
            currentTags={currentTags ?? []}
            currentAvatarUrl={currentAvatarUrl}
            currentCoverUrl={currentCoverUrl}
          />
        )}

        {activeTab === "services" && (
          <OwnerAdminServices
            groupId={groupId}
            ownerId={ownerId}
            currentUserId={currentUserId}
            currentVisibility={currentVisibility}
            currentMonetization={currentMonetization}
            currentOfferings={currentOfferings ?? []}
            currentDonation={currentDonation}
          />
        )}

        {activeTab === "status" && (
          <OwnerAdminStatus
            groupId={groupId}
            ownerId={ownerId}
            currentUserId={currentUserId}
            currentPostingMode={currentPostingMode}
            currentCommentsEnabled={currentCommentsEnabled}
          />
        )}
      </div>
    </section>
  );
}