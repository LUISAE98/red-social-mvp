"use client";

import { useMemo, useState } from "react";
import OwnerAdminGeneral from "./owner-admin-panel/OwnerAdminGeneral";
import OwnerAdminServices from "./owner-admin-panel/OwnerAdminServices";
import OwnerAdminStatus from "./owner-admin-panel/OwnerAdminStatus";
import type {
  Currency,
  CreatorServiceType,
  ServiceSourceScope,
  ServiceVisibility,
  CreatorServiceMeta,
  GroupDonationSettings,
  GroupVisibility,
} from "@/types/group";

type Visibility = GroupVisibility | null;
type PostingMode = "members" | "owner_only";

type MonetizationInput = {
  isPaid?: boolean;
  priceMonthly?: number | null;
  currency?: Currency | null;
  subscriptionsEnabled?: boolean;
  paidPostsEnabled?: boolean;
  paidLivesEnabled?: boolean;
  paidVodEnabled?: boolean;
  paidLiveCommentsEnabled?: boolean;
  greetingsEnabled?: boolean;
  adviceEnabled?: boolean;
  customClassEnabled?: boolean;
  digitalMeetGreetEnabled?: boolean;
} | null;

type OfferingInput = {
  type?: CreatorServiceType | string;
  enabled?: boolean;
  visible?: boolean;
  visibility?: ServiceVisibility | string;
  displayOrder?: number | null;
  memberPrice?: number | null;
  publicPrice?: number | null;
  currency?: Currency | null;
  requiresApproval?: boolean;
  sourceScope?: ServiceSourceScope | string;
  meta?: CreatorServiceMeta | null;
  price?: number | null;
} | null;

type DonationInput = Partial<GroupDonationSettings> | null;

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

  void currentAvatarUrl;
  void currentCoverUrl;

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
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.1,
    fontFamily: fontStack,
    transition: "all 160ms ease",
  };

  const activeTabStyle: React.CSSProperties = {
    ...baseTabStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.92)",
  };

  const panelStyle: React.CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 12,
    width: "100%",
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
            currentTags={currentTags}
            currentVisibility={currentVisibility}
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