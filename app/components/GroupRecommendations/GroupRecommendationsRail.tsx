"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { isDisplayCurrency } from "@/lib/currency/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Post } from "@/lib/posts/types";

const LiveViewerModal = dynamic(
  () => import("@/app/components/LiveViewerModal/LiveViewerModal"),
  { ssr: false }
);
import { joinGroup } from "@/lib/groups/membership";
import { requestToJoin } from "@/lib/groups/joinRequests";
import { followUser } from "@/lib/social/social-service";
import {
  GROUP_CATEGORY_LABELS,
  GROUP_CATEGORY_OPTIONS,
  type CanonicalGroupCategory,
  type Group,
} from "@/types/group";
import {
  completeRecommendationsOnboarding,
  fetchRecommendedGroupsForUser,
  fetchRecommendedProfilesForUser,
  getCachedResult,
  invalidateRecommendationCache,
  onRecommendationCacheInvalidated,
  recommendationEngineConstants,
  trackGroupRecommendationSignalFromGroup,
} from "./recommendation-engine";
import type {
  RailItem,
  RecommendationFetchResult,
  RecommendationGroupCard,
  RecommendationJoinState,
  RecommendationProfileCard,
  RecommendationRailContext,
} from "./types";

// Module-level profile cache — survives navigation in the same tab
type ProfileCacheEntry = { profiles: RecommendationProfileCard[]; cachedAt: number };
const profileCache = new Map<string, ProfileCacheEntry>();
const PROFILE_CACHE_TTL_MS = 90_000;

function peekProfiles(uid: string): RecommendationProfileCard[] | null {
  const e = profileCache.get(uid);
  if (!e || Date.now() - e.cachedAt > PROFILE_CACHE_TTL_MS) return null;
  return e.profiles;
}

type Props = {
  currentUserId: string;
  context: RecommendationRailContext;
  title?: string;
  subtitle?: string;
  emptySearchTerm?: string;
  onCreateGroup?: () => void;
  className?: string;
};

const fontStack =
  'inherit';

const cardStyles = {
  position: "relative" as const,
  minWidth: 200,
  maxWidth: 200,
  flexShrink: 0,
  scrollSnapAlign: "start" as const,
  color: "#fff",
};

async function resolveJoinState(
  groupId: string,
  userId: string,
  visibility: Group["visibility"]
): Promise<RecommendationJoinState> {
  const memberSnap = await getDoc(doc(db, "groups", groupId, "members", userId));
  if (memberSnap.exists()) return "joined";

  if (visibility === "private") {
    const requestSnap = await getDoc(
      doc(db, "groups", groupId, "joinRequests", userId)
    );
    if (requestSnap.exists()) return "pending";
    return "request";
  }

  return "join";
}

function getRecommendationMonetization(
  group: RecommendationGroupCard
): Record<string, unknown> | null {
  const candidate = (group as RecommendationGroupCard & {
    monetization?: unknown;
  }).monetization;

  if (!candidate || typeof candidate !== "object") return null;
  return candidate as Record<string, unknown>;
}

function resolveSubscriptionEnabled(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);
  return (
    monetization?.subscriptionsEnabled === true ||
    monetization?.isPaid === true
  );
}

function resolveSubscriptionPrice(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);

  const subscriptionPrice = monetization?.subscriptionPriceMonthly;
  if (typeof subscriptionPrice === "number" && Number.isFinite(subscriptionPrice)) {
    return subscriptionPrice;
  }

  const legacyPrice = monetization?.priceMonthly;
  return typeof legacyPrice === "number" && Number.isFinite(legacyPrice)
    ? legacyPrice
    : null;
}

function resolveSubscriptionCurrency(group: RecommendationGroupCard) {
  const monetization = getRecommendationMonetization(group);

  const subscriptionCurrency = monetization?.subscriptionCurrency;
  if (typeof subscriptionCurrency === "string") {
    return subscriptionCurrency;
  }

  const legacyCurrency = monetization?.currency;
  return typeof legacyCurrency === "string" ? legacyCurrency : null;
}

function GroupCategoryPill({
  label,
  selected,
  onToggle,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        border: selected
          ? "1px solid rgba(255,255,255,0.9)"
          : "1px solid rgba(255,255,255,0.10)",
        background: selected ? "#ffffff" : "rgba(42, 42, 46, 0.95)",
        color: selected ? "#08111d" : "#ffffff",
        borderRadius: 999,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: fontStack,
      }}
    >
      {label}
    </button>
  );
}

function JoinButton({
  state,
  onClick,
  loading,
  isPaidSubscriptionPrivate,
}: {
  state: RecommendationJoinState;
  onClick: () => void;
  loading: boolean;
  isPaidSubscriptionPrivate: boolean;
}) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");

  const label =
    state === "joined"
      ? tGroups("joined")
      : state === "pending"
        ? tGroups("requestSent")
        : state === "request"
          ? isPaidSubscriptionPrivate
            ? tGroups("subscribe")
            : tGroups("requestAccess")
          : tGroups("join");

  const isInactive = loading || state === "joined" || state === "pending";
  const isPaid = !isInactive && state === "request" && isPaidSubscriptionPrivate;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isInactive}
      style={{
        width: "100%",
        borderRadius: 10,
        padding: "10px 12px",
        border: isInactive ? "1px solid rgba(255,255,255,0.18)" : "none",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: "-0.01em",
        cursor: isInactive ? "default" : "pointer",
        background: isInactive
          ? "rgba(255,255,255,0.14)"
          : isPaid
            ? "#70aefb"
            : "linear-gradient(135deg, #ec4899, #9333ea)",
        color: isInactive ? "rgba(255,255,255,0.70)" : "#fff",
        fontFamily: fontStack,
        backdropFilter: isInactive ? "blur(12px)" : "none",
        WebkitBackdropFilter: isInactive ? "blur(12px)" : "none",
        transition: "opacity 150ms ease",
      }}
    >
      {loading ? tCommon("processing") : label}
    </button>
  );
}

function FollowButton({
  isFollowing,
  onClick,
  loading,
}: {
  isFollowing: boolean;
  onClick: () => void;
  loading: boolean;
}) {
  const tCommon = useTranslations("common");
  const isInactive = loading || isFollowing;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isInactive}
      style={{
        width: "100%",
        borderRadius: 10,
        padding: "10px 12px",
        border: isInactive ? "1px solid rgba(255,255,255,0.18)" : "none",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: "-0.01em",
        cursor: isInactive ? "default" : "pointer",
        background: isInactive
          ? "rgba(255,255,255,0.14)"
          : "linear-gradient(135deg, #ec4899, #9333ea)",
        color: isInactive ? "rgba(255,255,255,0.70)" : "#fff",
        fontFamily: fontStack,
        backdropFilter: isInactive ? "blur(12px)" : "none",
        WebkitBackdropFilter: isInactive ? "blur(12px)" : "none",
        transition: "opacity 150ms ease",
      }}
    >
      {loading ? tCommon("processing") : isFollowing ? tCommon("unfollow") : tCommon("follow")}
    </button>
  );
}

function ProfileCard({
  profile,
  isFollowing,
  loading,
  onFollow,
  currentUserId,
}: {
  profile: RecommendationProfileCard;
  isFollowing: boolean;
  loading: boolean;
  onFollow: () => void;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const tGroups = useTranslations("groups");
  const followersLabel =
    profile.followersCount > 0
      ? `${profile.followersCount.toLocaleString()} ${
          profile.followersCount === 1 ? tGroups("follower") : tGroups("followers")
        }`
      : "";

  return (
    <div style={cardStyles}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 11",
          borderRadius: 20,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow:
            "0 24px 52px rgba(0,0,0,0.42), 0 6px 16px rgba(0,0,0,0.28)",
          transform: "translateZ(0)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: profile.coverUrl
              ? `url(${profile.coverUrl}) center / cover no-repeat`
              : "linear-gradient(135deg, #1a1a20 0%, #26262e 55%, #111116 100%)",
            transform: "scale(1.01)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 28%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0.90) 80%, rgba(0,0,0,0.97) 100%)",
          }}
        />
        {/* Avatar con aro de historias — fuera del Link para evitar button dentro de <a> */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
            filter: "drop-shadow(0 8px 22px rgba(0,0,0,0.50))",
          }}
        >
          <LiveRingAvatar
            entityId={profile.uid}
            entityType="profile"
            currentUserId={currentUserId}
            photoURL={profile.avatarUrl}
            displayName={profile.displayName}
            size={68}
            onClick={() => router.push(`/u/${profile.handle}`)}
          />
        </div>

        <Link
          href={`/u/${profile.handle}`}
          style={{
            position: "absolute",
            inset: 0,
            bottom: 60,
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "14px 12px 0",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {/* Spacer que ocupa el lugar del avatar para mantener el layout del texto */}
          <div style={{ width: 68, height: 68, flexShrink: 0 }} />
          <div
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingBottom: 6,
            }}
          >
            <strong
              style={{
                fontSize: 14,
                lineHeight: 1.18,
                color: "#fff",
                maxWidth: "100%",
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
                fontFamily: fontStack,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                flexShrink: 0,
              }}
            >
              {profile.displayName}
            </strong>
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.72)",
                fontFamily: fontStack,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {`@${profile.handle}`}
            </div>
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.52)",
                fontFamily: fontStack,
                fontWeight: 400,
                flexShrink: 0,
              }}
            >
              {followersLabel}
            </div>
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.88)",
                fontFamily: fontStack,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {profile.hasActiveServices ? tGroups("offersServices") : ""}
            </div>
          </div>
        </Link>
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            zIndex: 2,
          }}
        >
          <FollowButton
            isFollowing={isFollowing}
            onClick={onFollow}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}

function GroupCard({
  group,
  joinState,
  loading,
  onJoin,
  currentUserId,
}: {
  group: RecommendationGroupCard;
  joinState: RecommendationJoinState;
  loading: boolean;
  onJoin: () => void;
  currentUserId: string | null;
}) {
  const tGroups = useTranslations("groups");
  const { format: formatMoney } = usePriceFormat();
  const router = useRouter();
  const categoryLabel = group.category
    ? GROUP_CATEGORY_LABELS[group.category]
    : tGroups("noCategory");

  const visibilityLabel =
    group.visibility === "public"
      ? tGroups("publicLabel")
      : group.visibility === "private"
        ? tGroups("privateLabel")
        : tGroups("hiddenLabel");

  const isPaidSubscriptionPrivate =
    group.visibility === "private" && resolveSubscriptionEnabled(group);

  const subscriptionPrice = isPaidSubscriptionPrivate
    ? resolveSubscriptionPrice(group)
    : null;
  const subscriptionCurrency = resolveSubscriptionCurrency(group);
  const subscriptionPriceLabel =
    subscriptionPrice != null
      ? formatMoney(subscriptionPrice, {
          baseCurrency: isDisplayCurrency(subscriptionCurrency)
            ? subscriptionCurrency
            : "MXN",
          code: true,
        })
      : null;

  return (
    <div style={cardStyles}>
      {/* Cover card — the card IS the image, no gray wrapper */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 11",
          borderRadius: 20,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow:
            "0 24px 52px rgba(0,0,0,0.42), 0 6px 16px rgba(0,0,0,0.28)",
          transform: "translateZ(0)",
        }}
      >
        {/* Cover image / gradient background */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: group.coverUrl
              ? `url(${group.coverUrl}) center / cover no-repeat`
              : "linear-gradient(135deg, #1a1a20 0%, #26262e 55%, #111116 100%)",
            transform: "scale(1.01)",
          }}
        />

        {/* Gradient overlay — stronger at the bottom for text + button legibility */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 28%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0.90) 80%, rgba(0,0,0,0.97) 100%)",
          }}
        />

        {/* Avatar con aro de historias — fuera del Link para evitar button dentro de <a> */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
            filter: "drop-shadow(0 8px 22px rgba(0,0,0,0.50))",
          }}
        >
          <LiveRingAvatar
            entityId={group.id}
            entityType="group"
            currentUserId={currentUserId}
            photoURL={group.avatarUrl}
            displayName={group.name}
            size={68}
            onClick={() => router.push(`/groups/${group.id}`)}
          />
        </div>

        {/* Navigable area — full card minus button zone */}
        <Link
          href={`/groups/${group.id}`}
          style={{
            position: "absolute",
            inset: 0,
            bottom: 60,
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "14px 12px 0",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          {/* Spacer que ocupa el lugar del avatar para mantener el layout del texto */}
          <div style={{ width: 68, height: 68, flexShrink: 0 }} />

          {/* Name + meta — tight gap below avatar */}
          <div
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingBottom: 6,
            }}
          >
            {/* Name — max 2 lines, natural height */}
            <strong
              style={{
                fontSize: 14,
                lineHeight: 1.18,
                color: "#fff",
                maxWidth: "100%",
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
                fontFamily: fontStack,
                fontWeight: 700,
                letterSpacing: "-0.01em",
                flexShrink: 0,
              }}
            >
              {group.name}
            </strong>

            {/* Visibility — always 1 line tall */}
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.72)",
                fontFamily: fontStack,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {visibilityLabel}
            </div>

            {/* Category — always 1 line tall */}
            <div
              style={{
                marginTop: 3,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.52)",
                fontFamily: fontStack,
                fontWeight: 400,
                flexShrink: 0,
              }}
            >
              {categoryLabel}
            </div>

            {/* Price — always 1 line tall, empty when free */}
            <div
              style={{
                marginTop: 4,
                fontSize: 11,
                lineHeight: "14px",
                height: 14,
                overflow: "hidden",
                color: "rgba(255,255,255,0.88)",
                fontFamily: fontStack,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {subscriptionPriceLabel ? `${subscriptionPriceLabel} ${tGroups("perMonth")}` : ""}
            </div>
          </div>
        </Link>

        {/* Join button — floats at the bottom of the card, above the Link */}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            zIndex: 2,
          }}
        >
          <JoinButton
            state={joinState}
            onClick={onJoin}
            loading={loading}
            isPaidSubscriptionPrivate={isPaidSubscriptionPrivate}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Live Recommendations ────────────────────────────────────────────────────

type LiveRec = {
  postId: string;
  authorId: string;
  groupId: string | null;
  liveCoverUrl: string | null;
  liveTitle: string | null;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  handle?: string | null;
  groupVisibility?: string | null;
  subscriptionEnabled?: boolean;
};

type LiveActionState = "none" | "following" | "joined" | "pending";

function LiveCTAButton({
  rec,
  state,
  loading,
  onClick,
}: {
  rec: LiveRec;
  state: LiveActionState;
  loading: boolean;
  onClick: () => void;
}) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");

  let label: string;
  if (rec.groupId) {
    if (state === "joined") label = tGroups("joined");
    else if (state === "pending") label = tGroups("requestSent");
    else if (rec.groupVisibility === "private" && rec.subscriptionEnabled) label = tGroups("subscribe");
    else if (rec.groupVisibility === "private") label = tGroups("requestAccess");
    else label = tGroups("join");
  } else {
    label = state === "following" ? tCommon("unfollow") : tCommon("follow");
  }

  const inactive = loading || state === "joined" || state === "pending" || state === "following";
  const isPaidSub = !inactive && rec.groupId && rec.groupVisibility === "private" && rec.subscriptionEnabled;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={inactive}
      style={{
        width: "100%",
        borderRadius: 10,
        padding: "10px 12px",
        border: inactive ? "1px solid rgba(255,255,255,0.18)" : "none",
        fontWeight: 600,
        fontSize: 13,
        letterSpacing: "-0.01em",
        cursor: inactive ? "default" : "pointer",
        background: inactive
          ? "rgba(255,255,255,0.14)"
          : isPaidSub
            ? "#70aefb"
            : "linear-gradient(135deg, #ec4899, #9333ea)",
        color: inactive ? "rgba(255,255,255,0.70)" : "#fff",
        fontFamily: fontStack,
        backdropFilter: inactive ? "blur(12px)" : "none",
        WebkitBackdropFilter: inactive ? "blur(12px)" : "none",
        transition: "opacity 150ms ease",
      }}
    >
      {loading ? tCommon("processing") : label}
    </button>
  );
}

function LiveRecommendationCard({
  rec,
  currentUserId,
  actionState,
  actionLoading,
  onOpenViewer,
  onAction,
}: {
  rec: LiveRec;
  currentUserId: string;
  actionState: LiveActionState;
  actionLoading: boolean;
  onOpenViewer: () => void;
  onAction: () => void;
}) {
  const tGroups = useTranslations("groups");
  const coverImage = rec.liveCoverUrl ?? rec.coverUrl;
  return (
    <div style={cardStyles}>
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 11",
          borderRadius: 20,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow: "0 24px 52px rgba(0,0,0,0.42), 0 6px 16px rgba(0,0,0,0.28)",
          transform: "translateZ(0)",
        }}
      >
        {/* Cover — live cover preferido, fallback perfil/comunidad */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: coverImage
              ? `url(${coverImage}) center / cover no-repeat`
              : "linear-gradient(135deg, #3b1010 0%, #1a0808 55%, #0d0505 100%)",
            transform: "scale(1.01)",
          }}
        />
        {/* Gradient */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(239,68,68,0.10) 0%, rgba(0,0,0,0.20) 30%, rgba(0,0,0,0.65) 58%, rgba(0,0,0,0.92) 82%, rgba(0,0,0,0.98) 100%)",
          }}
        />

        {/* Avatar con aro de live */}
        <div
          style={{
            position: "absolute",
            top: 14,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2,
            filter: "drop-shadow(0 8px 22px rgba(0,0,0,0.50))",
          }}
        >
          <LiveRingAvatar
            entityId={rec.groupId ?? rec.authorId}
            entityType={rec.groupId ? "group" : "profile"}
            currentUserId={currentUserId}
            photoURL={rec.avatarUrl}
            displayName={rec.displayName}
            size={68}
            onClick={onOpenViewer}
          />
        </div>

        {/* Clickable body — opens viewer */}
        <button
          type="button"
          onClick={onOpenViewer}
          style={{
            position: "absolute",
            inset: 0,
            bottom: 60,
            zIndex: 1,
            background: "none",
            border: "none",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "14px 12px 0",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <div style={{ width: 68, height: 68, flexShrink: 0 }} />
          <div
            style={{
              marginTop: 10,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              paddingBottom: 6,
            }}
          >
            <strong
              style={{
                fontSize: 14,
                lineHeight: 1.18,
                color: "#fff",
                maxWidth: "100%",
                wordBreak: "break-word",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textAlign: "center",
                fontFamily: fontStack,
                fontWeight: 700,
                letterSpacing: "-0.01em",
              }}
            >
              {rec.displayName}
            </strong>
            {rec.liveTitle && (
              <div
                style={{
                  marginTop: 5,
                  fontSize: 11,
                  lineHeight: "14px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "100%",
                  color: "rgba(255,255,255,0.65)",
                  fontFamily: fontStack,
                  fontWeight: 400,
                }}
              >
                {rec.liveTitle}
              </div>
            )}
            <div
              style={{
                marginTop: 7,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "#ef4444",
                padding: "4px 8px 4px 6px",
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                color: "#fff",
                letterSpacing: "0.06em",
                fontFamily: fontStack,
              }}
            >
              <svg
                width="10" height="10" viewBox="0 0 22 22" fill="none"
                style={{ animation: "lrRecPulse 1.4s ease-in-out infinite" }}
              >
                <circle cx="11" cy="11" r="10" stroke="#fff" strokeWidth="1.4" fill="none" />
                <circle cx="11" cy="11" r="6" fill="#fff" />
              </svg>
              {tGroups("liveLabel")}
              <style>{`@keyframes lrRecPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(.88)}}`}</style>
            </div>
          </div>
        </button>

        {/* CTA */}
        <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, zIndex: 2 }}>
          <LiveCTAButton
            rec={rec}
            state={actionState}
            loading={actionLoading}
            onClick={onAction}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRail() {
  return (
    <>
      <style>{`
        @keyframes vibraRecsSkeleton {
          0%,100% { opacity: 0.38; }
          50%      { opacity: 0.65; }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "hidden",
          paddingBottom: 6,
          paddingLeft: 12,
          paddingRight: 12,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ minWidth: 200, maxWidth: 200, flexShrink: 0 }}>
            <div
              style={{
                width: "100%",
                aspectRatio: "9 / 11",
                borderRadius: 20,
                background: "rgba(255,255,255,0.07)",
                animation: `vibraRecsSkeleton 1.6s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function GroupRecommendationsRail({
  currentUserId,
  onCreateGroup,
  className,
}: Props) {
  const router = useRouter();
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");
  const [selectedCategories, setSelectedCategories] = useState<
    CanonicalGroupCategory[]
  >([]);
  const [result, setResult] = useState<RecommendationFetchResult | null>(() => getCachedResult(currentUserId));
  const [loading, setLoading] = useState<boolean>(() => !getCachedResult(currentUserId));
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinStates, setJoinStates] = useState<
    Record<string, RecommendationJoinState>
  >({});
  const [joinLoadingByGroup, setJoinLoadingByGroup] = useState<
    Record<string, boolean>
  >({});
  const [profileCards, setProfileCards] = useState<RecommendationProfileCard[]>(() => peekProfiles(currentUserId) ?? []);
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});
  const [followLoadingByProfile, setFollowLoadingByProfile] = useState<
    Record<string, boolean>
  >({});

  // Live recommendations
  const [liveRecs, setLiveRecs] = useState<LiveRec[]>([]);
  const [viewingPost, setViewingPost] = useState<Post | null>(null);
  const [liveActionStates, setLiveActionStates] = useState<Record<string, LiveActionState>>({});
  const [liveActionLoading, setLiveActionLoading] = useState<Record<string, boolean>>({});
  const followingIdsRef = useRef<Set<string>>(new Set());
  const memberGroupIdsRef = useRef<Set<string>>(new Set());

  const minCategories = recommendationEngineConstants.MIN_ONBOARDING_CATEGORIES;

  const loadRecommendations = useCallback(async () => {
    if (!currentUserId) {
      setResult(null);
      setJoinStates({});
      setSelectedCategories([]);
      setProfileCards([]);
      setFollowStates({});
      setLoading(false);
      setError(null);
      return;
    }

    if (!getCachedResult(currentUserId)) setLoading(true);
    setError(null);

    try {
      const [next, profiles] = await Promise.all([
        fetchRecommendedGroupsForUser(currentUserId),
        fetchRecommendedProfilesForUser(currentUserId).catch(() => [] as RecommendationProfileCard[]),
      ]);
      setResult(next);
      setSelectedCategories(next.selectedCategories);
      profileCache.set(currentUserId, { profiles, cachedAt: Date.now() });
      setProfileCards(profiles);
      setFollowStates(Object.fromEntries(profiles.map((p) => [p.uid, false])));

      if (next.groups.length > 0) {
        const entries = await Promise.all(
          next.groups.map(async (group) => {
            const state = await resolveJoinState(
              group.id,
              currentUserId,
              group.visibility
            );
            return [group.id, state] as const;
          })
        );

        setJoinStates(Object.fromEntries(entries));
      } else {
        setJoinStates({});
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tGroups("recsLoadError")
      );
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    void loadRecommendations();
  }, [loadRecommendations]);

  // Ref that always points to the latest loadRecommendations — used in the
  // cache-invalidation subscription so we don't need to re-register on every render
  const loadRecommendationsRef = useRef(loadRecommendations);
  loadRecommendationsRef.current = loadRecommendations;

  // When any Rail instance invalidates the shared cache, all instances re-fetch
  useEffect(() => {
    return onRecommendationCacheInvalidated(() => {
      void loadRecommendationsRef.current();
    });
  }, []);

  // Suscripción en tiempo real a lives públicos activos no seguidos/miembros
  useEffect(() => {
    if (!currentUserId) return;
    let unsubLives: (() => void) | null = null;
    let cancelled = false;
    let snapGen = 0;

    async function init() {
      try {
        const [followSnap, memberSnap] = await Promise.all([
          getDocs(query(collection(db, "users", currentUserId, "following"), limit(100))),
          getDocs(collection(db, "users", currentUserId, "groupMemberships")),
        ]);
        if (cancelled) return;

        followingIdsRef.current = new Set(
          followSnap.docs.map((d) => (d.data().targetUserId as string) ?? d.id),
        );
        memberGroupIdsRef.current = new Set(
          memberSnap.docs
            .filter((d) => ["active", "subscribed"].includes(d.data().status as string))
            .map((d) => d.id),
        );
      } catch {
        // non-fatal
      }
      if (cancelled) return;

      const q = query(
        collection(db, "posts"),
        where("liveData.status", "==", "live"),
        limit(20),
      );

      unsubLives = onSnapshot(q, async (snap) => {
        if (cancelled) return;
        const myGen = ++snapGen;

        const filtered = snap.docs
          .map((d): Record<string, unknown> => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
          .filter((post) => {
            const ld = post.liveData as Record<string, unknown> | null;
            if (!ld || ld.visibilityMode !== "everyone") return false;
            if (post.authorId === currentUserId) return false;
            const gid = post.groupId as string | undefined;
            if (!gid && followingIdsRef.current.has(post.authorId as string)) return false;
            if (gid && memberGroupIdsRef.current.has(gid)) return false;
            return true;
          });

        if (filtered.length === 0) { setLiveRecs([]); return; }

        const authorIds = [...new Set(
          filtered.filter((p) => !p.groupId).map((p) => p.authorId as string),
        )];
        const gids = [...new Set(
          filtered.filter((p) => !!p.groupId).map((p) => p.groupId as string),
        )];

        const [authorDocs, groupDocs] = await Promise.all([
          authorIds.length > 0
            ? getDocs(query(collection(db, "users"), where(documentId(), "in", authorIds.slice(0, 30))))
            : Promise.resolve({ docs: [] as typeof snap.docs }),
          gids.length > 0
            ? getDocs(query(collection(db, "groups"), where(documentId(), "in", gids.slice(0, 30))))
            : Promise.resolve({ docs: [] as typeof snap.docs }),
        ]);
        if (cancelled || myGen !== snapGen) return;

        const userMap = new Map(authorDocs.docs.map((d) => [d.id, d.data()]));
        const groupMap = new Map(groupDocs.docs.map((d) => [d.id, d.data()]));

        const recs: LiveRec[] = filtered.map((post) => {
          const ld = post.liveData as Record<string, unknown>;
          const gid = post.groupId as string | undefined;
          if (gid) {
            const g = (groupMap.get(gid) ?? {}) as Record<string, unknown>;
            const mon = (g.monetization ?? {}) as Record<string, unknown>;
            return {
              postId: post.id as string,
              authorId: post.authorId as string,
              groupId: gid,
              liveCoverUrl: (ld.coverUrl as string | null) ?? null,
              liveTitle: (ld.title as string | null) ?? null,
              displayName: (g.name as string) ?? tCommon("communityLabel"),
              avatarUrl: (g.avatarUrl as string | null) ?? null,
              coverUrl: (g.coverUrl as string | null) ?? null,
              groupVisibility: (g.visibility as string | null) ?? null,
              subscriptionEnabled: mon.subscriptionsEnabled === true || mon.isPaid === true,
            };
          } else {
            const u = (userMap.get(post.authorId as string) ?? {}) as Record<string, unknown>;
            return {
              postId: post.id as string,
              authorId: post.authorId as string,
              groupId: null,
              liveCoverUrl: (ld.coverUrl as string | null) ?? null,
              liveTitle: (ld.title as string | null) ?? null,
              displayName: (u.displayName as string) ?? (u.username as string) ?? tCommon("user"),
              avatarUrl: (u.photoURL as string | null) ?? null,
              coverUrl: (u.coverPhotoURL as string | null) ?? null,
              handle: (u.handle as string | null) ?? null,
            };
          }
        });

        setLiveRecs(recs);
        setLiveActionStates((prev) => {
          const next = { ...prev };
          for (const r of recs) if (!next[r.postId]) next[r.postId] = "none";
          return next;
        });
      });
    }

    void init();
    return () => {
      cancelled = true;
      if (unsubLives) unsubLives();
    };
  }, [currentUserId]);

  const toggleCategory = (category: CanonicalGroupCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((item) => item !== category)
        : [...prev, category]
    );
  };

  const handleSaveOnboarding = async () => {
    if (!currentUserId) return;

    setSavingOnboarding(true);
    setError(null);

    try {
      completeRecommendationsOnboarding(currentUserId, selectedCategories);
      // Invalidate shared cache so all Rail instances on this page pick up the new state
      invalidateRecommendationCache(currentUserId);
      // loadRecommendations will be triggered automatically by the invalidation listener
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tGroups("saveSelectionError")
      );
    } finally {
      setSavingOnboarding(false);
    }
  };

  const handleJoin = async (group: RecommendationGroupCard) => {
    if (!currentUserId) return;

    setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: true }));
    setError(null);

    try {
      const isPaidSubscriptionPrivate =
        group.visibility === "private" && resolveSubscriptionEnabled(group);

      if (group.visibility === "public") {
        await joinGroup(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "joined" }));
      } else if (isPaidSubscriptionPrivate) {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      } else if (group.visibility === "private") {
        await requestToJoin(group.id, currentUserId);
        setJoinStates((prev) => ({ ...prev, [group.id]: "pending" }));
      }

      trackGroupRecommendationSignalFromGroup({
        uid: currentUserId,
        category: group.category,
        tags: group.tags,
      });

      // Invalidate cache so all Rail instances exclude this group on next fetch
      invalidateRecommendationCache(currentUserId);

      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : tGroups("actionError");

      if (message === "GROUP_REQUIRES_SUBSCRIPTION") {
        router.push(`/groups/${group.id}?service=suscripcion`);
        return;
      }

      setError(message);
    } finally {
      setJoinLoadingByGroup((prev) => ({ ...prev, [group.id]: false }));
    }
  };

  const handleOpenLiveViewer = async (postId: string) => {
    try {
      const snap = await getDoc(doc(db, "posts", postId));
      if (snap.exists()) setViewingPost({ id: snap.id, ...snap.data() } as Post);
    } catch { /* silencioso */ }
  };

  const handleLiveAction = async (rec: LiveRec) => {
    if (!currentUserId) return;
    setLiveActionLoading((prev) => ({ ...prev, [rec.postId]: true }));
    try {
      if (rec.groupId) {
        const isPaidPrivate = rec.groupVisibility === "private" && rec.subscriptionEnabled;
        if (isPaidPrivate) {
          router.push(`/groups/${rec.groupId}?service=suscripcion`);
          return;
        } else if (rec.groupVisibility === "public") {
          await joinGroup(rec.groupId, currentUserId);
          setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "joined" }));
        } else {
          await requestToJoin(rec.groupId, currentUserId);
          setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "pending" }));
        }
      } else {
        await followUser({ currentUserId, targetUserId: rec.authorId });
        setLiveActionStates((prev) => ({ ...prev, [rec.postId]: "following" }));
        followingIdsRef.current.add(rec.authorId);
      }
    } catch { /* silencioso */ } finally {
      setLiveActionLoading((prev) => ({ ...prev, [rec.postId]: false }));
    }
  };

  const handleFollow = async (profile: RecommendationProfileCard) => {
    if (!currentUserId) return;
    setFollowLoadingByProfile((prev) => ({ ...prev, [profile.uid]: true }));
    setError(null);
    try {
      await followUser({ currentUserId, targetUserId: profile.uid });
      setFollowStates((prev) => ({ ...prev, [profile.uid]: true }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tGroups("followError")
      );
    } finally {
      setFollowLoadingByProfile((prev) => ({ ...prev, [profile.uid]: false }));
    }
  };

  const mergedRailItems = useMemo((): RailItem[] => {
    if (!result?.onboardingCompleted || result.groups.length === 0) return [];
    const items: RailItem[] = [];
    let profileIdx = 0;
    result.groups.forEach((group, i) => {
      items.push({ type: "group", data: group });
      if ((i + 1) % 3 === 0 && profileIdx < profileCards.length) {
        items.push({ type: "profile", data: profileCards[profileIdx++] });
      }
    });
    while (profileIdx < profileCards.length) {
      items.push({ type: "profile", data: profileCards[profileIdx++] });
    }
    return items;
  }, [result, profileCards]);

  const showOnboarding = useMemo(() => {
    return !loading && result && !result.onboardingCompleted;
  }, [loading, result]);

  if (!currentUserId) {
    return null;
  }

  return (
    <section
      className={className}
      style={{ width: "100%", color: "#fff" }}
    >
      {error ? (
        <div
          style={{
            marginBottom: 12,
            borderRadius: 12,
            background: "rgba(255, 80, 80, 0.12)",
            border: "1px solid rgba(255, 80, 80, 0.25)",
            padding: 12,
            fontSize: 13,
            fontFamily: fontStack,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? <SkeletonRail /> : null}

      {showOnboarding ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div
            style={{
              fontSize: 14,
              color: "rgba(255,255,255,0.84)",
              fontFamily: fontStack,
            }}
          >
            {tGroups("selectAtLeast", { min: minCategories })}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              width: "100%",
            }}
          >
            {GROUP_CATEGORY_OPTIONS.map((option) => (
              <GroupCategoryPill
                key={option.value}
                label={option.label}
                selected={selectedCategories.includes(option.value)}
                onToggle={() => toggleCategory(option.value)}
              />
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={handleSaveOnboarding}
              disabled={
                savingOnboarding || selectedCategories.length < minCategories
              }
              style={{
                border: "none",
                borderRadius: 12,
                padding: "11px 16px",
                fontWeight: 700,
                background:
                  savingOnboarding || selectedCategories.length < minCategories
                    ? "rgba(255,255,255,0.16)"
                    : "#ffffff",
                color:
                  savingOnboarding || selectedCategories.length < minCategories
                    ? "rgba(255,255,255,0.6)"
                    : "#08111d",
                cursor:
                  savingOnboarding || selectedCategories.length < minCategories
                    ? "default"
                    : "pointer",
                fontFamily: fontStack,
              }}
            >
              {savingOnboarding ? tCommon("saving") : tCommon("continue")}
            </button>

            <span
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.62)",
                fontFamily: fontStack,
              }}
            >
              {tGroups("selectedCount", { count: selectedCategories.length, min: minCategories })}
            </span>
          </div>
        </div>
      ) : null}

      {(!loading && result?.onboardingCompleted && result.groups.length > 0) || liveRecs.length > 0 ? (
        <>
          <style>{`
            .vibraRecsRail {
              scrollbar-width: thin;
              scrollbar-color: rgba(255,255,255,0.20) transparent;
            }
            .vibraRecsRail::-webkit-scrollbar { height: 3px; }
            .vibraRecsRail::-webkit-scrollbar-track { background: transparent; }
            .vibraRecsRail::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.20); border-radius: 99px; }
            .vibraRecsRail::-webkit-scrollbar-button { display: none; }
          `}</style>
          <div
            className="vibraRecsRail"
            style={{
              display: "flex",
              gap: 12,
              overflowX: "auto",
              scrollSnapType: "x mandatory",
              paddingBottom: 6,
              paddingLeft: 12,
              paddingRight: 12,
              willChange: "transform",
            }}
          >
          {/* Lives públicos activos — siempre primero */}
          {liveRecs.map((rec) => (
            <LiveRecommendationCard
              key={`live-${rec.postId}`}
              rec={rec}
              currentUserId={currentUserId}
              actionState={liveActionStates[rec.postId] ?? "none"}
              actionLoading={Boolean(liveActionLoading[rec.postId])}
              onOpenViewer={() => void handleOpenLiveViewer(rec.postId)}
              onAction={() => void handleLiveAction(rec)}
            />
          ))}

          {!loading && result?.onboardingCompleted && mergedRailItems.map((item) =>
            item.type === "group" ? (
              <GroupCard
                key={`group-${item.data.id}`}
                group={item.data}
                joinState={joinStates[item.data.id] ?? "join"}
                loading={Boolean(joinLoadingByGroup[item.data.id])}
                onJoin={() => handleJoin(item.data)}
                currentUserId={currentUserId}
              />
            ) : (
              <ProfileCard
                key={`profile-${item.data.uid}`}
                profile={item.data}
                isFollowing={followStates[item.data.uid] ?? false}
                loading={Boolean(followLoadingByProfile[item.data.uid])}
                onFollow={() => handleFollow(item.data)}
                currentUserId={currentUserId}
              />
            )
          )}
          </div>
        </>
      ) : null}

      {viewingPost && (
        <LiveViewerModal
          open={!!viewingPost}
          onClose={() => setViewingPost(null)}
          post={viewingPost}
        />
      )}

      {!loading && result?.onboardingCompleted && result.groups.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            padding: "8px 0 2px",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: "rgba(255,255,255,0.68)",
              fontFamily: fontStack,
            }}
          >
            {tGroups("noCommunitiesAvailable")}
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                if (onCreateGroup) {
                  onCreateGroup();
                  return;
                }
                router.push("/groups/new");
              }}
              style={{
                border: "none",
                borderRadius: 12,
                padding: "10px 14px",
                background: "#ffffff",
                color: "#08111d",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: fontStack,
              }}
            >
              {tGroups("createCommunityRailButton")}
            </button>

            <button
              type="button"
              onClick={() => {
                setResult((prev) =>
                  prev
                    ? {
                        ...prev,
                        onboardingCompleted: false,
                      }
                    : prev
                );
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 12,
                padding: "10px 14px",
                background: "transparent",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: fontStack,
              }}
            >
              {tGroups("changeCategories")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}