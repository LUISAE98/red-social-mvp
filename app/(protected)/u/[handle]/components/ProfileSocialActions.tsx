"use client";

import { useSocialRelationship } from "@/lib/social/useSocialRelationship";

type DonationInput = {
  mode: "none" | "general" | "wedding";
  enabled?: boolean;
  visible?: boolean;
  suggestedAmounts?: number[] | null;
} | null;

type ProfileSocialActionsProps = {
  viewerUid: string | null | undefined;
  profileUid: string;
  profileRestricted: boolean;
  profileName?: string | null;
  donation?: DonationInput;
  onDonate?: () => void;
};

export default function ProfileSocialActions({
  viewerUid,
  profileUid,
  profileRestricted,
  profileName,
  donation,
  onDonate,
}: ProfileSocialActionsProps) {
  const isOwnProfile = !!viewerUid && viewerUid === profileUid;

  const { relationship, loading, error, follow, unfollow } =
    useSocialRelationship(viewerUid, profileUid);

  if (!viewerUid) return null;

  if (!isOwnProfile && relationship.isBlockedBy) return null;

  const showFollowButton =
    !isOwnProfile && !profileRestricted && !relationship.hasBlocked && relationship.canFollow;

  const showDonateButton =
    donation?.enabled === true &&
    donation?.visible !== false &&
    (donation?.mode === "general" || donation?.mode === "wedding") &&
    Array.isArray(donation?.suggestedAmounts) &&
    (donation.suggestedAmounts?.length ?? 0) > 0;

  const followButtonLabel = loading
    ? "Procesando..."
    : relationship.isFollowing && relationship.isFollowedBy
      ? "Ambos se siguen"
      : relationship.isFollowing
        ? "Siguiendo"
        : relationship.isFollowedBy
          ? "Seguir también"
          : "Seguir";

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

      {showDonateButton && (
        <button
          type="button"
          onClick={onDonate}
          style={styles.donateButton}
        >
          {donation?.mode === "wedding"
            ? `Apoya en su boda a ${profileName ?? ""}`
            : `Apoya a ${profileName ?? ""}`}
        </button>
      )}

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles = {
  root: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  } as const,

  followButton: {
    width: 220,
    height: 36,
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(135deg, #f472b6, #a855ff)",
    color: "#fff",
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: "nowrap",
    transition: "opacity 160ms ease",
  } as const,

  donateButton: {
    width: 220,
    height: 36,
    borderRadius: 8,
    border: "none",
    background: "#5cabf9",
    color: "#fff",
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: "nowrap",
    cursor: "pointer",
    transition: "opacity 160ms ease",
  } as const,

  error: {
    width: "100%",
    textAlign: "center",
    color: "rgba(255,150,150,0.95)",
    fontSize: 12,
    marginTop: 2,
  } as const,
};
