"use client";

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

// Re-export de helpers públicos para preservar la API previa del módulo
// (consumido por wallet/*, overlays y componentes hermanos del sidebar).
export {
  visibilitySectionTitle,
  typeLabel,
  fmtDate,
  getInitials,
  friendlyJoinErrorMessage,
  buildDisplayName,
};

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
    type: "saludo" | "consejo" | "mensaje" | string;
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

export type GreetingType = "saludo" | "consejo" | "mensaje" | string;

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
        borderRight: `1.7px solid ${color}`,
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

type OwnerSidebarCache = {
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

let ownerSidebarCache: OwnerSidebarCache | null = null;

export default function OwnerSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");
  const tWallet = useTranslations("wallet");
  const tServices = useTranslations("services");
  const tSessions = useTranslations("sessions");
  const { format: formatMoney } = usePriceFormat();
  const [isMobile, setIsMobile] = useState(false);
  const [ownerSidebarRefreshKey, setOwnerSidebarRefreshKey] = useState(0);

useEffect(() => {
  if (typeof window === "undefined") return;

  const mediaQuery = window.matchMedia("(max-width: 1220px)");

  const sync = () => setIsMobile(mediaQuery.matches);
  sync();

  mediaQuery.addEventListener("change", sync);
  return () => mediaQuery.removeEventListener("change", sync);
}, []);

const handleOwnerSidebarPullRefresh = useCallback(async () => {
  ownerSidebarCache = null;
  setOwnerSidebarRefreshKey((value) => value + 1);
  router.refresh();
}, [router]);

  const [viewer, setViewer] = useState<User | null>(
    () => ownerSidebarCache?.viewer ?? null
  );

  const { counts: visitCounts, increment: incrementVisit } = useSidebarVisitCounts(
    viewer?.uid ?? null
  );

  const [authReady, setAuthReady] = useState(
    () => ownerSidebarCache?.authReady ?? false
  );

  const [userDoc, setUserDoc] = useState<UserDoc | null>(
    () => ownerSidebarCache?.userDoc ?? null
  );
  const [loadingUser, setLoadingUser] = useState(
    () => ownerSidebarCache?.loadingUser ?? true
  );

  const [myGroups, setMyGroups] = useState<GroupDocLite[]>(
    () => ownerSidebarCache?.myGroups ?? []
  );
  const [joinedGroups, setJoinedGroups] = useState<GroupDocLite[]>(
    () => ownerSidebarCache?.joinedGroups ?? []
  );
  const [hiddenJoinedGroups, setHiddenJoinedGroups] = useState<GroupDocLite[]>(
    () => ownerSidebarCache?.hiddenJoinedGroups ?? []
  );
  const [browseGroups, setBrowseGroups] = useState<GroupDocLite[]>(
    () => ownerSidebarCache?.browseGroups ?? []
  );
  const [pendingJoinRequestsSent, setPendingJoinRequestsSent] = useState<
    OutgoingJoinRequestRow[]
  >(() => ownerSidebarCache?.pendingJoinRequestsSent ?? []);

  const [followedProfiles, setFollowedProfiles] = useState<
    FollowedProfileLite[]
  >(() => ownerSidebarCache?.followedProfiles ?? []);
  // Mirror of followedProfiles used inside onSnapshot to avoid stale closures
  // and skip re-fetching profiles that are already in memory.
  const followedProfilesRef = useRef<FollowedProfileLite[]>(
    ownerSidebarCache?.followedProfiles ?? []
  );

  const newPostsEntities = useMemo(
    () => [
      ...followedProfiles.map((p) => ({ id: p.uid, kind: "profile" as const })),
      ...joinedGroups.map((g) => ({ id: g.id, kind: "group" as const })),
      ...myGroups.map((g) => ({ id: g.id, kind: "group" as const })),
    ],
    [followedProfiles, joinedGroups, myGroups]
  );
  const newPostsCounts = useNewPostsCounts(newPostsEntities, viewer?.uid ?? null);

  const [loadingGroups, setLoadingGroups] = useState(
    () => ownerSidebarCache?.loadingGroups ?? false
  );
  const [loadingCommunities, setLoadingCommunities] = useState(
    () => ownerSidebarCache?.loadingCommunities ?? false
  );

  const [loadingFollowing, setLoadingFollowing] = useState(
    () => ownerSidebarCache?.loadingFollowing ?? false
  );

  const [groupsErr, setGroupsErr] = useState<string | null>(
    () => ownerSidebarCache?.groupsErr ?? null
  );
  const [joinBusyKey, setJoinBusyKey] = useState<string | null>(null);
  const [greetingBusyId, setGreetingBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(
    () => ownerSidebarCache?.msg ?? null
  );
  const { toast: sidebarToast, showToast: showSidebarToast } = useVibraToast();

  const [activeView, setActiveView] = useState<TopView>(
    () => ownerSidebarCache?.activeView ?? "owned"
  );
  // Acordeón: qué sección está desplegada. activeView marca la seleccionada;
  // accordionOpen permite además cerrarla (ninguna abierta) al re-clicarla.
  const [accordionOpen, setAccordionOpen] = useState(true);

  const [openCommunities, setOpenCommunities] = useState<
    Record<string, boolean>
  >(() => ownerSidebarCache?.openCommunities ?? {});

  const profileBucketKey = viewer?.uid ? `profile:${viewer.uid}` : null;

  const profileSidebarGroup = useMemo<GroupDocLite | null>(() => {
    if (!viewer?.uid || !userDoc?.handle || !profileBucketKey) return null;

    const avatarUrl =
      userDoc?.photoURL?.trim() || viewer?.photoURL?.trim() || null;

    return {
      id: profileBucketKey,
      name: tNav("profile"),
      ownerId: viewer.uid,
      visibility: "profile",
      avatarUrl,
      memberRole: "owner",
      handle: userDoc.handle,
      profileHref: `/u/${userDoc.handle}`,
    };
  }, [
    viewer?.uid,
    viewer?.photoURL,
    userDoc?.handle,
    userDoc?.photoURL,
    profileBucketKey,
  ]);

  const [joinRequestsByGroup, setJoinRequestsByGroup] = useState<
    Record<string, JoinRequestRow[]>
  >(() => ownerSidebarCache?.joinRequestsByGroup ?? {});

  const [greetingsByGroup, setGreetingsByGroup] = useState<
    Record<string, Array<{ id: string; data: GreetingRequestDoc }>>
  >(() => ownerSidebarCache?.greetingsByGroup ?? {});

  const [buyerPending, setBuyerPending] = useState<
    Array<{ id: string; data: GreetingRequestDoc }>
  >(() => ownerSidebarCache?.buyerPending ?? []);

  const [buyerDelivered, setBuyerDelivered] = useState<
    Array<{ id: string; data: GreetingRequestDoc }>
  >(() => ownerSidebarCache?.buyerDelivered ?? []);

  const [buyerRejectedGreetings, setBuyerRejectedGreetings] = useState<
    Array<{ id: string; data: GreetingRequestDoc }>
  >([]);

  const [meetGreetsByGroup, setMeetGreetsByGroup] = useState<
    Record<string, Array<{ id: string; data: MeetGreetRequestDoc }>>
  >(() => ownerSidebarCache?.meetGreetsByGroup ?? {});

  const [exclusiveSessionsByGroup, setExclusiveSessionsByGroup] = useState<
    Record<string, Array<{ id: string; data: ExclusiveSessionRequestDoc }>>
  >(() => ownerSidebarCache?.exclusiveSessionsByGroup ?? {});

  const [buyerMeetGreets, setBuyerMeetGreets] = useState<
    Array<{ id: string; data: MeetGreetRequestDoc }>
  >(() => ownerSidebarCache?.buyerMeetGreets ?? []);

  const [buyerExclusiveSessions, setBuyerExclusiveSessions] = useState<
    Array<{ id: string; data: ExclusiveSessionRequestDoc }>
  >(() => ownerSidebarCache?.buyerExclusiveSessions ?? []);

  const [greetingSectionOpen, setGreetingSectionOpen] = useState<
    Record<string, boolean>
  >(() => ownerSidebarCache?.greetingSectionOpen ?? {});

  const [joinSectionOpen, setJoinSectionOpen] = useState<
    Record<string, boolean>
  >(() => ownerSidebarCache?.joinSectionOpen ?? {});

  const [seenCountsByGroup, setSeenCountsByGroup] = useState<
    Record<string, { join: number; greeting: number }>
  >(() => ownerSidebarCache?.seenCountsByGroup ?? {});

  const [userMiniMap, setUserMiniMap] = useState<Record<string, UserMini>>(
    () => ownerSidebarCache?.userMiniMap ?? {}
  );
  const [groupMetaMap, setGroupMetaMap] = useState<Record<string, GroupDocLite>>(
    () => ownerSidebarCache?.groupMetaMap ?? {}
  );
    const groupMetaMapRef = useRef<Record<string, GroupDocLite>>(
    ownerSidebarCache?.groupMetaMap ?? {}
  );

  useEffect(() => {
    groupMetaMapRef.current = groupMetaMap;
  }, [groupMetaMap]);

  const joinUnsubsRef = useRef<Array<() => void>>([]);
  // Ref used by the browse-groups snapshot to filter already-joined groups without re-subscribing
  const joinedGroupIdsRef = useRef<Set<string>>(new Set());

  const fontStack =
    'inherit';

const ui = {
  sidebarWidth: 300,
  sidebarTop: 64,
  sidebarBottom: 4,
};

  const styles: Record<string, CSSProperties> = {
    input: {
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.04)",
      color: "#fff",
      outline: "none",
      fontSize: 12,
      fontFamily: fontStack,
      boxSizing: "border-box",
      appearance: "none",
      WebkitAppearance: "none",
      MozAppearance: "none",
      height: 42,
    },
    buttonSecondary: {
      padding: "8px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.05)",
      color: "#fff",
      cursor: "pointer",
      fontWeight: 600,
      fontSize: 13,
      fontFamily: fontStack,
      lineHeight: 1.1,
    },
    buttonPrimary: {
      padding: "8px 12px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.18)",
      background: "#fff",
      color: "#000",
      fontSize: 13,
      fontWeight: 700,
      lineHeight: 1.1,
      cursor: "pointer",
      fontFamily: fontStack,
    },
    message: {
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      color: "#fff",
      fontSize: 12,
      lineHeight: 1.35,
    },
sectionTitle: {
  fontSize: 11,
  fontWeight: isMobile ? 600 : 550,
  color: "rgba(254, 254, 254, 0.22)",
  // Sentence case: solo la primera letra en mayúscula (el texto base ya viene así).
  textTransform: "none",
  letterSpacing: 0.65,
},

    sectionHeaderRow: {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "4px 2px 2px",
},

createInlineButton: {
  minHeight: 24,
  padding: "0 9px",
  borderRadius: 9,
  border: "2.5px solid rgba(168,85,247,0.75)",
  background: "transparent",
  color: "rgba(168,85,247,0.92)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: fontStack,
  lineHeight: 1,
  cursor: "pointer",
  opacity: isMobile ? 0.95 : 0.78,
},


card: {
  padding: "10px 12px",
  borderRadius: 12,
  background: "#000",
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow:
    "0 18px 44px rgba(0,0,0,0.34)",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
},
    subtle: {
      fontSize: 11,
      color: "rgba(255,255,255,0.56)",
      lineHeight: 1.3,
    },
sectionPanel: {
  padding: "10px",
  borderRadius: 12,
  border: "none",
  background: "rgba(90, 41, 174, 0.14)",
  boxShadow: "none",
  display: "grid",
  gap: 8,
},
miniItem: {
  borderRadius: 12,
  border: "none",
  background: "transparent",
  boxShadow: "none",
  padding: 9,
  display: "grid",
  gap: 7,
  width: "100%",
  boxSizing: "border-box",
  minWidth: 0,
},
  };

  useEffect(() => {
    ownerSidebarCache = {
      viewer,
      authReady,
      userDoc,
      loadingUser,

      myGroups,
      joinedGroups,
      hiddenJoinedGroups,
      browseGroups,
      pendingJoinRequestsSent,

      followedProfiles,

      loadingGroups,
      loadingCommunities,
      loadingFollowing,

      groupsErr,
      msg,

      activeView,
      openCommunities,

      joinRequestsByGroup,
      greetingsByGroup,
      buyerPending,
      buyerDelivered,

      meetGreetsByGroup,
      exclusiveSessionsByGroup,

      buyerMeetGreets,
      buyerExclusiveSessions,

      greetingSectionOpen,
      joinSectionOpen,
      seenCountsByGroup,

      userMiniMap,
      groupMetaMap,
    };
  }, [
    viewer,
    authReady,
    userDoc,
    loadingUser,

    myGroups,
    joinedGroups,
    hiddenJoinedGroups,
    browseGroups,
    pendingJoinRequestsSent,

    followedProfiles,

    loadingGroups,
    loadingCommunities,
    loadingFollowing,

    groupsErr,
    msg,

    activeView,
    openCommunities,

    joinRequestsByGroup,
    greetingsByGroup,
    buyerPending,
    buyerDelivered,

    meetGreetsByGroup,
    exclusiveSessionsByGroup,

    buyerMeetGreets,
    buyerExclusiveSessions,

    greetingSectionOpen,
    joinSectionOpen,
    seenCountsByGroup,

    userMiniMap,
    groupMetaMap,
  ]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Fuerza un ID token válido ANTES de exponer `viewer`: los ~10 listeners
        // onSnapshot del sidebar se gatillan en cuanto viewer.uid cambia, y en un
        // dispositivo recién logueado pueden salir sin token → el servidor ve
        // request.auth == null y deniega ("missing or insufficient permissions").
        // Un permission-denied en onSnapshot es terminal, así que evitamos la carrera.
        try {
          await auth.authStateReady();
          await u.getIdToken();
        } catch {
          /* si falla, continuamos: el SDK reintentará adjuntar el token */
        }
      }
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Red de seguridad: si algún listener alcanzó a fallar con permission-denied
  // transitorio (token aún no propagado), re-suscribe UNA vez tras un pequeño
  // margen. El guard por ref evita bucles si el error fuese permanente.
  const permissionRetriedRef = useRef(false);
  useEffect(() => {
    if (!groupsErr || permissionRetriedRef.current) return;
    if (!/insufficient permissions|permission-denied/i.test(groupsErr)) return;

    permissionRetriedRef.current = true;
    const timer = window.setTimeout(() => {
      ownerSidebarCache = null;
      setGroupsErr(null);
      setOwnerSidebarRefreshKey((value) => value + 1);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [groupsErr]);


  useEffect(() => {
    async function loadCurrentUser() {
      if (!viewer?.uid) {
        setUserDoc(null);
        setLoadingUser(false);
        return;
      }

      setLoadingUser(true);
      setMsg(null);

      try {
        const uref = doc(db, "users", viewer.uid);
        const usnap = await getDoc(uref);

        if (!usnap.exists()) {
          setUserDoc(null);
          return;
        }

        const u = usnap.data() as UserDoc;
        setUserDoc(u);

        setUserMiniMap((prev) => ({
          ...prev,
          [viewer.uid]: {
            uid: viewer.uid,
            displayName: buildDisplayName(u, viewer.uid, tCommon("user")),
            handle: u.handle ?? null,
            photoURL: u.photoURL ?? null,
          },
        }));
      } catch (e: unknown) {
        setMsg((e instanceof Error ? e.message : null) ?? tCommon("errorLoadProfile"));
        setUserDoc(null);
      } finally {
        setLoadingUser(false);
      }
    }

    loadCurrentUser();
  }, [viewer?.uid, ownerSidebarRefreshKey]);

  useEffect(() => {
    if (!viewer?.uid) {
      setMyGroups([]);
      setOpenCommunities({});
      setLoadingGroups(false);
      return;
    }

    setLoadingGroups(true);
    setGroupsErr(null);

    const gq = query(
      collection(db, "groups"),
      where("ownerId", "==", viewer.uid),
      limit(50)
    );

    const unsub = onSnapshot(
      gq,
      (snap) => {
        const rows: GroupDocLite[] = snap.docs
          .map((d) => ({
            ...(d.data() as Omit<GroupDocLite, "id">),
            id: d.id,
          }))
          .filter((g) => g.isDeleted !== true && !g.deletedAt);

        setMyGroups(rows);

        const initialOpen: Record<string, boolean> = {};
        const initialGreetingOpen: Record<string, boolean> = {};
        const initialJoinOpen: Record<string, boolean> = {};
        const initialGroupMeta: Record<string, GroupDocLite> = {};

        for (const g of rows) {
          initialOpen[g.id] = false;
          initialGreetingOpen[g.id] = false;
          initialJoinOpen[g.id] = false;
          initialGroupMeta[g.id] = {
            ...g,
            memberRole: "owner",
          };
        }

        setOpenCommunities((prev) => ({ ...initialOpen, ...prev }));
        setGreetingSectionOpen((prev) => ({ ...initialGreetingOpen, ...prev }));
        setJoinSectionOpen((prev) => ({ ...initialJoinOpen, ...prev }));
        setGroupMetaMap((prev) => ({ ...prev, ...initialGroupMeta }));
        setLoadingGroups(false);
      },
      (e: FirestoreError) => {
        setGroupsErr(e.message ?? tCommon("loadError"));
        setMyGroups([]);
        setOpenCommunities({});
        setLoadingGroups(false);
      }
    );

    return () => unsub();
  }, [viewer?.uid, ownerSidebarRefreshKey]);

  // Keep joinedGroupIdsRef in sync for browse-groups filtering
  useEffect(() => {
    joinedGroupIdsRef.current = new Set([
      ...myGroups.map((g) => g.id),
      ...joinedGroups.map((g) => g.id),
      ...hiddenJoinedGroups.map((g) => g.id),
    ]);
  }, [myGroups, joinedGroups, hiddenJoinedGroups]);

  // All group memberships (public + private + hidden) via a single real-time listener.
  // Replaces the old loop that made up to 200 individual getDoc calls.
  useEffect(() => {
    if (!viewer?.uid) {
      setJoinedGroups([]);
      setPendingJoinRequestsSent([]);
      setLoadingCommunities(false);
      return;
    }

    setLoadingCommunities(true);
    setGroupsErr(null);

    const unsub = subscribeToMySidebarGroups(
      viewer.uid,
      (sidebarGroups) => {
        const allMemberships: GroupDocLite[] = sidebarGroups
          .filter((g) => g.ownerId !== viewer.uid && g.memberRole !== "owner")
          .map((g) => ({
            id: g.id,
            name: g.name ?? undefined,
            ownerId: g.ownerId ?? undefined,
            visibility: g.visibility ?? undefined,
            avatarUrl: g.avatarUrl ?? null,
            memberStatus: normalizeSidebarMemberStatus(g.memberStatus ?? null),
            memberRole: normalizeSidebarGroupRole(g.memberRole ?? null),
            monetization: g.monetization ?? undefined,
            offerings: g.offerings ?? [],
            membershipAccessType: g.membershipAccessType ?? null,
            requiresSubscription: g.requiresSubscription ?? null,
            subscriptionActive: g.subscriptionActive ?? null,
            legacyComplimentary: g.legacyComplimentary ?? null,
            transitionPendingAction: g.transitionPendingAction ?? null,
            transitionReason: g.transitionReason ?? null,
            canDismiss: g.canDismiss ?? null,
            sidebarState: g.sidebarState ?? null,
          }));

        // Public/private memberships → joinedGroups
        const joined = allMemberships.filter((g) => g.visibility !== "hidden");
        // Hidden memberships → merged into hiddenJoinedGroups keeping transition entries
        const hiddenMembership = allMemberships.filter(
          (g) => g.visibility === "hidden"
        );

        setJoinedGroups(joined);
        setPendingJoinRequestsSent([]);

        // Preserve existing "requires_subscription" transition entries (from hiddenGroupTransitions listener)
        setHiddenJoinedGroups((prev) => {
          const transitionEntries = prev.filter(
            (g) => g.sidebarState === "requires_subscription"
          );
          const membershipIds = new Set(hiddenMembership.map((g) => g.id));
          const newTransitions = transitionEntries.filter(
            (g) => !membershipIds.has(g.id)
          );
          return [...hiddenMembership, ...newTransitions];
        });

        const meta: Record<string, GroupDocLite> = {};
        allMemberships.forEach((g) => {
          meta[g.id] = g;
        });
        setGroupMetaMap((prev) => ({ ...prev, ...meta }));

        setLoadingCommunities(false);
      },
      (e: Error) => {
        setGroupsErr(
          e.message ?? tCommon("loadError")
        );
        setJoinedGroups([]);
        setLoadingCommunities(false);
      }
    );

    return () => unsub();
  }, [viewer?.uid, ownerSidebarRefreshKey]);

  // Browse groups (discovery): public/private groups the user hasn't joined.
  // No membership checks — joinedGroupIdsRef already holds that data.
  useEffect(() => {
    if (!viewer?.uid) {
      setBrowseGroups([]);
      return;
    }

    const communitiesQ = query(
      collection(db, "groups"),
      where("visibility", "in", ["public", "private"]),
      limit(100)
    );

    const unsub = onSnapshot(
      communitiesQ,
      (snap) => {
        const joinedIds = joinedGroupIdsRef.current;
        const explorable = snap.docs
          .map((d) => ({
            ...(d.data() as Omit<GroupDocLite, "id">),
            id: d.id,
          }))
          .filter(
            (g) =>
              !joinedIds.has(g.id) &&
              g.ownerId !== viewer.uid &&
              g.isDeleted !== true &&
              !g.deletedAt
          );
        setBrowseGroups(explorable);
      },
      (e: FirestoreError) => {
        setGroupsErr(e.message ?? tCommon("loadError"));
        setBrowseGroups([]);
      }
    );

    return () => unsub();
  }, [viewer?.uid, ownerSidebarRefreshKey]);

  useEffect(() => {
    let cancelled = false;

    if (!viewer?.uid) {
      followedProfilesRef.current = [];
      setFollowedProfiles([]);
      setLoadingFollowing(false);
      return;
    }

    // Reset cache on viewer change or sidebar refresh so stale profiles don't persist
    followedProfilesRef.current = [];
    setLoadingFollowing(true);

    const followingQ = query(
      collection(db, "users", viewer.uid, "following"),
      orderBy("createdAt", "desc"),
      limit(OWNER_SIDEBAR_FOLLOWING_LIMIT)
    );

    const unsub = onSnapshot(
      followingQ,
      async (snap) => {
        try {
          const targetUserIds = snap.docs
            .map((d) => {
              const data = d.data() as {
                targetUserId?: string | null;
              };

              return typeof data.targetUserId === "string" &&
                data.targetUserId.trim()
                ? data.targetUserId.trim()
                : d.id;
            })
            .filter((uid) => uid && uid !== viewer.uid);

          const uniqueTargetUserIds = Array.from(new Set(targetUserIds));

          // Reuse profiles already in memory; only fetch unknown UIDs.
          // For unfollow this means zero network calls — update is instant.
          const cachedMap = new Map(followedProfilesRef.current.map((p) => [p.uid, p]));
          const toFetch = uniqueTargetUserIds.filter((uid) => !cachedMap.has(uid));

          const fetched = await Promise.all(
            toFetch.map(async (targetUserId) => {
              try {
                const userSnap = await getDoc(doc(db, "users", targetUserId));

                if (!userSnap.exists()) return null;

                const data = userSnap.data() as UserDoc;

                if (data.profileRestricted === true) return null;

                const handle =
                  typeof data.handle === "string" && data.handle.trim()
                    ? data.handle.trim()
                    : null;

                if (!handle) return null;

                return {
                  uid: targetUserId,
                  displayName: buildDisplayName(data, targetUserId, tCommon("user")),
                  handle,
                  photoURL:
                    typeof data.photoURL === "string" && data.photoURL.trim()
                      ? data.photoURL.trim()
                      : null,
                } satisfies FollowedProfileLite;
              } catch {
                return null;
              }
            })
          );

          if (cancelled) return;

          const fetchedMap = new Map(
            fetched
              .filter((p): p is FollowedProfileLite => p !== null)
              .map((p) => [p.uid, p])
          );

          const nextProfiles = uniqueTargetUserIds
            .map((uid) => cachedMap.get(uid) ?? fetchedMap.get(uid) ?? null)
            .filter((p): p is FollowedProfileLite => p !== null);

          followedProfilesRef.current = nextProfiles;
          setFollowedProfiles(nextProfiles);
        } catch (e: unknown) {
          if (!cancelled) {
            setGroupsErr(
              (e instanceof Error ? e.message : null) ?? tCommon("loadError")
            );
            followedProfilesRef.current = [];
            setFollowedProfiles([]);
          }
        } finally {
          if (!cancelled) {
            setLoadingFollowing(false);
          }
        }
      },
      (e: FirestoreError) => {
        if (!cancelled) {
          setGroupsErr(
            e.message ?? tCommon("loadError")
          );
          followedProfilesRef.current = [];
          setFollowedProfiles([]);
          setLoadingFollowing(false);
        }
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [viewer?.uid, ownerSidebarRefreshKey]);

  // Real-time listener for subscription-pending reminders (hiddenGroupTransitions).
  // Replaces the old 10-second polling + Cloud Function call.
  useEffect(() => {
    if (!viewer?.uid) return;

    const unsub = onSnapshot(
      collection(db, "users", viewer.uid, "hiddenGroupTransitions"),
      (snap) => {
        const transitionGroups: GroupDocLite[] = snap.docs
          .flatMap((d) => {
            const data = d.data() as Record<string, unknown>;
            if (data.requiresSubscription !== true) return [];
            const entry: GroupDocLite = {
              id: d.id,
              name: typeof data.groupName === "string" ? data.groupName : undefined,
              ownerId: typeof data.ownerId === "string" ? data.ownerId : undefined,
              visibility: typeof data.visibility === "string" ? data.visibility : "hidden",
              avatarUrl: typeof data.avatarUrl === "string" ? data.avatarUrl : null,
              memberStatus: null,
              memberRole: null,
              requiresSubscription: true,
              subscriptionActive: data.subscriptionActive === true,
              legacyComplimentary: null,
              transitionPendingAction: data.transitionPendingAction === true,
              transitionReason: typeof data.reason === "string" ? data.reason : null,
              canDismiss: data.canDismiss === true,
              sidebarState: "requires_subscription",
              previousSubscriptionPriceMonthly:
                typeof data.previousSubscriptionPriceMonthly === "number"
                  ? data.previousSubscriptionPriceMonthly
                  : null,
              nextSubscriptionPriceMonthly:
                typeof data.nextSubscriptionPriceMonthly === "number"
                  ? data.nextSubscriptionPriceMonthly
                  : null,
              subscriptionPriceChangeCurrency:
                typeof data.subscriptionPriceChangeCurrency === "string"
                  ? data.subscriptionPriceChangeCurrency
                  : null,
            };
            return [entry];
          });

        setHiddenJoinedGroups((prev) => {
          const nonTransition = prev.filter(
            (g) => g.sidebarState !== "requires_subscription"
          );
          if (transitionGroups.length === 0) return nonTransition;
          const transitionIds = new Set(transitionGroups.map((g) => g.id));
          const dedupedNonTransition = nonTransition.filter(
            (g) => !transitionIds.has(g.id)
          );
          return [...dedupedNonTransition, ...transitionGroups];
        });

        if (transitionGroups.length > 0) {
          const meta: Record<string, GroupDocLite> = {};
          transitionGroups.forEach((g) => {
            meta[g.id] = g;
          });
          setGroupMetaMap((prev) => ({ ...prev, ...meta }));
        }
      }
    );

    return () => unsub();
  }, [viewer?.uid, ownerSidebarRefreshKey]);

  const hiddenSidebarMembershipGroups = useMemo(() => {
    return hiddenJoinedGroups.filter(
      (g) => g.sidebarState !== "requires_subscription"
    );
  }, [hiddenJoinedGroups]);

  const subscriptionPendingGroups = useMemo(() => {
    return hiddenJoinedGroups.filter(
      (g) => g.sidebarState === "requires_subscription"
    );
  }, [hiddenJoinedGroups]);

  const moderatedGroups = useMemo(() => {
    const mergedMap = new Map<string, GroupDocLite>();

    [...joinedGroups, ...hiddenSidebarMembershipGroups].forEach((g) => {
      if (g.memberRole === "mod") {
        mergedMap.set(g.id, g);
      }
    });

    return Array.from(mergedMap.values());
  }, [joinedGroups, hiddenSidebarMembershipGroups]);

  useEffect(() => {
    joinUnsubsRef.current.forEach((fn) => fn());
    joinUnsubsRef.current = [];

    if (!viewer?.uid) {
      setJoinRequestsByGroup({});
      return;
    }

    const targetGroupsMap = new Map<string, GroupDocLite>();

    for (const g of myGroups) {
      if (g.visibility !== "public") {
        targetGroupsMap.set(g.id, g);
      }
    }

    for (const g of moderatedGroups) {
      if (g.visibility !== "public") {
        targetGroupsMap.set(g.id, g);
      }
    }

    const targetGroups = Array.from(targetGroupsMap.values());

    if (targetGroups.length === 0) {
      setJoinRequestsByGroup({});
      return;
    }

    const unsubs: Array<() => void> = [];

    for (const g of targetGroups) {
      const qy = query(
        collection(db, "groups", g.id, "joinRequests"),
        where("status", "==", "pending")
      );

      const unsub = onSnapshot(
        qy,
        (snap) => {
          const list: JoinRequestRow[] = [];
          snap.forEach((d) => {
            const data = d.data() as { userId?: string };
            list.push({
              id: d.id,
              userId: data.userId ?? d.id,
            });
          });

          setJoinRequestsByGroup((prev) => ({
            ...prev,
            [g.id]: list,
          }));
        },
        (e: FirestoreError) => {
          setGroupsErr(e.message ?? tCommon("loadError"));
          setJoinRequestsByGroup((prev) => ({
            ...prev,
            [g.id]: [],
          }));
        }
      );

      unsubs.push(unsub);
    }

    joinUnsubsRef.current = unsubs;

    return () => {
      unsubs.forEach((fn) => fn());
      joinUnsubsRef.current = [];
    };
  }, [viewer?.uid, myGroups, moderatedGroups]);

  useEffect(() => {
    if (!viewer?.uid) {
      setGreetingsByGroup({});
      setBuyerPending([]);
      setBuyerDelivered([]);
      return;
    }

    const incomingQ = query(
      collection(db, "greetingRequests"),
      where("creatorId", "==", viewer.uid),
      where("status", "==", "pending"),
      limit(50)
    );

    const buyerQ = query(
      collection(db, "greetingRequests"),
      where("buyerId", "==", viewer.uid),
      where("status", "==", "pending"),
      limit(50)
    );

    const buyerDeliveredQ = query(
      collection(db, "greetingRequests"),
      where("buyerId", "==", viewer.uid),
      where("status", "==", "delivered"),
      limit(50)
    );

    const buyerRejectedQ = query(
      collection(db, "greetingRequests"),
      where("buyerId", "==", viewer.uid),
      where("status", "in", ["rejected", "refund_requested"]),
      limit(50)
    );

    const unsubIncoming = onSnapshot(
      incomingQ,
      (snap) => {
        const grouped: Record<
          string,
          Array<{ id: string; data: GreetingRequestDoc }>
        > = {};

                snap.docs.forEach((d) => {
          const data = d.data() as GreetingRequestDoc;

          if (data.status !== "pending") return;
          // No mostrar al creador saludos sin pagar (esperando pago en MP).
          if ((data as { paymentStatus?: string }).paymentStatus === "awaiting_payment") return;

          const bucketKey = getServiceBucketKey(data);

          if (!bucketKey) return;

          if (!grouped[bucketKey]) grouped[bucketKey] = [];

          grouped[bucketKey].push({ id: d.id, data });
        });

        setGreetingsByGroup(grouped);
      },
      (e: FirestoreError) => {
        setGroupsErr(
          e.message ?? tCommon("loadError")
        );
        setGreetingsByGroup({});
      }
    );

    const unsubBuyer = onSnapshot(
      buyerQ,
      async (snap) => {
        const rows = snap.docs
          .map((d) => ({
            id: d.id,
            data: d.data() as GreetingRequestDoc,
          }))
          // Ocultar solicitudes propias sin pagar (esperando pago en MP).
          .filter(
            (r) =>
              (r.data as { paymentStatus?: string }).paymentStatus !== "awaiting_payment"
          );

        setBuyerPending(rows);

        const currentGroupMetaMap = groupMetaMapRef.current;

        const missingGroupIds = rows
          .map((r) => r.data.groupId)
          .filter(
            (groupId): groupId is string =>
              typeof groupId === "string" && groupId.trim().length > 0
          )
          .filter((groupId) => !currentGroupMetaMap[groupId]);

        if (missingGroupIds.length > 0) {
          const fetched = await Promise.all(
            Array.from(new Set(missingGroupIds)).map(async (groupId) => {
              try {
                const snap = await getDoc(doc(db, "groups", groupId));
                if (!snap.exists()) return null;
                return {
                  ...(snap.data() as Omit<GroupDocLite, "id">),
                  id: snap.id,
                };
              } catch {
                return null;
              }
            })
          );

          const meta: Record<string, GroupDocLite> = {};
          fetched.filter(Boolean).forEach((g) => {
            const gg = g as GroupDocLite;
            meta[gg.id] = gg;
          });

          if (Object.keys(meta).length > 0) {
            setGroupMetaMap((prev) => ({ ...prev, ...meta }));
          }
        }
      },
      () => {
        setBuyerPending([]);
      }
    );

    const unsubBuyerDelivered = onSnapshot(
      buyerDeliveredQ,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as GreetingRequestDoc,
        }));
        rows.sort((a, b) => {
          const ta = a.data.deliveredAt?.toMillis?.() ?? 0;
          const tb = b.data.deliveredAt?.toMillis?.() ?? 0;
          return tb - ta;
        });
        setBuyerDelivered(rows);
      },
      () => {
        setBuyerDelivered([]);
      }
    );

    const unsubBuyerRejected = onSnapshot(
      buyerRejectedQ,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as GreetingRequestDoc,
        }));
        setBuyerRejectedGreetings(rows);
      },
      () => { setBuyerRejectedGreetings([]); }
    );

    return () => {
      unsubIncoming();
      unsubBuyer();
      unsubBuyerDelivered();
      unsubBuyerRejected();
    };
  }, [viewer?.uid, ownerSidebarRefreshKey]);

    useEffect(() => {
    if (!viewer?.uid) {
      setMeetGreetsByGroup({});
      setBuyerMeetGreets([]);
      return;
    }

    const creatorQ = query(
      collection(db, "meetGreetRequests"),
      where("creatorId", "==", viewer.uid),
      limit(100)
    );

    const buyerQ = query(
      collection(db, "meetGreetRequests"),
      where("buyerId", "==", viewer.uid),
      limit(100)
    );

    const unsubCreator = onSnapshot(
      creatorQ,
      (snap) => {
        const grouped: Record<
          string,
          Array<{ id: string; data: MeetGreetRequestDoc }>
        > = {};

        snap.docs.forEach((d) => {
          const data = normalizeOwnerSidebarNoShowStatus({
            ...(d.data() as MeetGreetRequestDoc),
            id: d.id,
          });

          const bucketKey = getServiceBucketKey(data);

          if (!bucketKey) return;
          if (!isMeetGreetCreatorActiveItem(data.status)) return;

          if (!grouped[bucketKey]) grouped[bucketKey] = [];

          grouped[bucketKey].push({
            id: d.id,
            data,
          });
        });

        setMeetGreetsByGroup(grouped);
      },
      (e: FirestoreError) => {
        setGroupsErr(
          e.message ?? tCommon("loadError")
        );
        setMeetGreetsByGroup({});
      }
    );

    const unsubBuyer = onSnapshot(
      buyerQ,
      async (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: normalizeOwnerSidebarNoShowStatus({
            ...(d.data() as MeetGreetRequestDoc),
            id: d.id,
          }),
        }));

        setBuyerMeetGreets(rows);

        const missingGroupIds = rows
          .map((r) => r.data.groupId)
          .filter((groupId): groupId is string => !!groupId)
          .filter((groupId) => !groupMetaMapRef.current[groupId]);

        if (missingGroupIds.length > 0) {
          const fetched = await Promise.all(
            Array.from(new Set(missingGroupIds)).map(async (groupId) => {
              try {
                const groupSnap = await getDoc(doc(db, "groups", groupId));
                if (!groupSnap.exists()) return null;

                return {
                  ...(groupSnap.data() as Omit<GroupDocLite, "id">),
                  id: groupSnap.id,
                };
              } catch {
                return null;
              }
            })
          );

          const meta: Record<string, GroupDocLite> = {};
          fetched.filter(Boolean).forEach((g) => {
            const gg = g as GroupDocLite;
            meta[gg.id] = gg;
          });

          if (Object.keys(meta).length > 0) {
            setGroupMetaMap((prev) => ({ ...prev, ...meta }));
          }
        }
      },
      () => {
        setBuyerMeetGreets([]);
      }
    );

    return () => {
      unsubCreator();
      unsubBuyer();
    };
  }, [viewer?.uid, ownerSidebarRefreshKey]);

    useEffect(() => {
    if (!viewer?.uid) {
      setExclusiveSessionsByGroup({});
      setBuyerExclusiveSessions([]);
      return;
    }

    const creatorQ = query(
      collection(db, "exclusiveSessionRequests"),
      where("creatorId", "==", viewer.uid),
      limit(100)
    );

    const buyerQ = query(
      collection(db, "exclusiveSessionRequests"),
      where("buyerId", "==", viewer.uid),
      limit(100)
    );

    const unsubCreator = onSnapshot(
      creatorQ,
      (snap) => {
        const grouped: Record<
          string,
          Array<{ id: string; data: ExclusiveSessionRequestDoc }>
        > = {};

        snap.docs.forEach((d) => {
          const data = normalizeOwnerSidebarNoShowStatus({
            ...(d.data() as ExclusiveSessionRequestDoc),
            id: d.id,
            type: "digital_exclusive_session",
          }) as ExclusiveSessionRequestDoc;

          const bucketKey = getServiceBucketKey(data);

          if (!bucketKey) return;
          if (!isMeetGreetCreatorActiveItem(data.status)) return;

          if (!grouped[bucketKey]) grouped[bucketKey] = [];

          grouped[bucketKey].push({
            id: d.id,
            data,
          });
        });

        setExclusiveSessionsByGroup(grouped);
      },
      (e: FirestoreError) => {
        setGroupsErr(
          e.message ?? tCommon("loadError")
        );
        setExclusiveSessionsByGroup({});
      }
    );

    const unsubBuyer = onSnapshot(
      buyerQ,
      async (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: normalizeOwnerSidebarNoShowStatus({
            ...(d.data() as ExclusiveSessionRequestDoc),
            id: d.id,
            type: "digital_exclusive_session",
          }) as ExclusiveSessionRequestDoc,
        }));

        setBuyerExclusiveSessions(rows);

        const missingGroupIds = rows
          .map((r) => r.data.groupId)
          .filter((groupId): groupId is string => !!groupId)
          .filter((groupId) => !groupMetaMapRef.current[groupId]);

        if (missingGroupIds.length > 0) {
          const fetched = await Promise.all(
            Array.from(new Set(missingGroupIds)).map(async (groupId) => {
              try {
                const groupSnap = await getDoc(doc(db, "groups", groupId));
                if (!groupSnap.exists()) return null;

                return {
                  ...(groupSnap.data() as Omit<GroupDocLite, "id">),
                  id: groupSnap.id,
                };
              } catch {
                return null;
              }
            })
          );

          const meta: Record<string, GroupDocLite> = {};

          fetched.filter(Boolean).forEach((g) => {
            const gg = g as GroupDocLite;
            meta[gg.id] = gg;
          });

          if (Object.keys(meta).length > 0) {
            setGroupMetaMap((prev) => ({ ...prev, ...meta }));
          }
        }
      },
      () => {
        setBuyerExclusiveSessions([]);
      }
    );

    return () => {
      unsubCreator();
      unsubBuyer();
    };
  }, [viewer?.uid, ownerSidebarRefreshKey]);

  useEffect(() => {
    const profileBucketKey = viewer?.uid ? `profile:${viewer.uid}` : null;

const groupsForSeen = [
  ...myGroups.map((g) => g.id),
  ...moderatedGroups.map((g) => g.id),
  ...(profileBucketKey ? [profileBucketKey] : []),
];

    if (groupsForSeen.length === 0) return;

    setSeenCountsByGroup((prev) => {
      const next = { ...prev };

      for (const groupId of groupsForSeen) {
        const joinCount = (joinRequestsByGroup[groupId] ?? []).length;
        // Ninguna experiencia (saludos/consejos, tiempo contigo, sesión exclusiva)
        // se muestra ya en el sidebar —viven en la pestaña Experiencias—, así que
        // no cuentan para el indicador "nuevo".
        const greetingCount = 0;

        if (!next[groupId]) {
          next[groupId] = { join: 0, greeting: 0 };
          continue;
        }

        next[groupId] = {
          join: Math.min(next[groupId].join, joinCount),
          greeting: Math.min(next[groupId].greeting, greetingCount),
        };
      }

      return next;
    });
  }, [
  viewer?.uid,
  myGroups,
  moderatedGroups,
  joinRequestsByGroup,
  greetingsByGroup,
  exclusiveSessionsByGroup,
  meetGreetsByGroup,
]);

  const relevantUserIds = useMemo(() => {
    const ids = new Set<string>();

    for (const rows of Object.values(joinRequestsByGroup)) {
      rows.forEach((r) => ids.add(r.userId));
    }

    for (const rows of Object.values(greetingsByGroup)) {
      rows.forEach((r) => ids.add(r.data.buyerId));
    }

    for (const rows of Object.values(meetGreetsByGroup)) {
      rows.forEach((r) => ids.add(r.data.buyerId));
    }

    for (const rows of Object.values(exclusiveSessionsByGroup)) {
      rows.forEach((r) => ids.add(r.data.buyerId));
    }

    buyerPending.forEach((r) => ids.add(r.data.creatorId));
    buyerDelivered.forEach((r) => ids.add(r.data.creatorId));
    buyerMeetGreets.forEach((r) => ids.add(r.data.creatorId));
    buyerExclusiveSessions.forEach((r) => ids.add(r.data.creatorId));

    return Array.from(ids).filter(Boolean);
  }, [
    joinRequestsByGroup,
    greetingsByGroup,
    meetGreetsByGroup,
    buyerPending,
    buyerDelivered,
    buyerMeetGreets,
    exclusiveSessionsByGroup,
    buyerExclusiveSessions,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadUserMiniMap() {
      const missing = relevantUserIds.filter((uid) => !userMiniMap[uid]);
      if (missing.length === 0) return;

      const pairs = await Promise.all(
        missing.map(async (uid) => {
          try {
            const snap = await getDoc(doc(db, "users", uid));

            if (!snap.exists()) {
              return [
                uid,
                {
                  uid,
                  displayName: buildDisplayName(null, uid, tCommon("user")),
                  handle: null,
                  photoURL: null,
                } satisfies UserMini,
              ] as const;
            }

            const data = snap.data() as UserDoc;
            return [
              uid,
              {
                uid,
                displayName: buildDisplayName(data, uid, tCommon("user")),
                handle: data.handle ?? null,
                photoURL: data.photoURL ?? null,
              } satisfies UserMini,
            ] as const;
          } catch {
            return [
              uid,
              {
                uid,
                displayName: buildDisplayName(null, uid, tCommon("user")),
                handle: null,
                photoURL: null,
              } satisfies UserMini,
            ] as const;
          }
        })
      );

      if (cancelled) return;

      setUserMiniMap((prev) => {
        const next = { ...prev };
        for (const [uid, meta] of pairs) next[uid] = meta;
        return next;
      });
    }

    loadUserMiniMap();

    return () => {
      cancelled = true;
    };
  }, [relevantUserIds, userMiniMap]);

  const pendingCount = useMemo(() => {
    let total = buyerPending.length;

    for (const row of buyerMeetGreets) {
      if (isBuyerRequestedVisibleItem(row.data.status)) {
        total += 1;
      }
    }

    for (const row of buyerExclusiveSessions) {
      if (isBuyerRequestedVisibleItem(row.data.status)) {
        total += 1;
      }
    }

    return total;
  }, [buyerPending, buyerMeetGreets, buyerExclusiveSessions]);

  useEffect(() => {
    if (pendingCount === 0 && buyerDelivered.length === 0 && buyerRejectedGreetings.length === 0 && activeView === "greetings") {
      setActiveView("owned");
    }
  }, [pendingCount, buyerDelivered.length, buyerRejectedGreetings.length, activeView]);

  const prevGreetingsTotalRef = useRef(0);
  useEffect(() => {
    const total = pendingCount + buyerDelivered.length;
    const prev = prevGreetingsTotalRef.current;
    prevGreetingsTotalRef.current = total;
    if (total > 0 && prev === 0) {
      setActiveView("greetings");
      setAccordionOpen(true);
    }
  }, [pendingCount, buyerDelivered.length]);

  async function handleApproveJoin(groupId: string, userId: string) {
    try {
      setGroupsErr(null);
      const busyKey = `${groupId}:${userId}:approve`;
      setJoinBusyKey(busyKey);

      setJoinRequestsByGroup((prev) => ({
        ...prev,
        [groupId]: (prev[groupId] ?? []).filter((r) => r.userId !== userId),
      }));

      await approveJoinRequest(groupId, userId);
      showSidebarToast(tCommon("successApproveJoin"));
    } catch (e: unknown) {
      const friendly = friendlyJoinErrorMessage(e, tCommon("generalError"));
      if (friendly) setGroupsErr(friendly);

      setJoinRequestsByGroup((prev) => {
        const exists = (prev[groupId] ?? []).some((r) => r.userId === userId);
        if (exists) return prev;
        return {
          ...prev,
          [groupId]: [{ id: userId, userId }, ...(prev[groupId] ?? [])],
        };
      });
    } finally {
      setJoinBusyKey(null);
    }
  }

  async function handleRejectJoin(groupId: string, userId: string) {
    try {
      setGroupsErr(null);
      const busyKey = `${groupId}:${userId}:reject`;
      setJoinBusyKey(busyKey);

      setJoinRequestsByGroup((prev) => ({
        ...prev,
        [groupId]: (prev[groupId] ?? []).filter((r) => r.userId !== userId),
      }));

      await rejectJoinRequest(groupId, userId);
      showSidebarToast(tCommon("successRejectJoin"));
    } catch (e: unknown) {
      const friendly = friendlyJoinErrorMessage(e, tCommon("generalError"));
      if (friendly) setGroupsErr(friendly);

      setJoinRequestsByGroup((prev) => {
        const exists = (prev[groupId] ?? []).some((r) => r.userId === userId);
        if (exists) return prev;
        return {
          ...prev,
          [groupId]: [{ id: userId, userId }, ...(prev[groupId] ?? [])],
        };
      });
    } finally {
      setJoinBusyKey(null);
    }
  }

  async function handleGreetingAction(
    requestId: string,
    action: "accept" | "reject"
  ) {
    if (!viewer?.uid) return;

    setGroupsErr(null);
    setGreetingBusyId(requestId);

    try {
      await respondGreetingRequest({ requestId, action });
      showSidebarToast(
        action === "accept"
          ? tCommon("successServiceAccepted")
          : tCommon("successServiceRejected")
      );
    } catch (e: unknown) {
      showSidebarToast((e instanceof Error ? e.message : null) ?? tCommon("errorUpdateRequest"), "error");
    } finally {
      setGreetingBusyId(null);
    }
  }

  function renderUserLink(uid: string) {
    const u = userMiniMap[uid];
    const label = u?.displayName ?? buildDisplayName(null, uid, tCommon("user"));
    const href = u?.handle ? `/u/${u.handle}` : null;

    if (!href) {
      return (
        <span
          style={{
            color: "#fff",
            fontWeight: 600,
            fontSize: 12,
            lineHeight: 1.2,
          }}
        >
          {label}
        </span>
      );
    }

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          router.push(href);
        }}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          color: "#fff",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: 12,
          lineHeight: 1.2,
          textDecoration: "none",
        }}
      >
        {label}
      </button>
    );
  }

  function renderCommunityCard(
    g: GroupDocLite,
    opts?: { compact?: boolean; subtitle?: React.ReactNode }
  ) {
const communityName = g.name ?? tGroups("noName");
const avatarFallback = getInitials(communityName);
const isProfileCard = g.visibility === "profile" && !!g.profileHref;
const canCopyLink = g.visibility !== "hidden";
const copyHref = isProfileCard ? g.profileHref! : `/groups/${g.id}`;
const copyTitle = isProfileCard
  ? tCommon("copyProfileLink")
  : tCommon("copyGroupLink");
  const isSelectedGroup = isProfileCard
  ? pathname === g.profileHref
  : pathname === `/groups/${g.id}`;

    const autoSubscriptionSubtitle =
      !opts?.subtitle &&
      resolveSidebarSubscriptionEnabled(g) &&
      (g.visibility === "private" || g.visibility === "hidden")
        ? (() => {
            const price = resolveSidebarSubscriptionPrice(g);
            const currency = resolveSidebarSubscriptionCurrency(g);

            if (
              price != null &&
              currency &&
              (currency === "MXN" || currency === "USD")
            ) {
              return `${tCommon("activeSubscription")} · ${formatMoney(price, { baseCurrency: currency ?? "MXN", code: true })}`;
            }

            return tCommon("activeSubscription");
          })()
        : null;

return (
  <div
    className="owner-sidebar-community-card"
style={{
  ...styles.card,
padding: "10px 12px",
display: "flex",
alignItems: "center",
gap: 8,
margin: 0,
borderRadius: 16,

background:
  !isSelectedGroup
    ? "transparent"
    : "linear-gradient(90deg, rgba(236,72,153,0.20) 0%, rgba(147,51,234,0.18) 42%, rgba(59,130,246,0.14) 100%)",

border: "none",

boxShadow:
  !isSelectedGroup
    ? "none"
    : "inset 0 1px 0 rgba(255,255,255,0.04), 0 10px 24px rgba(0,0,0,0.22)",

backdropFilter: "none",
WebkitBackdropFilter: "none",
}}
  >
<button
  type="button"
  className="owner-sidebar-community-card-main"
  onClick={() => { incrementVisit(g.id); router.push(isProfileCard ? g.profileHref! : `/groups/${g.id}`); }}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            color: "#fff",
            textAlign: "left",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
            width: "100%",
          }}
        >
          <LiveRingAvatar
            entityId={isProfileCard ? (g.ownerId ?? g.id) : g.id}
            entityType={isProfileCard ? "profile" : "group"}
            currentUserId={null}
            photoURL={g.avatarUrl ?? null}
            displayName={communityName}
            size={isMobile ? 43 : 36}
            style={{ flexShrink: 0 }}
          />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
fontSize: 13,
fontWeight: 500,
fontFamily: fontStack,
letterSpacing: "-0.08px",
color: "rgba(255,255,255,0.94)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {communityName}
            </div>

            {opts?.subtitle ? (
              <div style={styles.subtle}>{opts.subtitle}</div>
            ) : autoSubscriptionSubtitle ? (
              <div style={styles.subtle}>{autoSubscriptionSubtitle}</div>
            ) : (newPostsCounts[g.id] ?? 0) > 0 ? (
              <div
                style={{
                  fontSize: 10.5,
                  color: "#a855f7",
                  fontWeight: 700,
                  lineHeight: 1.3,
                  marginTop: 1,
                }}
              >
                {tCommon("newPostsCount", { count: newPostsCounts[g.id] })}
              </div>
            ) : null}
          </div>
        </button>

{canCopyLink && (
  <CopyLinkButton
    href={copyHref}
    title={copyTitle}
    style={{
      flexShrink: 0,
    }}
  />
)}
      </div>
    );
  }

  const ownedGrouped = useMemo(() => {
    const publics = myGroups.filter((g) => g.visibility === "public");
    const privates = myGroups.filter((g) => g.visibility === "private");
    const hiddens = myGroups.filter((g) => g.visibility === "hidden");
    const others = myGroups.filter(
      (g) =>
        g.visibility !== "public" &&
        g.visibility !== "private" &&
        g.visibility !== "hidden"
    );

    return [
      { key: "public", title: visibilitySectionTitle("public", tGroups), items: publics },
      {
        key: "private",
        title: visibilitySectionTitle("private", tGroups),
        items: privates,
      },
      { key: "hidden", title: visibilitySectionTitle("hidden", tGroups), items: hiddens },
      { key: "other", title: visibilitySectionTitle("other", tGroups), items: others },
    ].filter((section) => section.items.length > 0);
  }, [myGroups]);

  const joinedGrouped = useMemo(() => {
    const myGroupIds = new Set(myGroups.map((g) => g.id));
    const mergedMap = new Map<string, GroupDocLite>();

    [...joinedGroups, ...hiddenSidebarMembershipGroups]
      .filter((g) => !myGroupIds.has(g.id))
      .forEach((g) => {
        mergedMap.set(g.id, g);
      });

    const allJoined = Array.from(mergedMap.values());

    const publics = sortGroupsWithModsFirst(
      allJoined.filter((g) => g.visibility === "public")
    );
    const privates = sortGroupsWithModsFirst(
      allJoined.filter((g) => g.visibility === "private")
    );
    const hiddens = sortGroupsWithModsFirst(
      allJoined.filter((g) => g.visibility === "hidden")
    );
    const others = sortGroupsWithModsFirst(
      allJoined.filter(
        (g) =>
          g.visibility !== "public" &&
          g.visibility !== "private" &&
          g.visibility !== "hidden"
      )
    );

    return [
      { key: "public", title: visibilitySectionTitle("public", tGroups), items: publics },
      {
        key: "private",
        title: visibilitySectionTitle("private", tGroups),
        items: privates,
      },
      { key: "hidden", title: visibilitySectionTitle("hidden", tGroups), items: hiddens },
      { key: "other", title: visibilitySectionTitle("other", tGroups), items: others },
    ].filter((section) => section.items.length > 0);
  }, [joinedGroups, hiddenSidebarMembershipGroups, myGroups]);

  const sortedFollowedProfiles = useMemo(
    () => [...followedProfiles].sort((a, b) => (visitCounts[b.uid] ?? 0) - (visitCounts[a.uid] ?? 0)),
    [followedProfiles, visitCounts]
  );

  const sortedOwnedGrouped = useMemo(
    () => ownedGrouped.map((section) => ({
      ...section,
      items: [...section.items].sort((a, b) => (visitCounts[b.id] ?? 0) - (visitCounts[a.id] ?? 0)),
    })),
    [ownedGrouped, visitCounts]
  );

  const sortedJoinedGrouped = useMemo(
    () => joinedGrouped.map((section) => ({
      ...section,
      items: [...section.items].sort((a, b) => (visitCounts[b.id] ?? 0) - (visitCounts[a.id] ?? 0)),
    })),
    [joinedGrouped, visitCounts]
  );

  const browseGrouped = useMemo(() => {
    const withoutJoined = browseGroups.filter(
      (g) => !joinedGroups.some((j) => j.id === g.id)
    );

    const publics = withoutJoined.filter((g) => g.visibility === "public");
    const privates = withoutJoined.filter((g) => g.visibility === "private");
    const others = withoutJoined.filter(
      (g) => g.visibility !== "public" && g.visibility !== "private"
    );

    return [
      { key: "public", title: visibilitySectionTitle("public", tGroups), items: publics },
      {
        key: "private",
        title: visibilitySectionTitle("private", tGroups),
        items: privates,
      },
      { key: "other", title: visibilitySectionTitle("other", tGroups), items: others },
    ].filter((section) => section.items.length > 0);
  }, [browseGroups, joinedGroups]);


if (!authReady) return null;
if (!viewer) return null;

const isProfileTopOpen =
  profileBucketKey ? openCommunities[profileBucketKey] === true : false;

// ¿Hay al menos una pestaña visible en el menú? (misma lógica que OwnerSidebarTabNav)
// Se usa para pintar el separador de cierre solo si realmente hay pestañas.
const hasMenuTabs =
  loadingFollowing || followedProfiles.length > 0 ||
  loadingGroups || myGroups.length > 0 || joinedGroups.length > 0 ||
  pendingCount > 0 || buyerDelivered.length > 0;

return (
    <>
      <style jsx>{`
.profile-owner-sidebar-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  width: 100%;
  max-height: calc(100vh - 100px);
  padding: 10px;
  box-sizing: border-box;
  border-radius: 12px;
  /* Contenedor invisible: sin fondo, borde ni sombra, para que no se note. */
  border: none;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
  transition:
    max-height 320ms ease,
    background 180ms ease;
}

/* Glow y sombra interna desactivados: el contenedor no debe notarse. */
.profile-owner-sidebar-panel::before,
.profile-owner-sidebar-panel::after {
  content: none;
}

.profile-owner-sidebar-content {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
}

.owner-sidebar-view-transition {
  display: grid;
  gap: 10px;
}

@keyframes ownerSidebarViewIn {
  from {
    opacity: 0;
    transform: translateY(14px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.profile-owner-sidebar-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: none;
  scrollbar-width: none;
  -ms-overflow-style: none;
  -webkit-overflow-scrolling: touch;
  /* Sube el scroll (aprovecha el espacio de arriba) y deja padding para que el
     difuminado caiga en espacio vacío, no sobre la primera/última pestaña. */
  margin-top: -12px;
  padding-top: 20px;
  padding-bottom: 20px;
  /* Difumina el contenido en los bordes al hacer scroll, en vez de cortarlo. */
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 20px,
    #000 calc(100% - 20px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to bottom,
    transparent 0,
    #000 20px,
    #000 calc(100% - 20px),
    transparent 100%
  );
}
.profile-owner-sidebar-scroll::-webkit-scrollbar {
  display: none;
}

/* Líneas divisoras del sidebar. El divisor de "mi perfil" no lleva margen
   vertical propio (el gap de la columna ya da el espacio) para no acumular
   espacio muerto entre el perfil y el menú. */
.owner-sidebar-profile-divider {
  height: 1px;
  margin: 0 6px;
  background: rgba(255, 255, 255, 0.1);
}

.owner-sidebar-menu-divider {
  height: 1px;
  margin: 8px 6px;
  background: rgba(255, 255, 255, 0.1);
}

.mini-vertical-scroll {
          overflow: visible;
        }


        @keyframes ownerSidebarBuzz {
          0% {
            transform: translateX(0);
          }
          2% {
            transform: translateX(-1.4px);
          }
          4% {
            transform: translateX(1.4px);
          }
          6% {
            transform: translateX(-1.1px);
          }
          8% {
            transform: translateX(1.1px);
          }
          10% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(0);
          }
        }

@media (max-width: 1220px) {
  .owner-sidebar-community-card :global(button[aria-label*="Copiar"]) {
    opacity: 0.72 !important;
  }

  .owner-sidebar-community-card {
    width: 100% !important;
    padding-left: 12px !important;
    padding-right: 12px !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    justify-content: space-between !important;
  }

  .owner-sidebar-community-card-main {
    flex: 1 !important;
    min-width: 0 !important;
  }

  .profile-owner-sidebar-fixed {
    position: fixed !important;
    left: 0 !important;
    right: 0 !important;
    top: calc(env(safe-area-inset-top, 0px) + 68px) !important;
    bottom: 0 !important;
    width: auto !important;
    height: auto !important;
    max-height: none !important;
    margin: 0 !important;
    overflow-y: scroll !important;
    overflow-x: hidden !important;
    -webkit-overflow-scrolling: touch !important;
    overscroll-behavior: none !important;
    scrollbar-width: none !important;
  }

  .profile-owner-sidebar-fixed::-webkit-scrollbar {
    display: none !important;
  }

  .profile-owner-sidebar-panel,
  .profile-owner-sidebar-panel--profile-open {
    height: auto !important;
    max-height: none !important;
    padding: 10px !important;
    overflow: visible !important;
    background: transparent !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
  }

  .profile-owner-sidebar-panel::before,
  .profile-owner-sidebar-panel::after {
    display: none !important;
  }

  .profile-owner-sidebar-content {
    height: auto !important;
    overflow: visible !important;
  }

  .profile-owner-sidebar-scroll {
    overflow: visible !important;
    max-height: none !important;
    height: auto !important;
    /* En móvil el sidebar va en flujo (scroll de página), no interno: sin máscara
       ni los ajustes de padding/margin que solo aplican al scroll de escritorio. */
    -webkit-mask-image: none !important;
    mask-image: none !important;
    margin-top: 0 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }
}

.profile-owner-sidebar-panel--profile-open {
  overflow: hidden;
}

.profile-owner-sidebar-panel--profile-open .profile-owner-sidebar-scroll {
  overflow-y: auto !important;
  overflow-x: hidden !important;
}

@media (max-width: 1220px) {
  .profile-owner-sidebar-fixed .profile-owner-sidebar-panel--profile-open .profile-owner-sidebar-scroll {
    overflow: visible !important;
    max-height: none !important;
  }
}

/* En móvil real (página de comunidades /groups) OwnerSidebar va EN FLUJO, no
   position:fixed. Un elemento fixed NO lo arrastra el transform del ancestro
   (.mainInner) durante la animación de nav-slide en iOS Safari —se queda anclado
   al viewport—, por eso la pestaña de comunidades no deslizaba en iPhone aunque sí
   en el simulador de Chrome. En flujo, el slide del layout lo anima igual en iOS y
   Chrome, y el scroll pasa a ser el nativo de la página. Los paneles internos ya
   están en flujo por el bloque de 1220px de arriba; aquí solo se resetea la raíz.
   Bajo 900px el rail de escritorio (.sidebarCol) está display:none, así que esto
   solo afecta a la página de comunidades. */
@media (max-width: 900px) {
  .profile-owner-sidebar-fixed {
    position: static !important;
    width: 100% !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }
}
      `}</style>

<aside
className="profile-owner-sidebar-fixed"
  style={{
    position: "fixed",
    left: 18,
    top: ui.sidebarTop,
    width: ui.sidebarWidth,
    maxHeight: `calc(100vh - ${ui.sidebarTop + ui.sidebarBottom}px)`,
    zIndex: 9998,
    fontFamily: fontStack,
    color: "#fff",
  }}
>
<RefreshableArea
  onRefresh={handleOwnerSidebarPullRefresh}
  enabled={false}
>
<div
  className={
    isProfileTopOpen
      ? "profile-owner-sidebar-panel profile-owner-sidebar-panel--profile-open"
      : "profile-owner-sidebar-panel"
  }
>
<div className="profile-owner-sidebar-content">
          {msg && <div style={styles.message}>{msg}</div>}
          {groupsErr && <div style={styles.message}>{groupsErr}</div>}

{/* Fijo: "mi perfil" no scrollea, se queda arriba. */}
{profileSidebarGroup && (
  <div style={{ display: "grid", gap: 8, flexShrink: 0 }}>
    <OwnerSidebarMyGroups
    loadingGroups={false}
    myGroups={[profileSidebarGroup]}
    ownedGrouped={[
      {
        key: "profile-top",
        title: "",
        items: [profileSidebarGroup],
      },
    ]}
              openCommunities={openCommunities}
              joinRequestsByGroup={{}}
              greetingsByGroup={greetingsByGroup}
              meetGreetsByGroup={meetGreetsByGroup}
              exclusiveSessionsByGroup={exclusiveSessionsByGroup}
              greetingSectionOpen={greetingSectionOpen}
              joinSectionOpen={joinSectionOpen}
              seenCountsByGroup={seenCountsByGroup}
              userMiniMap={userMiniMap}
              styles={styles}
              getInitials={getInitials}
              renderUserLink={renderUserLink}
              setOpenCommunities={setOpenCommunities}
              setSeenCountsByGroup={setSeenCountsByGroup}
              setJoinSectionOpen={setJoinSectionOpen}
              setGreetingSectionOpen={setGreetingSectionOpen}
              handleApproveJoin={handleApproveJoin}
              handleRejectJoin={handleRejectJoin}
handleGreetingAction={handleGreetingAction}
onCreateCommunity={() => router.push("/groups/new")}
joinBusyKey={joinBusyKey}
greetingBusyId={greetingBusyId}
newPostsCounts={newPostsCounts}
       />
  </div>
)}

{profileSidebarGroup && (
  <div className="owner-sidebar-profile-divider" aria-hidden="true" style={{ flexShrink: 0 }} />
)}

{/* Solo el menú de abajo scrollea, con difuminado en los bordes. */}
<div className="profile-owner-sidebar-scroll">
          <OwnerSidebarTabNav
            openKey={accordionOpen ? activeView : null}
            onToggle={(key) => {
              // Re-clic en la sección abierta la cierra; clic en otra la abre.
              if (accordionOpen && key === activeView) {
                setAccordionOpen(false);
              } else {
                setActiveView(key);
                setAccordionOpen(true);
              }
            }}
            requestedCount={pendingCount}
            deliveredCount={buyerDelivered.length}
            joinRequestsCount={0}
            followedCount={followedProfiles.length}
            myGroupsCount={myGroups.length}
            joinedGroupsCount={joinedGroups.length}
            loadingFollowing={loadingFollowing}
            loadingGroups={loadingGroups}
            contentByKey={{
              following: (
                <OwnerSidebarFollowedProfiles
                  loadingFollowing={loadingFollowing}
                  followedProfiles={sortedFollowedProfiles}
                  styles={styles}
                  onOpenProfile={(handle) => router.push(`/u/${handle}`)}
                  onProfileVisit={(uid) => incrementVisit(uid)}
                  isMobile={isMobile}
                  currentUserId={viewer?.uid ?? null}
                  newPostsCounts={newPostsCounts}
                />
              ),
              owned: (
                <OwnerSidebarMyGroups
                  loadingGroups={loadingGroups}
                  myGroups={myGroups}
                  meetGreetsByGroup={meetGreetsByGroup}
                  exclusiveSessionsByGroup={exclusiveSessionsByGroup}
                  ownedGrouped={sortedOwnedGrouped}
                  openCommunities={openCommunities}
                  joinRequestsByGroup={joinRequestsByGroup}
                  greetingsByGroup={greetingsByGroup}
                  greetingSectionOpen={greetingSectionOpen}
                  joinSectionOpen={joinSectionOpen}
                  seenCountsByGroup={seenCountsByGroup}
                  userMiniMap={userMiniMap}
                  styles={styles}
                  getInitials={getInitials}
                  renderUserLink={renderUserLink}
                  setOpenCommunities={setOpenCommunities}
                  setSeenCountsByGroup={setSeenCountsByGroup}
                  setJoinSectionOpen={setJoinSectionOpen}
                  setGreetingSectionOpen={setGreetingSectionOpen}
                  handleApproveJoin={handleApproveJoin}
                  handleRejectJoin={handleRejectJoin}
                  handleGreetingAction={handleGreetingAction}
                  onCreateCommunity={() => router.push("/groups/new")}
                  joinBusyKey={joinBusyKey}
                  greetingBusyId={greetingBusyId}
                  newPostsCounts={newPostsCounts}
                />
              ),
              communities: (
                <OwnerSidebarOtherGroups
                  currentUserId={viewer?.uid ?? null}
                  loadingCommunities={loadingCommunities}
                  joinedGroups={joinedGroups}
                  pendingJoinRequestsSent={pendingJoinRequestsSent}
                  browseGroups={browseGroups}
                  joinedGrouped={sortedJoinedGrouped}
                  subscriptionPendingGroups={subscriptionPendingGroups}
                  browseGrouped={browseGrouped}
                  groupMetaMap={groupMetaMap}
                  styles={styles}
                  fmtDate={fmtDate}
                  renderCommunityCard={renderCommunityCard}
                  joinRequestsByGroup={joinRequestsByGroup}
                  joinSectionOpen={joinSectionOpen}
                  setJoinSectionOpen={setJoinSectionOpen}
                  handleApproveJoin={handleApproveJoin}
                  handleRejectJoin={handleRejectJoin}
                  joinBusyKey={joinBusyKey}
                  userMiniMap={userMiniMap}
                  getInitials={getInitials}
                  renderUserLink={renderUserLink}
                  onCreateCommunity={() => router.push("/groups/new")}
                  newPostsCounts={newPostsCounts}
                />
              ),
              greetings:
                pendingCount > 0 || buyerDelivered.length > 0 || buyerRejectedGreetings.length > 0 ? (
                  <OwnerSidebarGreetings
                    buyerPending={buyerPending}
                    buyerDelivered={buyerDelivered}
                    buyerRejectedGreetings={buyerRejectedGreetings}
                    buyerExclusiveSessions={buyerExclusiveSessions}
                    exclusiveSessionsByGroup={{}}
                    groupMetaMap={groupMetaMap}
                    userMiniMap={userMiniMap}
                    styles={styles}
                    typeLabel={(type) => {
                      if (type === "saludo") return tWallet("typeLabelGreeting");
                      if (type === "consejo") return tWallet("typeLabelAdvice");
                      if (type === "mensaje") return tWallet("typeLabelMessage");
                      if (type === "meet_greet_digital") return tSessions("meetGreetTitle");
                      if (type === "exclusive_session" || type === "clase_personalizada" || type === "digital_exclusive_session") return tServices("exclusiveSession");
                      return type;
                    }}
                    fmtDate={fmtDate}
                    renderUserLink={renderUserLink}
                    router={router}
                    buyerMeetGreets={buyerMeetGreets}
                    meetGreetsByGroup={{}}
                  />
                ) : null,
            }}
          />

{hasMenuTabs && (
  <div className="owner-sidebar-menu-divider" aria-hidden="true" />
)}
{isMobile && (
  <div style={{
    flexShrink: 0,
    height: "calc(72px + env(safe-area-inset-bottom, 0px))",
    background: "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.85) 55%)",
    pointerEvents: "none",
  }} />
)}
</div>
         </div>
</div>
</RefreshableArea>
</aside>
      <VibraToast toast={sidebarToast} />
    </>
  );
}
