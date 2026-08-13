"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import type { FollowedProfileLite } from "./OwnerSidebar";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";

type Props = {
  loadingFollowing: boolean;
  followedProfiles: FollowedProfileLite[];
  styles: Record<string, CSSProperties>;
  onOpenProfile: (handle: string) => void;
  onProfileVisit?: (uid: string) => void;
  isMobile?: boolean;
  currentUserId?: string | null;
  newPostsCounts?: Record<string, number>;
};

export default function OwnerSidebarFollowedProfiles({
  loadingFollowing,
  followedProfiles,
  styles,
  onOpenProfile,
  onProfileVisit,
  isMobile = false,
  currentUserId,
  newPostsCounts,
}: Props) {
  const tCommon = useTranslations("common");
  const pathname = usePathname();

  if (loadingFollowing) {
    return (
      <div style={{ ...styles.sectionPanel, background: "transparent", padding: 0 }}>
        <div style={styles.subtle}>{tCommon("loadingProfiles")}</div>
      </div>
    );
  }

  if (followedProfiles.length === 0) {
    return (
      <div style={{ ...styles.sectionPanel, background: "transparent", padding: 0 }}>
        <div style={styles.subtle}>{tCommon("noFollowedProfiles")}</div>
      </div>
    );
  }

  return (
    <div style={{ ...styles.sectionPanel, background: "transparent", padding: 0 }}>
      <div style={{ display: "grid", gap: 6 }}>
        {followedProfiles.map((profile) => {
          const displayName = profile.displayName || tCommon("user");
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
                  textAlign: "start",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <LiveRingAvatar
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
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
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
                    </span>
                    {(newPostsCounts?.[profile.uid] ?? 0) > 0 && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#a855f7",
                          fontWeight: 700,
                          lineHeight: 1.25,
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {tCommon("newPostsCount", { count: newPostsCounts![profile.uid] })}
                      </span>
                    )}
                  </div>
                </div>
              </button>

              <CopyLinkButton
                href={profileHref}
                title={tCommon("copyProfileLink")}
                style={{
                  flexShrink: 0,
                  marginInlineStart: "auto",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}