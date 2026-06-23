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
          <span>
            {donation?.mode === "wedding"
              ? `Apoya en su boda a ${profileName ?? ""}`
              : `Apoya a ${profileName ?? ""}`}
          </span>
          <svg width="28" height="28" viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
            <path
              d="M39 24C36 21 27 17.5 27 12C27 7.5 31 5.5 35 7.5C37 8.5 38.5 10.5 39 12C39.5 10.5 41 8.5 43 7.5C47 5.5 51 7.5 51 12C51 17.5 42 21 39 24Z"
              fill="currentColor"
            />
            <path
              d="M8.5 39.5L17 35L25 50.5L16.5 55Z"
              fill="currentColor" stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round"
            />
            <path
              d="M18 36.5L27.5 31.5C30 30.2 32.1 30.4 34.7 31.3L43.8 34.5C46.1 35.3 46.9 37.8 45.6 39.5C44.7 40.7 43.1 41.2 41.5 40.8L33.5 38.7"
              stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round"
            />
            <path
              d="M28.5 48.5H38.5C40.2 48.5 41.6 48.1 43 47.2L56 38.7C58.1 37.3 58.7 34.9 57.5 33.2C56.3 31.6 54 31.3 51.9 32.5L43.5 37.4"
              stroke="currentColor" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
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
    height: 40,
    borderRadius: 10,
    border: "none",
    background: "linear-gradient(135deg, #f472b6, #a855f7)",
    color: "#fff",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "opacity 150ms ease",
  } as const,

  donateButton: {
    width: 220,
    height: 40,
    borderRadius: 10,
    border: "none",
    background: "#60a5fa",
    color: "#fff",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "-0.01em",
    whiteSpace: "nowrap",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "opacity 150ms ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  } as const,

  error: {
    width: "100%",
    textAlign: "center",
    color: "rgba(255,150,150,0.95)",
    fontSize: 12,
    marginTop: 2,
  } as const,
};
