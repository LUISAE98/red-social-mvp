"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSocialRelationship } from "@/lib/social/useSocialRelationship";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import ConversationPanel from "@/components/chat/ConversationPanel";
import { getConversationId } from "@/lib/chat/chatService";
import { DEFAULT_MESSAGE_POLICY, type MessagePolicy } from "@/lib/chat/types";

type ProfileSocialActionsProps = {
  viewerUid: string | null | undefined;
  profileUid: string;
  profileRestricted: boolean;
  profileName?: string | null;
  profileHandle?: string | null;
  profilePhotoURL?: string | null;
  /** Política de recepción de DM del perfil visitado. */
  profileMessagePolicy?: MessagePolicy;
};


export default function ProfileSocialActions({
  viewerUid,
  profileUid,
  profileRestricted,
  profileName,
  profileHandle,
  profilePhotoURL,
  profileMessagePolicy = DEFAULT_MESSAGE_POLICY,
}: ProfileSocialActionsProps) {
  const tCommon = useTranslations("common");
  const tFeed = useTranslations("feed");
  const tProfile = useTranslations("profile");
  const tChat = useTranslations("chat");
  const isOwnProfile = !!viewerUid && viewerUid === profileUid;
  const [messagePanelOpen, setMessagePanelOpen] = useState(false);

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

  // El botón se oculta cuando esta persona no puede recibirme un mensaje. Es
  // más honesto que mostrarlo y que las rules lo rechacen al enviar.
  //
  // Ojo con la dirección: la política es de ELLA. "a quien sigo" significa "a
  // quien ELLA sigue", que desde aquí es `isFollowedBy` (ella me sigue a mí).
  // Y "a quien me sigue" es `isFollowing` (yo la sigo).
  const policyAllowsMessage =
    profileMessagePolicy === "everyone" ||
    (profileMessagePolicy === "following" && relationship.isFollowedBy) ||
    (profileMessagePolicy === "following_and_followers" &&
      (relationship.isFollowedBy || relationship.isFollowing));

  const showMessageButton =
    !isOwnProfile &&
    !relationship.hasBlocked &&
    !relationship.isBlockedBy &&
    policyAllowsMessage;

  const conversationId = viewerUid ? getConversationId(viewerUid, profileUid) : null;

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

      {showMessageButton && (
        <div style={styles.buttonsRow}>
          <button
            type="button"
            onClick={() => setMessagePanelOpen(true)}
            style={styles.messageButton}
          >
            {tChat("sendMessageAction")}
          </button>
        </div>
      )}

      {showMessageButton && (
        <ConversationPanel
          open={messagePanelOpen}
          onClose={() => setMessagePanelOpen(false)}
          conversationId={conversationId}
          otherUid={profileUid}
          profile={{
            uid: profileUid,
            displayName: profileName ?? "",
            handle: profileHandle ?? null,
            photoURL: profilePhotoURL ?? null,
          }}
          selfUid={viewerUid ?? null}
        />
      )}

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

  // Mismo tamaño y forma que "Seguir", pero neutro: seguir es la acción
  // primaria del perfil, escribir es secundaria.
  messageButton: {
    flex: "1 1 140px",
    maxWidth: 260,
    minWidth: 120,
    minHeight: 40,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.94)",
    fontFamily: "inherit",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: "-0.01em",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    transition: "background 150ms ease",
    padding: "0 14px",
  } as const,
};
