"use client";

// GroupRecommendationsRail parts (2/2): tarjetas (ProfileCard, GroupCard, Live*, Skeleton).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { FIXED_SERVICE_FEE_USD } from "@/lib/currency/catalog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
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
  normalizeGroupCategory,
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
  seededShuffle,
  trackGroupRecommendationSignalFromGroup,
  getUserTasteVector,
} from "./recommendation-engine";
import { updateProfileInterests } from "@/lib/profile/updateProfileInterests";
import type {
  RailItem,
  RecommendationFetchResult,
  RecommendationGroupCard,
  RecommendationJoinState,
  RecommendationProfileCard,
  RecommendationRailContext,
} from "./types";
import {
  FollowButton, JoinButton, cardStyles, fontStack,
  RAIL_CARD_W, RAIL_GAP,
  resolveSubscriptionEnabled, resolveSubscriptionPrice,
  type LiveRec, type LiveActionState,
} from "./GroupRecommendationsRail.parts";
import { RailActionButton, type RailBtnTono } from "./RailActionButton";

export function ProfileCard({
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
          aspectRatio: "9 / 10",
          borderRadius: 0,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow: "none",
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
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 28%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0.70) 80%, rgba(0,0,0,0.80) 100%)",
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
            bottom: 52,
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
                fontWeight: 500,
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
            insetInlineStart: 10,
            insetInlineEnd: 10,
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

export function GroupCard({
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
  const pf = usePriceFormat();
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
  // Precio TODO-INCLUIDO para el botón: (base + cargo fijo) + impuesto del país.
  const subscribeButtonPrice =
    subscriptionPrice != null
      ? pf.formatWithTax(subscriptionPrice + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY }).total
      : null;

  return (
    <div style={cardStyles}>
      {/* Cover card — the card IS the image, no gray wrapper */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "9 / 10",
          borderRadius: 0,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow: "none",
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
              "linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.18) 28%, rgba(0,0,0,0.62) 58%, rgba(0,0,0,0.70) 80%, rgba(0,0,0,0.80) 100%)",
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
            bottom: 52,
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

            {/* El precio va SOLO en el botón de suscribirse. Aquí se repetía justo
                debajo de la categoría, dos veces el mismo dato en una tarjeta de
                ~200px. Quitarlo no descuadra nada: esta columna es `absolute`
                dentro de la tarjeta, así que su alto no lo marca el contenido. */}
          </div>
        </Link>

        {/* Join button — floats at the bottom of the card, above the Link */}
        <div
          style={{
            position: "absolute",
            bottom: 10,
            insetInlineStart: 10,
            insetInlineEnd: 10,
            zIndex: 2,
          }}
        >
          <JoinButton
            state={joinState}
            onClick={onJoin}
            loading={loading}
            isPaidSubscriptionPrivate={isPaidSubscriptionPrivate}
            subscribePriceLabel={subscribeButtonPrice}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Live Recommendations ────────────────────────────────────────────────────


export function LiveCTAButton({
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

  const pf = usePriceFormat();

  let label: string;
  if (rec.groupId) {
    if (state === "joined") label = tGroups("joined");
    else if (state === "pending") label = tGroups("requestSent");
    else if (rec.groupVisibility === "private" && rec.subscriptionEnabled) {
      const base =
        typeof rec.subscriptionPriceMonthly === "number" && rec.subscriptionPriceMonthly > 0
          ? rec.subscriptionPriceMonthly
          : null;
      label =
        base != null
          ? tGroups("subscribeForPrice", {
              price: pf.formatWithTax(base + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY }).total,
            })
          : tGroups("subscribeCta");
    } else if (rec.groupVisibility === "private") label = tGroups("requestAccess");
    else label = tGroups("join");
  } else {
    label = state === "following" ? tCommon("following") : tCommon("follow");
  }

  const esPagoSub = Boolean(
    rec.groupId && rec.groupVisibility === "private" && rec.subscriptionEnabled
  );

  // Igual que en las tarjetas de comunidad: solo la solicitud pendiente va
  // en gris, porque es la única que espera a que conteste otra persona.
  const tono: RailBtnTono =
    state === "pending" ? "espera"
      : state !== "joined" && esPagoSub ? "pago"
        : "marca";

  return (
    <RailActionButton
      label={label}
      tono={tono}
      loading={loading}
      onClick={onClick}
      fontStack={fontStack}
    />
  );
}

export function LiveRecommendationCard({
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
          aspectRatio: "9 / 10",
          borderRadius: 0,
          overflow: "hidden",
          background: "#0d0d0f",
          boxShadow: "none",
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
              "linear-gradient(180deg, rgba(239,68,68,0.10) 0%, rgba(0,0,0,0.20) 30%, rgba(0,0,0,0.65) 58%, rgba(0,0,0,0.70) 82%, rgba(0,0,0,0.80) 100%)",
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
            bottom: 52,
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
                fontWeight: 500,
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
        <div style={{ position: "absolute", bottom: 10, insetInlineStart: 10, insetInlineEnd: 10, zIndex: 2 }}>
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

export function SkeletonRail() {
  // Skeleton canónico de Vibra (vibra_style.md): onda .vb-skel / vbSkelWave.
  // Celular: 4 cards de ancho fijo. Laptop (≥901px): 3 cards que se ajustan (como
  // el rail real; la 4ª se oculta). Alto FIJO (no aspect-ratio) para que se
  // renderice bien en iOS/Android/PWA (aspect-ratio en flex no computa alto en iOS).
  return (
    <>
      <style>{`
        .vibra-recs-skel {
          background: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(255, 255, 255, 0.11) 50%,
            rgba(255, 255, 255, 0.05) 70%
          );
          background-size: 300% 100%;
          animation: vbSkelWave 1.6s ease-in-out infinite;
        }
        @keyframes vbSkelWave {
          0%   { background-position: 180% 0; }
          100% { background-position: -80% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-recs-skel { animation: none; background: rgba(255, 255, 255, 0.07); }
        }
        .vibra-recs-skel-row {
          display: flex;
          gap: ${RAIL_GAP}px;
          overflow-x: hidden;
          padding: 0 14px 6px;
        }
        .vibra-recs-skel-card {
          min-width: ${RAIL_CARD_W}px;
          max-width: ${RAIL_CARD_W}px;
          flex-shrink: 0;
        }
        .vibra-recs-skel-block {
          width: 100%;
          height: 224px;
          border-radius: 0;
        }
        @media (min-width: 901px) {
          .vibra-recs-skel-row { padding: 0 0 6px; justify-content: center; }
          .vibra-recs-skel-card { flex: 1 1 0; min-width: 0; max-width: ${RAIL_CARD_W}px; }
          .vibra-recs-skel-card:nth-child(n + 4) { display: none; }
        }
      `}</style>
      <div className="vibra-recs-skel-row">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="vibra-recs-skel-card">
            <div className="vibra-recs-skel vibra-recs-skel-block" />
          </div>
        ))}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

