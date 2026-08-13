"use client";

// Tipos compartidos y sub-componentes (Switch, Chevron, CountBadge, TabIcon) de OwnerSidebar.

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  Timestamp,
  type FirestoreError,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import {
  approveJoinRequest,
  rejectJoinRequest,
} from "@/lib/groups/joinRequests.admin";
import { subscribeToMySidebarGroups } from "@/lib/groups/sidebarGroups";
import { respondGreetingRequest } from "@/lib/greetings/greetingRequests";
import LiveRingAvatar from "@/app/components/LiveRing/LiveRingAvatar";
import OwnerSidebarTabNav from "./OwnerSidebarTabNav";
import OwnerSidebarMyGroups from "./OwnerSidebarMyGroups";
import OwnerSidebarOtherGroups from "./OwnerSidebarOtherGroups";
import OwnerSidebarFollowedProfiles from "./OwnerSidebarFollowedProfiles";
import OwnerSidebarGreetings from "./OwnerSidebarGreetings";
import CopyLinkButton from "@/components/ui/CopyLinkButton";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { useSidebarVisitCounts } from "@/lib/hooks/useSidebarVisitCounts";
import { useNewPostsCounts } from "@/lib/hooks/useNewPostsCounts";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import {
  visibilitySectionTitle,
  typeLabel,
  getServiceBucketKey,
  isMeetGreetCreatorActiveItem,
  isBuyerRequestedVisibleItem,
  fmtDate,
  getInitials,
  friendlyJoinErrorMessage,
  buildDisplayName,
  OWNER_SIDEBAR_FOLLOWING_LIMIT,
  normalizeOwnerSidebarNoShowStatus,
  normalizeSidebarMemberStatus,
  normalizeSidebarGroupRole,
  sortGroupsWithModsFirst,
  resolveSidebarSubscriptionEnabled,
  resolveSidebarSubscriptionPrice,
  resolveSidebarSubscriptionCurrency,
} from "./OwnerSidebar.utils";

export type Currency = "MXN" | "USD";
export type SidebarMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

export type GroupRoleLite = "owner" | "mod" | "member" | null;

export type MembershipAccessTypeLite =
  | "standard"
  | "subscription"
  | "subscribed"
  | "legacy_free"
  | "subscription_required"
  | "unknown"
  | null;

export type HiddenSidebarStateLite =
  | "joined"
  | "legacy_free"
  | "requires_subscription"
  | "banned"
  | null;

export type UserDoc = {
  uid: string;
  handle: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  photoURL?: string | null;
  profileRestricted?: boolean;
  profileGreeting?: {
    enabled: boolean;
    price: number | null;
    currency: Currency | null;
  };
};

export type GroupDocLite = {
  id: string;
  name?: string;
  ownerId?: string;
  visibility?: "public" | "private" | "hidden" | string;
  isActive?: boolean | null;
  isDeleted?: boolean | null;
  deletedAt?: unknown;
  avatarUrl?: string | null;
    profileHref?: string | null;
      handle?: string | null;
  memberStatus?: SidebarMemberStatus;
  memberRole?: GroupRoleLite;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: Currency | null;
    subscriptionsEnabled?: boolean;
    subscriptionPriceMonthly?: number | null;
    subscriptionCurrency?: Currency | null;
  };
  offerings?: Array<{
    type: "saludo" | "consejo" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: Currency | null;
  }>;

  membershipAccessType?: MembershipAccessTypeLite;
  requiresSubscription?: boolean | null;
  subscriptionActive?: boolean | null;
  legacyComplimentary?: boolean | null;
  transitionPendingAction?: boolean | null;
  transitionReason?: string | null;
  canDismiss?: boolean | null;
  sidebarState?: HiddenSidebarStateLite;

  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: Currency | string | null;
};

export type GreetingStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "delivered"
  | string;

export type GreetingType = "saludo" | "consejo" | string;

export type GreetingRequestDoc = {
  buyerId: string;
  creatorId: string;
  groupId?: string | null;
  profileUserId?: string | null;
  profileDisplayName?: string | null;
  profileUsername?: string | null;
  type: GreetingType;
  toName: string;
  instructions: string;
  source: "group" | "profile" | string;
  status: GreetingStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  deliveredAt?: Timestamp | null;
  muxUploadId?: string | null;
  muxAssetId?: string | null;
  muxPlaybackId?: string | null;
  muxHlsUrl?: string | null;
  videoStatus?: "uploading" | "ready" | "error" | string | null;
  videoDuration?: number | null;
  allowCreatorStory?: boolean;
  priceSnapshot?: number | null;
  currency?: string | null;
};

export type MeetGreetStatus =
  | "pending_creator_response"
  | "accepted_pending_schedule"
  | "scheduled"
  | "reschedule_requested"
  | "rejected"
  | "refund_requested"
  | "refund_review"
  | "ready_to_prepare"
  | "in_preparation"
  | "completed"
  | "cancelled"
  | string;

export type MeetGreetRequestDoc = {
  id?: string;
  type?: "digital_meet_greet" | string;
  flowVersion?: number;

  groupId?: string | null;
  groupName?: string | null;
  profileUserId?: string | null;
  profileDisplayName?: string | null;
  profileUsername?: string | null;
  source?: "group" | "profile" | string | null;

  buyerId: string;
  buyerDisplayName?: string | null;
  buyerUsername?: string | null;
  buyerAvatarUrl?: string | null;

  creatorId: string;
  creatorDisplayName?: string | null;
  creatorUsername?: string | null;
  creatorAvatarUrl?: string | null;

  status: MeetGreetStatus;

  buyerMessage?: string | null;
  rejectionReason?: string | null;
  refundReason?: string | null;
  refundRequestedAt?: Timestamp | null;

  priceSnapshot?: number | null;
  currency?: Currency | string | null;
  durationMinutes?: number | null;

  serviceSnapshot?: {
    type?: "meet_greet_digital" | string;
    enabled?: boolean;
    currency?: Currency | string | null;
    price?: number | null;
    durationMinutes?: number | null;
  } | null;

  acceptedAt?: Timestamp | null;
  rejectedAt?: Timestamp | null;

  scheduledAt?: Timestamp | null;
  scheduledBy?: string | null;
  scheduleProposedAt?: Timestamp | null;
  creatorTimezone?: string | null;
  creatorScheduleNote?: string | null;
  creatorScheduleNoteUpdatedAt?: Timestamp | null;
  scheduleHistory?: Array<{
    proposedAt?: Timestamp | null;
    proposedBy?: string | null;
    startsAt?: Timestamp | null;
    note?: string | null;
  }>;

  rescheduleRequestsUsed?: number;
  rescheduleRequestedAt?: Timestamp | null;
  rescheduleHistory?: Array<{
    requestedAt?: Timestamp | null;
    requestedBy?: string | null;
    reason?: string | null;
    countAfterRequest?: number | null;
  }>;

  preparingBuyerAt?: Timestamp | null;
  preparingCreatorAt?: Timestamp | null;
  preparationOpenedAt?: Timestamp | null;

  paymentMode?: string | null;
  paymentStatus?: string | null;

  noShowRole?: "buyer" | "creator" | "both" | null;
  noShowRejectAt?: Timestamp | null;
  autoRejectedAt?: Timestamp | null;
  autoRejectReason?: string | null;
  requestSource?: string | null;

  recordingStatus?: "not_started" | "recording" | "processing" | "ready" | "failed" | null;
  recordingS3Key?: string | null;
  recordingUrl?: string | null;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type ExclusiveSessionRequestDoc = MeetGreetRequestDoc & {
  type?: "digital_exclusive_session" | string;
};

export type JoinRequestRow = {
  id: string;
  userId: string;
};

export type OutgoingJoinRequestRow = {
  id: string;
  groupId: string;
  status: string;
  createdAt?: Timestamp;
};

export type UserMini = {
  uid: string;
  displayName: string;
  handle: string | null;
  photoURL: string | null;
};

export type FollowedProfileLite = {
  uid: string;
  displayName: string;
  handle: string;
  photoURL: string | null;
};

export type TopView = "owned" | "communities" | "following" | "greetings";

export type TabIconProps = {
  active: boolean;
};

export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      title={label}
      style={{
        width: 40,
        height: 22,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.14)",
        background: checked ? "#ffffff" : "rgba(255,255,255,0.08)",
        padding: 2,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: checked ? "flex-end" : "flex-start",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "all 160ms ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? "#000" : "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          transition: "all 160ms ease",
        }}
      />
    </button>
  );
}

export function Chevron({
  open,
  muted = false,
}: {
  open: boolean;
  muted?: boolean;
}) {
  const color = muted
    ? "rgba(255,255,255,0.34)"
    : "rgba(255,255,255,0.72)";

  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 9,
        height: 9,
        borderInlineEnd: `1.7px solid ${color}`,
        borderBottom: `1.7px solid ${color}`,
        transform: open ? "rotate(225deg)" : "rotate(45deg)",
        transition: "transform 180ms ease",
        marginTop: open ? 3 : -1,
        flexShrink: 0,
      }}
    />
  );
}

export function CountBadge({
  count,
  tone,
}: {
  count: number;
  tone: "blue" | "green" | "yellow" | "pink";
}) {
  if (count === 0) return null;

  const bg =
    tone === "blue"
      ? "linear-gradient(180deg, #2f8cff 0%, #1f6fe5 100%)"
      : tone === "yellow"
        ? "linear-gradient(180deg, #facc15 0%, #eab308 100%)"
        : tone === "pink"
          ? "rgba(236,72,153,0.72)"
          : "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)";

  const shadow =
    tone === "pink"
      ? "none"
      : "0 6px 18px rgba(0,0,0,0.22)";

  const color = tone === "yellow" ? "#111" : "#fff";

  return (
    <span
      style={{
        width: 20,
        height: 20,
        minWidth: 20,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: shadow,
        border: "1px solid rgba(255,255,255,0.18)",
        flexShrink: 0,
      }}
    >
      {count}
    </span>
  );
}

export type OwnerSidebarCache = {
  viewer: User | null;
  authReady: boolean;
  userDoc: UserDoc | null;
  loadingUser: boolean;

  myGroups: GroupDocLite[];
  joinedGroups: GroupDocLite[];
  hiddenJoinedGroups: GroupDocLite[];
  browseGroups: GroupDocLite[];
  pendingJoinRequestsSent: OutgoingJoinRequestRow[];

  followedProfiles: FollowedProfileLite[];

  loadingGroups: boolean;
  loadingCommunities: boolean;
  loadingFollowing: boolean;

  groupsErr: string | null;
  msg: string | null;

  activeView: TopView;
  openCommunities: Record<string, boolean>;

  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  greetingsByGroup: Record<string, Array<{ id: string; data: GreetingRequestDoc }>>;
  buyerPending: Array<{ id: string; data: GreetingRequestDoc }>;
  buyerDelivered: Array<{ id: string; data: GreetingRequestDoc }>;

  meetGreetsByGroup: Record<string, Array<{ id: string; data: MeetGreetRequestDoc }>>;
  exclusiveSessionsByGroup: Record<
    string,
    Array<{ id: string; data: ExclusiveSessionRequestDoc }>
  >;

  buyerMeetGreets: Array<{ id: string; data: MeetGreetRequestDoc }>;
  buyerExclusiveSessions: Array<{ id: string; data: ExclusiveSessionRequestDoc }>;

  greetingSectionOpen: Record<string, boolean>;
  joinSectionOpen: Record<string, boolean>;
  seenCountsByGroup: Record<string, { join: number; greeting: number }>;

  userMiniMap: Record<string, UserMini>;
  groupMetaMap: Record<string, GroupDocLite>;
};


