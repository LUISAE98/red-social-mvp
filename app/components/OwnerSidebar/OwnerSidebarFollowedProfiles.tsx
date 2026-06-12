"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import type { FollowedProfileLite } from "./OwnerSidebar";
import StoryRingAvatar from "@/app/components/Stories/StoryRingAvatar";

type Props = {
  loadingFollowing: boolean;
  followedProfiles: FollowedProfileLite[];
  styles: Record<string, CSSProperties>;
  onOpenProfile: (handle: string) => void;
  onProfileVisit?: (uid: string) => void;
  isMobile?: boolean;
  currentUserId?: string | null;
};

export default function OwnerSidebarFollowedProfiles({
  loadingFollowing,
  followedProfiles,
  styles,
  onOpenProfile,
  onProfileVisit,
  isMobile = false,
  currentUserId,
}: Props) {
  const pathname = usePathname();

  if (loadingFollowing) {
    return (
      <div style={{ ...styles.sectionPanel, background: "transparent" }}>
        <div style={styles.sectionTitle}>Perfiles seguidos</div>
        <div style={styles.subtle}>Cargando perfiles...</div>
      </div>
    );
  }

  if (followedProfiles.length === 0) {
    return (
      <div style={{ ...styles.sectionPanel, background: "transparent" }}>
        <div style={styles.sectionTitle}>Perfiles seguidos</div>
        <div style={styles.subtle}>Aún no sigues perfiles.</div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.sectionPanel, background: "transparent" }}>
      <div style={styles.sectionHeaderRow}>
        <div style={styles.sectionTitle}>Perfiles seguidos</div>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {followedProfiles.map((profile) => {
          const displayName = profile.displayName || "Usuario";
          const handle = profile.handle;
          const profileHref = `/u/${handle}`;
          const isSelectedProfile = pathname === profileHref;

          return (
            <div
              key={profile.uid}
              style={{
                ...styles.card,
                border: "none",
                margin: 0,
                borderRadius: 16,
                padding: "10px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: !isSelectedProfile
                  ? "transparent"
                  : "linear-gradient(90deg, rgba(236,72,153,0.20) 0%, rgba(147,51,234,0.18) 42%, rgba(59,130,246,0.14) 100%)",
                boxShadow: !isSelectedProfile
                  ? "none"
                  : "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(0,0,0,0.22)",
              }}
            >
              <button
                type="button"
                onClick={() => { onOpenProfile(handle); onProfileVisit?.(profile.uid); }}
                style={{
                  minWidth: 0,
                  flex: 1,
                  border: "none",
                  background: "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  textAlign: "left",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <StoryRingAvatar
                  entityId={profile.uid}
                  entityType="profile"
                  currentUserId={currentUserId}
                  photoURL={profile.photoURL}
                  displayName={displayName}
                  size={isMobile ? 43 : 36}
                />

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 550,
                      letterSpacing: "-0.08px",
                      color: "rgba(255,255,255,0.94)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {displayName}
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: "rgba(255,255,255,0.48)",
                      lineHeight: 1.25,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    @{handle}
                  </div>
                </div>
              </button>

              <CopyLinkButton
                href={profileHref}
                title="Copiar link del perfil"
                style={{
                  flexShrink: 0,
                  marginLeft: "auto",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}