"use client";

import { useSocialRelationship } from "@/lib/social/useSocialRelationship";

type ProfileSocialActionsProps = {
  viewerUid: string | null | undefined;
  profileUid: string;
  profileRestricted: boolean;
};

export default function ProfileSocialActions({
  viewerUid,
  profileUid,
  profileRestricted,
}: ProfileSocialActionsProps) {
  const isOwnProfile = !!viewerUid && viewerUid === profileUid;

  const { relationship, loading, error, follow, unfollow } =
    useSocialRelationship(viewerUid, profileUid);

  if (!viewerUid || isOwnProfile) return null;

  if (relationship.isBlockedBy) return null;

  const showFollowButton =
    !profileRestricted && !relationship.hasBlocked && relationship.canFollow;

  const followButtonLabel = loading
    ? "Procesando..."
    : relationship.isFollowing && relationship.isFollowedBy
      ? "Ambos se siguen"
      : relationship.isFollowing
        ? "Siguiendo"
        : relationship.isFollowedBy
          ? "Seguir también"
          : "Seguir";

  async function handleFollowClick() {
    if (loading) return;
    if (relationship.isFollowing) {
      await unfollow();
      return;
    }
    await follow();
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
    height: 36,
    padding: "0 20px",
    borderRadius: 8,
    border: "none",
    background: "rgba(168,85,255,0.55)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
    whiteSpace: "nowrap",
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
