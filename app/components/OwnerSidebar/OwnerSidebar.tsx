"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  updateDoc,
  where,
  Timestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

import { auth, db } from "@/lib/firebase";
import {
  approveJoinRequest,
  rejectJoinRequest,
} from "@/lib/groups/joinRequests.admin";
import { getMyHiddenJoinedGroups } from "@/lib/groups/sidebarGroups";
import { respondGreetingRequest } from "@/lib/greetings/greetingRequests";
import {
  acceptMeetGreetRequest,
  expireMeetGreetNoShows,
  proposeMeetGreetSchedule,
  rejectMeetGreetRequest,
  requestMeetGreetRefund,
  requestMeetGreetReschedule,
  setMeetGreetPreparing,
} from "@/lib/meetGreet/meetGreetRequests";
import { expireExclusiveSessionNoShows } from "@/lib/exclusiveSession/exclusiveSessionRequests";
import OwnerSidebarTabNav from "./OwnerSidebarTabNav";
import OwnerSidebarMyGroups from "./OwnerSidebarMyGroups";
import OwnerSidebarOtherGroups from "./OwnerSidebarOtherGroups";
import OwnerSidebarGreetings from "./OwnerSidebarGreetings";

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
  avatarUrl?: string | null;
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
  groupId: string;
  type: GreetingType;
  toName: string;
  instructions: string;
  source: "group" | "profile" | string;
  status: GreetingStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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

  groupId: string;
  groupName?: string | null;

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

export type TopView = "owned" | "communities" | "greetings";

export type TabIconProps = {
  active: boolean;
};

export function visibilitySectionTitle(v: string) {
  if (v === "public") return "Comunidades públicas";
  if (v === "private") return "Comunidades privadas";
  if (v === "hidden") return "Comunidades ocultas";
  return "Otras comunidades";
}

export function typeLabel(t: string) {
  if (t === "saludo") return "Saludo";
  if (t === "consejo") return "Consejo";
  if (t === "mensaje") return "Mensaje";
  if (t === "meet_greet_digital") return "Meet & Greet";
  if (t === "clase_personalizada") return "Sesión exclusiva";
  if (t === "exclusive_session") return "Sesión exclusiva";
  if (t === "digital_exclusive_session") return "Sesión exclusiva";
  return t;
}

function isMeetGreetOwnerAlert(status?: MeetGreetStatus | null) {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "reschedule_requested" ||
    status === "ready_to_prepare"
  );
}

function isMeetGreetCreatorActiveItem(status?: MeetGreetStatus | null) {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "scheduled" ||
    status === "reschedule_requested" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

function isMeetGreetPendingItem(status?: MeetGreetStatus | null) {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "scheduled" ||
    status === "reschedule_requested" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

export function fmtDate(ts?: Timestamp | null) {
  if (!ts) return "";
  return ts.toDate().toLocaleString("es-MX");
}

export function getInitials(name?: string | null) {
  const raw = (name ?? "").trim();
  if (!raw) return "C";
  const parts = raw.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase() || "C";
}

export function friendlyJoinErrorMessage(err: any) {
  const msg = (err?.message ?? "").toString().toLowerCase();
  if (
    msg.includes("solicitud no existe") ||
    msg.includes("not-found") ||
    msg.includes("does not exist")
  ) {
    return null;
  }
  return err?.message ?? "Ocurrió un error.";
}

export function buildDisplayName(user?: Partial<UserDoc> | null, uid?: string) {
  const dn = user?.displayName?.trim();
  if (dn) return dn;

  const full = [user?.firstName?.trim(), user?.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (full) return full;
  if (uid) return `Usuario ${uid.slice(0, 6)}`;
  return "Usuario";
}

function normalizeSidebarMemberStatus(raw: unknown): SidebarMemberStatus {
  if (raw === "banned") return "banned";
  if (raw === "muted") return "muted";
  if (raw === "subscribed") return "subscribed";
  if (raw === "active") return "active";
  if (raw === "removed") return "removed";

  if (raw === "kicked") return "removed";
  if (raw === "expelled") return "removed";

  return null;
}

function normalizeSidebarGroupRole(raw: unknown): GroupRoleLite {
  if (raw === "owner") return "owner";
  if (raw === "mod" || raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

function isJoinedSidebarStatus(status: SidebarMemberStatus) {
  return (
    status === "active" ||
    status === "subscribed" ||
    status === "muted"
  );
}

function isExcludedSidebarStatus(status: SidebarMemberStatus) {
  return status === "removed";
}

function sortGroupsWithModsFirst(items: GroupDocLite[]) {
  return [...items].sort((a, b) => {
    const aIsMod = a.memberRole === "mod" ? 0 : 1;
    const bIsMod = b.memberRole === "mod" ? 0 : 1;

    if (aIsMod !== bIsMod) return aIsMod - bIsMod;

    const aName = (a.name ?? "").trim().toLocaleLowerCase("es-MX");
    const bName = (b.name ?? "").trim().toLocaleLowerCase("es-MX");
    return aName.localeCompare(bName, "es-MX");
  });
}

function resolveSidebarSubscriptionEnabled(group?: GroupDocLite | null) {
  return (
    group?.monetization?.subscriptionsEnabled === true ||
    group?.monetization?.isPaid === true
  );
}

function resolveSidebarSubscriptionPrice(group?: GroupDocLite | null) {
  return (
    group?.monetization?.subscriptionPriceMonthly ??
    group?.monetization?.priceMonthly ??
    null
  );
}

function resolveSidebarSubscriptionCurrency(group?: GroupDocLite | null) {
  return (
    group?.monetization?.subscriptionCurrency ??
    group?.monetization?.currency ??
    null
  );
}

function formatSidebarMoney(value: number, currency: Currency) {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

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
  tone: "blue" | "green" | "yellow";
}) {
  const bg =
    tone === "blue"
      ? "linear-gradient(180deg, #2f8cff 0%, #1f6fe5 100%)"
      : tone === "yellow"
      ? "linear-gradient(180deg, #facc15 0%, #eab308 100%)"
      : "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)";

  const color = tone === "yellow" ? "#111" : "#fff";

  return (
    <span
      style={{
        width: 22,
        height: 22,
        minWidth: 22,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: bg,
        color,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
        border: "1px solid rgba(255,255,255,0.18)",
        flexShrink: 0,
      }}
    >
      {count}
    </span>
  );
}

export default function OwnerSidebar() {
  const router = useRouter();
  const pathname = usePathname();

  const [viewer, setViewer] = useState<any>(null);
  const [authReady, setAuthReady] = useState(false);

  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  const [myGroups, setMyGroups] = useState<GroupDocLite[]>([]);
  const [joinedGroups, setJoinedGroups] = useState<GroupDocLite[]>([]);
  const [hiddenJoinedGroups, setHiddenJoinedGroups] = useState<GroupDocLite[]>(
    []
  );
  const [browseGroups, setBrowseGroups] = useState<GroupDocLite[]>([]);
  const [pendingJoinRequestsSent, setPendingJoinRequestsSent] = useState<
    OutgoingJoinRequestRow[]
  >([]);

  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingCommunities, setLoadingCommunities] = useState(false);

  const [groupsErr, setGroupsErr] = useState<string | null>(null);
  const [savingProfileGreeting, setSavingProfileGreeting] = useState(false);
  const [joinBusyKey, setJoinBusyKey] = useState<string | null>(null);
  const [greetingBusyId, setGreetingBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<TopView>("owned");

  const [pgEnabled, setPgEnabled] = useState(false);
  const [pgPrice, setPgPrice] = useState<string>("");
  const [pgCurrency, setPgCurrency] = useState<Currency>("MXN");

  const [openCommunities, setOpenCommunities] = useState<
    Record<string, boolean>
  >({});
  const [profileOpen, setProfileOpen] = useState(false);

  const [joinRequestsByGroup, setJoinRequestsByGroup] = useState<
    Record<string, JoinRequestRow[]>
  >({});

  const [greetingsByGroup, setGreetingsByGroup] = useState<
    Record<string, Array<{ id: string; data: GreetingRequestDoc }>>
  >({});

  const [buyerPending, setBuyerPending] = useState<
    Array<{ id: string; data: GreetingRequestDoc }>
  >([]);

  const [meetGreetsByGroup, setMeetGreetsByGroup] = useState<
    Record<string, Array<{ id: string; data: MeetGreetRequestDoc }>>
  >({});

  const [exclusiveSessionsByGroup, setExclusiveSessionsByGroup] = useState<
  Record<string, Array<{ id: string; data: ExclusiveSessionRequestDoc }>>
>({});

  const [buyerMeetGreets, setBuyerMeetGreets] = useState<
    Array<{ id: string; data: MeetGreetRequestDoc }>
  >([]);

  const [buyerExclusiveSessions, setBuyerExclusiveSessions] = useState<
  Array<{ id: string; data: ExclusiveSessionRequestDoc }>
>([]);

  const [greetingSectionOpen, setGreetingSectionOpen] = useState<
    Record<string, boolean>
  >({});
  const [joinSectionOpen, setJoinSectionOpen] = useState<
    Record<string, boolean>
  >({});

  const [seenCountsByGroup, setSeenCountsByGroup] = useState<
    Record<string, { join: number; greeting: number }>
  >({});

  const [userMiniMap, setUserMiniMap] = useState<Record<string, UserMini>>({});
  const [groupMetaMap, setGroupMetaMap] = useState<
    Record<string, GroupDocLite>
  >({});
  const joinUnsubsRef = useRef<Array<() => void>>([]);

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const ui = {
    sidebarWidth: 300,
    sidebarTop: 84,
    sidebarBottom: 16,
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
      fontWeight: 700,
      color: "rgba(255,255,255,0.36)",
      textTransform: "uppercase",
      letterSpacing: 0.65,
      padding: "4px 2px 2px",
    },
    card: {
      padding: "10px 12px",
      borderRadius: 16,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    },
    subtle: {
      fontSize: 11,
      color: "rgba(255,255,255,0.56)",
      lineHeight: 1.3,
    },
    sectionPanel: {
      padding: "10px",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.02)",
      display: "grid",
      gap: 8,
    },
    miniItem: {
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.025)",
      padding: 9,
      display: "grid",
      gap: 7,
    },
  };

  const currentUserAvatar =
    userDoc?.photoURL?.trim() || viewer?.photoURL?.trim() || null;

  const currentUserDisplayName = buildDisplayName(userDoc, viewer?.uid);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setViewer(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
  if (!viewer?.uid) return;

  let cancelled = false;

  async function expireNoShows() {
  try {
    await Promise.all([
      expireMeetGreetNoShows(),
      expireExclusiveSessionNoShows(),
    ]);
  } catch (error) {
    if (!cancelled) {
      console.error("expireScheduledServiceNoShows error", error);
    }
  }
}

  void expireNoShows();

  const interval = window.setInterval(() => {
    void expireNoShows();
  }, 60_000);

  return () => {
    cancelled = true;
    window.clearInterval(interval);
  };
}, [viewer?.uid]);

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

        const pg = u.profileGreeting;
        setPgEnabled(pg?.enabled === true);
        setPgPrice(pg?.price == null ? "" : String(pg.price));
        setPgCurrency((pg?.currency ?? "MXN") as Currency);

        setUserMiniMap((prev) => ({
          ...prev,
          [viewer.uid]: {
            uid: viewer.uid,
            displayName: buildDisplayName(u, viewer.uid),
            handle: u.handle ?? null,
            photoURL: u.photoURL ?? null,
          },
        }));
      } catch (e: any) {
        setMsg(e?.message ?? "No se pudo cargar tu perfil.");
        setUserDoc(null);
      } finally {
        setLoadingUser(false);
      }
    }

    loadCurrentUser();
  }, [viewer?.uid, pathname]);

  useEffect(() => {
    async function loadMyCommunities() {
      if (!viewer?.uid) {
        setMyGroups([]);
        setOpenCommunities({});
        return;
      }

      setLoadingGroups(true);
      setGroupsErr(null);

      try {
        const gq = query(
          collection(db, "groups"),
          where("ownerId", "==", viewer.uid),
          limit(50)
        );

        const gs = await getDocs(gq);

        const rows: GroupDocLite[] = gs.docs.map((d) => ({
          ...(d.data() as Omit<GroupDocLite, "id">),
          id: d.id,
        }));

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
      } catch (e: any) {
        setGroupsErr(e?.message ?? "No se pudieron cargar tus comunidades.");
        setMyGroups([]);
        setOpenCommunities({});
      } finally {
        setLoadingGroups(false);
      }
    }

    loadMyCommunities();
  }, [viewer?.uid]);

  useEffect(() => {
    if (!viewer?.uid) {
      setBrowseGroups([]);
      setJoinedGroups([]);
      setPendingJoinRequestsSent([]);
      return;
    }

    setLoadingCommunities(true);
    setGroupsErr(null);

    const communitiesQ = query(
      collection(db, "groups"),
      where("visibility", "in", ["public", "private"]),
      limit(100)
    );

    const unsub = onSnapshot(
      communitiesQ,
      async (snap) => {
        try {
          const allVisibleBase: GroupDocLite[] = snap.docs
            .map((d) => ({
              ...(d.data() as Omit<GroupDocLite, "id">),
              id: d.id,
            }))
            .filter((g) => g?.ownerId !== viewer.uid);

          const membershipChecks = await Promise.all(
            allVisibleBase.map(async (g) => {
              try {
                const memberSnap = await getDoc(
                  doc(db, "groups", g.id, "members", viewer.uid)
                );

                const joinReqSnap = await getDoc(
                  doc(db, "groups", g.id, "joinRequests", viewer.uid)
                );

                const memberStatus = memberSnap.exists()
                  ? normalizeSidebarMemberStatus(
                      (memberSnap.data() as any)?.status ?? "active"
                    )
                  : null;

                const memberRole = memberSnap.exists()
                  ? normalizeSidebarGroupRole(
                      (memberSnap.data() as any)?.roleInGroup ??
                        (memberSnap.data() as any)?.role ??
                        "member"
                    )
                  : null;

                const memberData = memberSnap.exists()
                  ? (memberSnap.data() as any)
                  : null;

                const hydratedGroup: GroupDocLite = {
                  ...g,
                  memberStatus,
                  memberRole,
                  membershipAccessType:
                    memberData?.accessType === "subscription" ||
                    memberData?.accessType === "subscribed" ||
                    memberData?.accessType === "standard" ||
                    memberData?.accessType === "legacy_free" ||
                    memberData?.accessType === "subscription_required" ||
                    memberData?.accessType === "unknown"
                      ? memberData.accessType
                      : null,
                  requiresSubscription:
                    memberData?.requiresSubscription === true,
                  subscriptionActive:
                    memberData?.subscriptionActive === true,
                  legacyComplimentary:
                    memberData?.legacyComplimentary === true ||
                    memberData?.accessType === "legacy_free",
                  transitionPendingAction:
                    memberData?.transitionPendingAction === true,
                  transitionReason:
                    typeof memberData?.removedReason === "string"
                      ? memberData.removedReason
                      : null,
                  canDismiss: false,
                  sidebarState:
                    memberStatus === "banned" ? "banned" : "joined",
                };

                const isJoined =
                  isJoinedSidebarStatus(memberStatus) ||
                  memberStatus === "banned";
                const isExcluded = isExcludedSidebarStatus(memberStatus);

                return {
                  group: hydratedGroup,
                  isJoined,
                  isExcluded,
                  hasPendingJoin:
                    !isJoined &&
                    !isExcluded &&
                    joinReqSnap.exists() &&
                    (joinReqSnap.data() as any)?.status === "pending",
                  joinCreatedAt:
                    !isJoined &&
                    !isExcluded &&
                    joinReqSnap.exists()
                      ? ((joinReqSnap.data() as any)?.createdAt as
                          | Timestamp
                          | undefined)
                      : undefined,
                };
              } catch {
                return {
                  group: {
                    ...g,
                    memberStatus: null,
                    memberRole: null,
                  } satisfies GroupDocLite,
                  isJoined: false,
                  isExcluded: false,
                  hasPendingJoin: false,
                  joinCreatedAt: undefined,
                };
              }
            })
          );

          const joined = membershipChecks
            .filter((x) => x.isJoined)
            .map((x) => x.group);

          const pending = membershipChecks
            .filter((x) => x.hasPendingJoin && !x.isExcluded)
            .map((x) => ({
              id: viewer.uid,
              groupId: x.group.id,
              status: "pending",
              createdAt: x.joinCreatedAt,
            }));

          const explorable = membershipChecks
            .filter(
              (x) =>
                !x.isJoined &&
                !x.isExcluded &&
                !x.hasPendingJoin &&
                (x.group.visibility === "public" ||
                  x.group.visibility === "private")
            )
            .map((x) => x.group);

          setJoinedGroups(joined);
          setPendingJoinRequestsSent(pending);
          setBrowseGroups(explorable);

          const meta: Record<string, GroupDocLite> = {};
          membershipChecks.forEach(({ group, isExcluded }) => {
            if (!isExcluded) {
              meta[group.id] = group;
            }
          });

          setGroupMetaMap((prev) => ({ ...prev, ...meta }));
        } catch (e: any) {
          setGroupsErr(
            e?.message ??
              "No se pudieron cargar las comunidades con tus reglas actuales."
          );
          setBrowseGroups([]);
          setJoinedGroups([]);
          setPendingJoinRequestsSent([]);
        } finally {
          setLoadingCommunities(false);
        }
      },
      (e: any) => {
        setGroupsErr(
          e?.message ??
            "No se pudieron cargar las comunidades con tus reglas actuales."
        );
        setBrowseGroups([]);
        setJoinedGroups([]);
        setPendingJoinRequestsSent([]);
        setLoadingCommunities(false);
      }
    );

    return () => unsub();
  }, [viewer?.uid]);

  useEffect(() => {
    let cancelled = false;

    async function loadHiddenJoinedGroups() {
      if (!viewer?.uid) {
        setHiddenJoinedGroups([]);
        return;
      }

      try {
        const rows = await getMyHiddenJoinedGroups();
        if (cancelled) return;

        const groups = (
          await Promise.all(
            rows.map(async (g) => {
              let memberRole: GroupRoleLite = null;

              try {
                const memberSnap = await getDoc(
                  doc(db, "groups", g.id, "members", viewer.uid)
                );
                if (memberSnap.exists()) {
                  const memberData = memberSnap.data() as any;
                  memberRole = normalizeSidebarGroupRole(
                    memberData?.roleInGroup ?? memberData?.role ?? "member"
                  );
                }
              } catch {
                memberRole = null;
              }

              const normalizedSidebarState =
                g.sidebarState === "joined" ||
                g.sidebarState === "legacy_free" ||
                g.sidebarState === "requires_subscription" ||
                g.sidebarState === "banned"
                  ? g.sidebarState
                  : null;

              return {
                id: g.id,
                name: g.name ?? undefined,
                ownerId: g.ownerId ?? undefined,
                visibility: g.visibility ?? undefined,
                avatarUrl: g.avatarUrl ?? null,
                memberStatus: normalizeSidebarMemberStatus(g.memberStatus ?? null),
                memberRole,
                monetization: g.monetization ?? undefined,
                offerings: g.offerings ?? [],

                membershipAccessType:
                  g.membershipAccessType === "subscription" ||
                  g.membershipAccessType === "subscribed" ||
                  g.membershipAccessType === "standard" ||
                  g.membershipAccessType === "legacy_free" ||
                  g.membershipAccessType === "subscription_required" ||
                  g.membershipAccessType === "unknown"
                    ? g.membershipAccessType
                    : null,
                requiresSubscription: g.requiresSubscription ?? null,
                subscriptionActive: g.subscriptionActive ?? null,
                legacyComplimentary: g.legacyComplimentary ?? null,
                transitionPendingAction: g.transitionPendingAction ?? null,
                transitionReason: g.transitionReason ?? null,
                canDismiss: g.canDismiss === true,
                sidebarState: normalizedSidebarState,

                previousSubscriptionPriceMonthly:
                  typeof (g as any).previousSubscriptionPriceMonthly === "number"
                    ? (g as any).previousSubscriptionPriceMonthly
                    : null,
                nextSubscriptionPriceMonthly:
                  typeof (g as any).nextSubscriptionPriceMonthly === "number"
                    ? (g as any).nextSubscriptionPriceMonthly
                    : null,
                subscriptionPriceChangeCurrency:
                  typeof (g as any).subscriptionPriceChangeCurrency === "string"
                    ? (g as any).subscriptionPriceChangeCurrency
                    : null,
              } as GroupDocLite;
            })
          )
        ) as GroupDocLite[];

        if (cancelled) return;

        setHiddenJoinedGroups(groups);

        const meta: Record<string, GroupDocLite> = {};
        groups.forEach((g) => {
          meta[g.id] = g;
        });

        setGroupMetaMap((prev) => ({ ...prev, ...meta }));
      } catch (e: any) {
        console.error("getMyHiddenJoinedGroups error", e);
        if (!cancelled) {
          setHiddenJoinedGroups([]);
        }
      }
    }

    loadHiddenJoinedGroups();

    const refreshInterval = window.setInterval(() => {
      void loadHiddenJoinedGroups();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshInterval);
    };
  }, [viewer?.uid]);

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
            const data = d.data() as any;
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
        (e: any) => {
          setGroupsErr(e?.message ?? "No se pudieron cargar solicitudes.");
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

    const unsubIncoming = onSnapshot(
      incomingQ,
      (snap) => {
        const grouped: Record<
          string,
          Array<{ id: string; data: GreetingRequestDoc }>
        > = {};

        snap.docs.forEach((d) => {
          const data = d.data() as GreetingRequestDoc;
          const gid = data.groupId;
          if (!gid) return;
          if (!isMeetGreetCreatorActiveItem(data.status)) return;
          if (!grouped[gid]) grouped[gid] = [];
          grouped[gid].push({ id: d.id, data });
        });

        setGreetingsByGroup(grouped);
      },
      (e: any) => {
        setGroupsErr(
          e?.message ?? "No se pudieron cargar solicitudes de servicios."
        );
        setGreetingsByGroup({});
      }
    );

    const unsubBuyer = onSnapshot(
      buyerQ,
      async (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as GreetingRequestDoc,
        }));

        setBuyerPending(rows);

        const missingGroupIds = rows
          .map((r) => r.data.groupId)
          .filter(Boolean)
          .filter((groupId) => !groupMetaMap[groupId]);

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

    return () => {
      unsubIncoming();
      unsubBuyer();
    };
  }, [viewer?.uid, groupMetaMap]);

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
          const data = d.data() as ExclusiveSessionRequestDoc;
          const gid = data.groupId;
          if (!gid) return;
          if (!isMeetGreetCreatorActiveItem(data.status)) return;
          if (!grouped[gid]) grouped[gid] = [];
          grouped[gid].push({
            id: d.id,
            data: {
              ...data,
              id: d.id,
            },
          });
        });

        setMeetGreetsByGroup(grouped);
      },
      (e: any) => {
        setGroupsErr(
          e?.message ?? "No se pudieron cargar solicitudes de meet & greet."
        );
        setMeetGreetsByGroup({});
      }
    );

    const unsubBuyer = onSnapshot(
      buyerQ,
      async (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          data: {
            ...(d.data() as MeetGreetRequestDoc),
            id: d.id,
          },
        }));

        setBuyerMeetGreets(rows);

        const missingGroupIds = rows
          .map((r) => r.data.groupId)
          .filter(Boolean)
          .filter((groupId) => !groupMetaMap[groupId]);

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
  }, [viewer?.uid, groupMetaMap]);
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
        const data = d.data() as ExclusiveSessionRequestDoc;
        const gid = data.groupId;
        if (!gid) return;
        if (!isMeetGreetCreatorActiveItem(data.status)) return;

        if (!grouped[gid]) grouped[gid] = [];

        grouped[gid].push({
          id: d.id,
          data: {
            ...data,
            id: d.id,
            type: "digital_exclusive_session",
          },
        });
      });

      setExclusiveSessionsByGroup(grouped);
    },
    (e: any) => {
      setGroupsErr(
        e?.message ?? "No se pudieron cargar solicitudes de sesión exclusiva."
      );
      setExclusiveSessionsByGroup({});
    }
  );

  const unsubBuyer = onSnapshot(
    buyerQ,
    async (snap) => {
      const rows = snap.docs.map((d) => ({
        id: d.id,
                data: {
          ...(d.data() as ExclusiveSessionRequestDoc),
          id: d.id,
          type: "digital_exclusive_session",
        },
      }));

      setBuyerExclusiveSessions(rows);

      const missingGroupIds = rows
        .map((r) => r.data.groupId)
        .filter(Boolean)
        .filter((groupId) => !groupMetaMap[groupId]);

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
}, [viewer?.uid, groupMetaMap]);

  useEffect(() => {
    const groupsForSeen = [...myGroups, ...moderatedGroups].map((g) => g.id);

    if (groupsForSeen.length === 0) return;

    setSeenCountsByGroup((prev) => {
      const next = { ...prev };

      for (const groupId of groupsForSeen) {
        const joinCount = (joinRequestsByGroup[groupId] ?? []).length;
        const greetingCount =
  (greetingsByGroup[groupId] ?? []).length +
  (meetGreetsByGroup[groupId] ?? []).length +
  (exclusiveSessionsByGroup[groupId] ?? []).length;

        if (!next[groupId]) {
          next[groupId] = { join: joinCount, greeting: greetingCount };
        }
      }

      return next;
    });
  }, [
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
    buyerMeetGreets.forEach((r) => ids.add(r.data.creatorId));
    buyerExclusiveSessions.forEach((r) => ids.add(r.data.creatorId));

    return Array.from(ids).filter(Boolean);
  }, [
    joinRequestsByGroup,
    greetingsByGroup,
    meetGreetsByGroup,
    buyerPending,
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
                  displayName: buildDisplayName(null, uid),
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
                displayName: buildDisplayName(data, uid),
                handle: data.handle ?? null,
                photoURL: data.photoURL ?? null,
              } satisfies UserMini,
            ] as const;
          } catch {
            return [
              uid,
              {
                uid,
                displayName: buildDisplayName(null, uid),
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

    const ownerSidebarServiceCounts = useMemo(() => {
    let greetingAlerts = 0;
    let consejoAlerts = 0;
    let mensajeAlerts = 0;
    let meetGreetAlerts = 0;
    let meetGreetPreparingAlerts = 0;

    for (const rows of Object.values(greetingsByGroup)) {
      for (const row of rows) {
        const type = row.data.type;
        if (type === "saludo") greetingAlerts += 1;
        else if (type === "consejo") consejoAlerts += 1;
        else if (type === "mensaje") mensajeAlerts += 1;
      }
    }

    for (const rows of Object.values(meetGreetsByGroup)) {
      for (const row of rows) {
        const status = row.data.status;
        if (!isMeetGreetOwnerAlert(status)) continue;

        if (status === "ready_to_prepare") {
          meetGreetPreparingAlerts += 1;
        } else {
          meetGreetAlerts += 1;
        }
      }
    }

    for (const rows of Object.values(exclusiveSessionsByGroup)) {
  for (const row of rows) {
    const status = row.data.status;
    if (!isMeetGreetOwnerAlert(status)) continue;

    if (status === "ready_to_prepare") {
      meetGreetPreparingAlerts += 1;
    } else {
      meetGreetAlerts += 1;
    }
  }
}

    return {
      saludo: greetingAlerts,
      consejo: consejoAlerts,
      mensaje: mensajeAlerts,
      meetGreet: meetGreetAlerts,
      preparing: meetGreetPreparingAlerts,
      total:
        greetingAlerts +
        consejoAlerts +
        mensajeAlerts +
        meetGreetAlerts +
        meetGreetPreparingAlerts,
    };
  }, [greetingsByGroup, meetGreetsByGroup, exclusiveSessionsByGroup]);

  const pendingCount = useMemo(() => {
    let total = buyerPending.length;

    for (const row of buyerMeetGreets) {
      if (isMeetGreetPendingItem(row.data.status)) {
        total += 1;
      }
    }

    for (const row of buyerExclusiveSessions) {
  if (isMeetGreetPendingItem(row.data.status)) {
    total += 1;
  }
}

    return total;
  }, [buyerPending, buyerMeetGreets, buyerExclusiveSessions]);

    useEffect(() => {
    if (pendingCount === 0 && activeView === "greetings") {
      setActiveView("owned");
    }
  }, [pendingCount, activeView]);

  async function saveProfileGreeting() {
    if (!viewer?.uid || !userDoc) return;

    setSavingProfileGreeting(true);
    setMsg(null);

    try {
      const priceNum = pgPrice.trim() === "" ? null : Number(pgPrice);

      if (
        pgEnabled &&
        (priceNum == null || Number.isNaN(priceNum) || priceNum < 0)
      ) {
        setMsg("❌ Precio inválido.");
        return;
      }

      const uref = doc(db, "users", viewer.uid);

      await updateDoc(uref, {
        profileGreeting: {
          enabled: pgEnabled,
          price: pgEnabled ? priceNum : null,
          currency: pgEnabled ? pgCurrency : null,
        },
      });

      setUserDoc((prev) =>
        prev
          ? {
              ...prev,
              profileGreeting: {
                enabled: pgEnabled,
                price: pgEnabled ? priceNum : null,
                currency: pgEnabled ? pgCurrency : null,
              },
            }
          : prev
      );

      setMsg("✅ Configuración de saludos en perfil guardada.");
    } catch (e: any) {
      setMsg(e?.message ?? "❌ No se pudo guardar configuración.");
    } finally {
      setSavingProfileGreeting(false);
    }
  }

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
      setMsg("✅ Solicitud de acceso aprobada.");
    } catch (e: any) {
      const friendly = friendlyJoinErrorMessage(e);
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
      setMsg("✅ Solicitud de acceso rechazada.");
    } catch (e: any) {
      const friendly = friendlyJoinErrorMessage(e);
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
      setMsg(
        action === "accept"
          ? "✅ Solicitud de servicio aceptada."
          : "✅ Solicitud de servicio rechazada."
      );
    } catch (e: any) {
      setGroupsErr(e?.message ?? "❌ No se pudo actualizar la solicitud.");
    } finally {
      setGreetingBusyId(null);
    }
  }

  async function handleMeetGreetAccept(requestId: string) {
    await acceptMeetGreetRequest({ requestId });
  }

  async function handleMeetGreetReject(
    requestId: string,
    rejectionReason?: string | null
  ) {
    await rejectMeetGreetRequest({
      requestId,
      rejectionReason: rejectionReason ?? null,
    });
  }

  async function handleMeetGreetSchedule(
    requestId: string,
    scheduledAt: string,
    note?: string | null
  ) {
    await proposeMeetGreetSchedule({
      requestId,
      scheduledAt,
      note: note ?? null,
    });
  }

  async function handleMeetGreetRefund(
    requestId: string,
    refundReason?: string | null
  ) {
    await requestMeetGreetRefund({
      requestId,
      refundReason: refundReason ?? null,
    });
  }

  async function handleMeetGreetReschedule(
    requestId: string,
    reason?: string | null
  ) {
    await requestMeetGreetReschedule({
      requestId,
      reason: reason ?? null,
    });
  }

  async function handleMeetGreetPrepare(
    requestId: string,
    role: "buyer" | "creator"
  ) {
    await setMeetGreetPreparing({
      requestId,
      role,
    });
  }

  function renderUserLink(uid: string) {
    const u = userMiniMap[uid];
    const label = u?.displayName ?? buildDisplayName(null, uid);
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
          textDecoration: "underline",
          textUnderlineOffset: 2,
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
    const communityName = g.name ?? "(Sin nombre)";
    const avatarFallback = getInitials(communityName);

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
              return `Suscripción activa · ${formatSidebarMoney(price, currency)}`;
            }

            return "Suscripción activa";
          })()
        : null;

    return (
      <div
        key={g.id}
        style={{
          ...styles.card,
          padding: opts?.compact ? "9px 11px" : "10px 12px",
        }}
      >
        <button
          type="button"
          onClick={() => router.push(`/groups/${g.id}`)}
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
          {g.avatarUrl ? (
            <img
              src={g.avatarUrl}
              alt={communityName}
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                objectFit: "cover",
                border: "1px solid rgba(255,255,255,0.10)",
                flexShrink: 0,
              }}
            />
          ) : (
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                color: "#fff",
                flexShrink: 0,
              }}
            >
              {avatarFallback}
            </div>
          )}

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
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
            ) : null}
          </div>
        </button>
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
      { key: "public", title: visibilitySectionTitle("public"), items: publics },
      { key: "private", title: visibilitySectionTitle("private"), items: privates },
      { key: "hidden", title: visibilitySectionTitle("hidden"), items: hiddens },
      { key: "other", title: visibilitySectionTitle("other"), items: others },
    ].filter((section) => section.items.length > 0);
  }, [myGroups]);

  const joinedGrouped = useMemo(() => {
    const mergedMap = new Map<string, GroupDocLite>();

    [...joinedGroups, ...hiddenSidebarMembershipGroups].forEach((g) => {
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
      { key: "public", title: visibilitySectionTitle("public"), items: publics },
      { key: "private", title: visibilitySectionTitle("private"), items: privates },
      { key: "hidden", title: visibilitySectionTitle("hidden"), items: hiddens },
      { key: "other", title: visibilitySectionTitle("other"), items: others },
    ].filter((section) => section.items.length > 0);
  }, [joinedGroups, hiddenSidebarMembershipGroups]);

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
      { key: "public", title: visibilitySectionTitle("public"), items: publics },
      { key: "private", title: visibilitySectionTitle("private"), items: privates },
      { key: "other", title: visibilitySectionTitle("other"), items: others },
    ].filter((section) => section.items.length > 0);
  }, [browseGroups, joinedGroups]);

  const profileHref = userDoc?.handle ? `/u/${userDoc.handle}` : null;
  const isProfileRoute =
    !!profileHref &&
    (pathname === profileHref || pathname?.startsWith(`${profileHref}/`));

  if (!authReady) return null;
  if (!viewer) return null;

  return (
    <>
      <style jsx>{`
        .profile-owner-sidebar-scroll {
          overflow-y: auto;
          overflow-x: hidden;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
          -webkit-overflow-scrolling: touch;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar {
          width: 6px;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 999px;
        }

        .profile-owner-sidebar-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.16);
        }

        .mini-vertical-scroll {
          max-height: 220px;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 4px;
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
        }

        .mini-vertical-scroll::-webkit-scrollbar {
          width: 6px;
        }

        .mini-vertical-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .mini-vertical-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 999px;
        }

        .mini-vertical-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.18);
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
          .profile-owner-sidebar-fixed {
            position: static !important;
            width: 100% !important;
            max-height: none !important;
            margin: 18px auto 0 !important;
          }

          .profile-owner-sidebar-scroll {
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
          background: "transparent",
          border: "none",
          boxShadow: "none",
          color: "#fff",
        }}
      >
        <div
          className="profile-owner-sidebar-scroll"
          style={{
            maxHeight: `calc(100vh - ${ui.sidebarTop + ui.sidebarBottom}px)`,
            paddingRight: 4,
            display: "grid",
            gap: 10,
          }}
        >
          {msg && <div style={styles.message}>{msg}</div>}
          {groupsErr && <div style={styles.message}>{groupsErr}</div>}

          <div style={{ ...styles.card, display: "grid", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (profileHref) router.push(profileHref);
                }}
                disabled={!profileHref || isProfileRoute}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: "#fff",
                  textAlign: "left",
                  cursor: !profileHref || isProfileRoute ? "default" : "pointer",
                  fontFamily: fontStack,
                  opacity: !profileHref ? 0.55 : 1,
                  flex: 1,
                }}
                title="Ir a mi perfil"
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  {currentUserAvatar ? (
                    <img
                      src={currentUserAvatar}
                      alt={currentUserDisplayName}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        objectFit: "cover",
                        border: "1px solid rgba(255,255,255,0.10)",
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#fff",
                        flexShrink: 0,
                      }}
                    >
                      {getInitials(currentUserDisplayName)}
                    </div>
                  )}

                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    Mi perfil
                  </span>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setProfileOpen((prev) => !prev)}
                aria-label={
                  profileOpen ? "Cerrar opciones de perfil" : "Abrir opciones de perfil"
                }
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                <Chevron open={profileOpen} />
              </button>
            </div>

            {profileOpen && (
              <div
                style={{
                  paddingTop: 8,
                  marginTop: 2,
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  display: "grid",
                  gap: 9,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <div style={{ display: "grid", gap: 2 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      Saludos en perfil
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "rgba(255,255,255,0.56)",
                      }}
                    >
                      Venta directa desde tu perfil
                    </span>
                  </div>

                  <Switch
                    checked={pgEnabled}
                    disabled={savingProfileGreeting || loadingUser}
                    onChange={(next) => setPgEnabled(next)}
                    label="Vender saludos en mi perfil"
                  />
                </div>

                {pgEnabled && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      type="number"
                      value={pgPrice}
                      onChange={(e) => setPgPrice(e.target.value)}
                      placeholder="Precio"
                      style={{ ...styles.input, width: 106 }}
                    />
                    <select
                      value={pgCurrency}
                      onChange={(e) => setPgCurrency(e.target.value as Currency)}
                      style={{ ...styles.input, flex: 1, minWidth: 88 }}
                    >
                      <option value="MXN">MXN</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  onClick={saveProfileGreeting}
                  disabled={savingProfileGreeting || loadingUser}
                  style={{
                    ...styles.buttonSecondary,
                    width: "100%",
                    opacity: savingProfileGreeting || loadingUser ? 0.7 : 1,
                    cursor:
                      savingProfileGreeting || loadingUser ? "not-allowed" : "pointer",
                  }}
                >
                  {savingProfileGreeting ? "Guardando..." : "Guardar perfil"}
                </button>
              </div>
            )}
          </div>

                     <OwnerSidebarTabNav
            activeView={activeView}
            onChange={setActiveView}
            requestedCount={pendingCount}
          />

                        {activeView === "owned" && (
            <OwnerSidebarMyGroups
              loadingGroups={loadingGroups}
              myGroups={myGroups}
              meetGreetsByGroup={meetGreetsByGroup}
              exclusiveSessionsByGroup={exclusiveSessionsByGroup}
              ownedGrouped={ownedGrouped}
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
              joinBusyKey={joinBusyKey}
              greetingBusyId={greetingBusyId}
            />
          )}

          {activeView === "communities" && (
            <OwnerSidebarOtherGroups
              loadingCommunities={loadingCommunities}
              joinedGroups={joinedGroups}
              pendingJoinRequestsSent={pendingJoinRequestsSent}
              browseGroups={browseGroups}
              joinedGrouped={joinedGrouped}
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
            />
          )}

            {activeView === "greetings" && pendingCount > 0 && (
            <OwnerSidebarGreetings
  buyerPending={buyerPending}
  buyerExclusiveSessions={buyerExclusiveSessions}
  exclusiveSessionsByGroup={{}}
  groupMetaMap={groupMetaMap}
  styles={styles}
  typeLabel={typeLabel}
  fmtDate={fmtDate}
  renderUserLink={renderUserLink}
  router={router}
  buyerMeetGreets={buyerMeetGreets}
  meetGreetsByGroup={{}}
/>
          )}

          {(loadingGroups || loadingCommunities) && (
            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.58)",
                padding: "2px 2px 0",
              }}
            >
              Cargando comunidades...
            </div>
          )}
        </div>
      </aside>
    </>
  );
}