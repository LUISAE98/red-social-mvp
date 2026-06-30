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

function shortName(name: string): string {
  if (name.length <= 7) return name;
  return name.slice(0, 6) + "...";
}

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

        {showDonateButton && (
          <>
            <style>{`
              .vibraProfileDonateBtn .vibraProfileDonateLabel {
                display: inline-block;
                transition: transform 220ms cubic-bezier(0.4,0,0.2,1);
              }
              .vibraProfileDonateBtn .vibraProfileDonatePlus {
                display: inline-block;
                opacity: 0;
                transform: translateX(0);
                margin-left: 4px;
                font-weight: 700;
                transition: opacity 200ms ease, transform 220ms cubic-bezier(0.4,0,0.2,1);
              }
              @media (min-width: 560px) {
                .vibraProfileDonateBtn:hover .vibraProfileDonateLabel { transform: translateX(-6px); }
                .vibraProfileDonateBtn:hover .vibraProfileDonatePlus { opacity: 1; transform: translateX(-6px); }
                .vibraProfileDonateMobile { display: none !important; }
                .vibraProfileDonateDesktop { display: inline-flex !important; align-items: center; }
              }
              @media (max-width: 559px) {
                .vibraProfileDonateDesktop { display: none !important; }
                .vibraProfileDonateMobile { display: inline !important; }
              }
            `}</style>
            <button
              type="button"
              className="vibraProfileDonateBtn"
              onClick={onDonate}
              style={styles.donateButton}
            >
              <span className="vibraProfileDonateMobile" style={{ display: "none" }}>Donar +</span>
              <span className="vibraProfileDonateDesktop" style={{ display: "inline-flex", alignItems: "center" }}>
                <span className="vibraProfileDonateLabel">
                  {donation?.mode === "wedding"
                    ? `Apoya en su boda a ${profileName ?? ""}`
                    : `Apoya a ${profileName ?? ""}`}
                </span>
                <span className="vibraProfileDonatePlus">+</span>
              </span>
            </button>
          </>
        )}
      </div>

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
    background: "linear-gradient(135deg, #f472b6, #a855f7)",
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

  donateButton: {
    flex: "1 1 140px",
    maxWidth: 260,
    minWidth: 120,
    minHeight: 40,
    borderRadius: 10,
    border: "none",
    background: "#70aefb",
    color: "#fff",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "-0.01em",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "opacity 150ms ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    padding: "0 14px",
  } as const,

  error: {
    width: "100%",
    textAlign: "center",
    color: "rgba(255,150,150,0.95)",
    fontSize: 12,
    marginTop: 2,
  } as const,
};
