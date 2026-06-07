"use client";

import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import type { FollowedProfileLite } from "./OwnerSidebar";

type Props = {
  loadingFollowing: boolean;
  followedProfiles: FollowedProfileLite[];
  styles: Record<string, CSSProperties>;
  getInitials: (name?: string | null) => string;
  onOpenProfile: (handle: string) => void;
};

export default function OwnerSidebarFollowedProfiles({
  loadingFollowing,
  followedProfiles,
  styles,
  getInitials,
  onOpenProfile,
}: Props) {
  const pathname = usePathname();

  if (loadingFollowing) {
    return (
      <div style={styles.sectionPanel}>
        <div style={styles.sectionTitle}>Perfiles seguidos</div>
        <div style={styles.subtle}>Cargando perfiles...</div>
      </div>
    );
  }

  if (followedProfiles.length === 0) {
    return (
      <div style={styles.sectionPanel}>
        <div style={styles.sectionTitle}>Perfiles seguidos</div>
        <div style={styles.subtle}>Aún no sigues perfiles.</div>
      </div>
    );
  }

  return (
    <div style={styles.sectionPanel}>
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
                onClick={() => onOpenProfile(handle)}
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
                {profile.photoURL ? (
                  <img
                    src={profile.photoURL}
                    alt={displayName}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "1px solid rgba(255,255,255,0.10)",
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.06)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      color: "#fff",
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(displayName)}
                  </div>
                )}

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