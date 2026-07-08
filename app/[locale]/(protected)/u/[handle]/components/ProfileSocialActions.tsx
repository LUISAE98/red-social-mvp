"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";

type ProfileSocialActionsProps = {
  viewerUid: string | null | undefined;
  profileUid: string;
  profileRestricted: boolean;
  profileName?: string | null;
};


export default function ProfileSocialActions({
  viewerUid,
  profileUid,
  profileRestricted,
  profileName,
}: ProfileSocialActionsProps) {
  const tCommon = useTranslations("common");
  const tFeed = useTranslations("feed");
  const tProfile = useTranslations("profile");
  const isOwnProfile = !!viewerUid && viewerUid === profileUid;

  const { relationship, loading, error, follow, unfollow } =
    useSocialRelationship(viewerUid, profileUid);
  const { toast: socialToast, showToast: showSocialToast } = useVibraToast();

  useEffect(() => {
    if (error) showSocialToast(error, "error");
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!viewerUid) return null;

  if (!isOwnProfile && relationship.isBlockedBy) return null;

  const showFollowButton =
    !isOwnProfile && !profileRestricted && !relationship.hasBlocked && relationship.canFollow;

  const followButtonLabel = loading
    ? tFeed("processing")
    : relationship.isFollowing && relationship.isFollowedBy
      ? tProfile("mutualFollow")
      : relationship.isFollowing
        ? tProfile("followingLabel")
        : relationship.isFollowedBy
          ? tProfile("followMutual")
          : tCommon("follow");

  function handleFollowClick() {
    if (loading) return;
    if (relationship.isFollowing) {
      unfollow();
      return;
    }
    follow();
  }

  return (
    <div style={styles.root}>
      <div style={styles.buttonsRow}>
        {showFollowButton && (
          <button
            type="button"
            onClick={handleFollowClick}
            disabled={loading}
            style={{
              ...styles.followButton,
              opacity: loading ? 0.65 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {followButtonLabel}
          </button>
        )}

      </div>

      <VibraToast toast={socialToast} />
    </div>
  );
}

const styles = {
  root: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
  } as const,

  buttonsRow: {
    width: "100%",
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 14,
  } as const,

  followButton: {
    flex: "1 1 140px",
    maxWidth: 260,
    minWidth: 120,
    minHeight: 40,
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, #ec4899, #9333ea)",
    color: "#fff",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "-0.01em",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "opacity 150ms ease",
    padding: "0 14px",
  } as const,

};
