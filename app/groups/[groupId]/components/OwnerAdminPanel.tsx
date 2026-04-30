"use client";

import { useMemo } from "react";
import OwnerAdminGeneral from "./owner-admin-panel/OwnerAdminGeneral";
import OwnerAdminStatus from "./owner-admin-panel/OwnerAdminStatus";
import type { GroupVisibility } from "@/types/group";

type Visibility = GroupVisibility | null;
type PostingMode = "members" | "owner_only";

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

  currentPostingMode?: PostingMode;
  currentCommentsEnabled?: boolean;
};

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

  currentPostingMode = "members",
  currentCommentsEnabled = true,
}: Props) {
  const isOwner = useMemo(() => {
    return !!ownerId && !!currentUserId && ownerId === currentUserId;
  }, [ownerId, currentUserId]);

  if (!isOwner) return null;

  void currentAvatarUrl;
  void currentCoverUrl;

  const shellStyle: React.CSSProperties = {
    display: "grid",
    gap: 12,
    width: "100%",
    minWidth: 0,
  };

  const titleStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.2,
    color: "#fff",
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
      <h3 style={titleStyle}>Configuración general</h3>

      <div style={panelStyle}>
        <div style={{ display: "grid", gap: 12 }}>
          <OwnerAdminStatus
            groupId={groupId}
            ownerId={ownerId}
            currentUserId={currentUserId}
            currentPostingMode={currentPostingMode}
            currentCommentsEnabled={currentCommentsEnabled}
          />

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
        </div>
      </div>
    </section>
  );
}