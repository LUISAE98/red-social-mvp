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
  updateOfferings,
  type GroupOffering,
} from "@/lib/groups/updateOfferings";
import {
  approveJoinRequest,
  rejectJoinRequest,
} from "@/lib/groups/joinRequests.admin";
import { respondGreetingRequest } from "@/lib/greetings/greetingRequests";

type Currency = "MXN" | "USD";

type UserDoc = {
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

type GroupDocLite = {
  id: string;
  name?: string;
  ownerId?: string;
  visibility?: "public" | "private" | "hidden" | string;
  avatarUrl?: string | null;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: Currency | null;
  };
  offerings?: Array<{
    type: "saludo" | "consejo" | "mensaje" | string;
    enabled?: boolean;
    price?: number | null;
    currency?: Currency | null;
  }>;
};

type GreetingStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "delivered"
  | string;

type GreetingType = "saludo" | "consejo" | "mensaje" | string;

type GreetingRequestDoc = {
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

type JoinRequestRow = {
  id: string;
  userId: string;
};

type OutgoingJoinRequestRow = {
  id: string;
  groupId: string;
  status: string;
  createdAt?: Timestamp;
};

type GroupDraft = {
  subscriptionEnabled: boolean;
  subscriptionPrice: string;
  subscriptionCurrency: Currency;
  saludoEnabled: boolean;
  saludoPrice: string;
  saludoCurrency: Currency;
};

type UserMini = {
  uid: string;
  displayName: string;
  handle: string | null;
  photoURL: string | null;
};

type TopView = "owned" | "communities" | "greetings";

type TabIconProps = {
  active: boolean;
};

function visibilitySectionTitle(v: string) {
  if (v === "public") return "Comunidades públicas";
  if (v === "private") return "Comunidades privadas";
  if (v === "hidden") return "Comunidades ocultas";
  return "Otras comunidades";
}

function pickSaludoOffering(offerings: GroupDocLite["offerings"]) {
  const arr = Array.isArray(offerings) ? offerings : [];
  const found = arr.find((o) => String(o?.type) === "saludo");
  const enabled = found?.enabled === true;
  const price = found?.price ?? null;
  const currency = (found?.currency ?? "MXN") as Currency;
  return { enabled, price, currency };
}

function pickSubscription(monetization: GroupDocLite["monetization"]) {
  return {
    enabled: monetization?.isPaid === true,
    price: monetization?.priceMonthly ?? null,
    currency: (monetization?.currency ?? "MXN") as Currency,
  };
}

function typeLabel(t: string) {
  if (t === "saludo") return "Saludo";
  if (t === "consejo") return "Consejo";
  if (t === "mensaje") return "Mensaje";
  return t;
}

function fmtDate(ts?: Timestamp) {
  if (!ts) return "";
  return ts.toDate().toLocaleString("es-MX");
}

function getInitials(name?: string | null) {
  const raw = (name ?? "").trim();
  if (!raw) return "C";
  const parts = raw.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase() || "C";
}

function friendlyJoinErrorMessage(err: any) {
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

function formatMoney(value: number, currency: Currency) {
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

function calcNetAmount(raw: string) {
  const n = Number(raw);
  if (raw.trim() === "" || Number.isNaN(n) || n <= 0) return null;
  const net = n * 0.77;
  return { gross: n, net };
}

function buildDisplayName(user?: Partial<UserDoc> | null, uid?: string) {
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

function IconMyCommunities({ active }: TabIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M12 3.2L20 9.3V20.2C20 20.64 19.64 21 19.2 21H14.8C14.36 21 14 20.64 14 20.2V15.4C14 14.96 13.64 14.6 13.2 14.6H10.8C10.36 14.6 10 14.96 10 15.4V20.2C10 20.64 9.64 21 9.2 21H4.8C4.36 21 4 20.64 4 20.2V9.3L12 3.2Z"
        stroke="currentColor"
        strokeWidth={active ? "1.6" : "1.8"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconOtherCommunities({ active }: TabIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M8 12C9.65685 12 11 10.6569 11 9C11 7.34315 9.65685 6 8 6C6.34315 6 5 7.34315 5 9C5 10.6569 6.34315 12 8 12Z"
        stroke="currentColor"
        strokeWidth={active ? "2" : "1.8"}
      />
      <path
        d="M16 11C17.3807 11 18.5 9.88071 18.5 8.5C18.5 7.11929 17.3807 6 16 6C14.6193 6 13.5 7.11929 13.5 8.5C13.5 9.88071 14.6193 11 16 11Z"
        stroke="currentColor"
        strokeWidth={active ? "2" : "1.8"}
      />
      <path
        d="M3.8 17.8C4.65 15.85 6.23 14.8 8 14.8C9.77 14.8 11.35 15.85 12.2 17.8"
        stroke="currentColor"
        strokeWidth={active ? "2" : "1.8"}
        strokeLinecap="round"
      />
      <path
        d="M12.8 17.2C13.45 15.7 14.72 14.9 16.15 14.9C17.58 14.9 18.85 15.7 19.5 17.2"
        stroke="currentColor"
        strokeWidth={active ? "2" : "1.8"}
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconGreetings({ active }: TabIconProps) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <path
        d="M6.2 18.8L7 14.8C5.7 13.7 5 12.2 5 10.5C5 6.91 8.13 4 12 4C15.87 4 19 6.91 19 10.5C19 14.09 15.87 17 12 17C10.94 17 9.94 16.78 9.05 16.37L6.2 18.8Z"
        stroke="currentColor"
        strokeWidth={active ? "1.6" : "1.8"}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Switch({
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

function Chevron({
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

function CountBadge({
  count,
  tone,
}: {
  count: number;
  tone: "blue" | "green";
}) {
  const bg =
    tone === "blue"
      ? "linear-gradient(180deg, #2f8cff 0%, #1f6fe5 100%)"
      : "linear-gradient(180deg, #22c55e 0%, #16a34a 100%)";

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
        color: "#fff",
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
  const [browseGroups, setBrowseGroups] = useState<GroupDocLite[]>([]);
  const [pendingJoinRequestsSent, setPendingJoinRequestsSent] = useState<
    OutgoingJoinRequestRow[]
  >([]);

  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingCommunities, setLoadingCommunities] = useState(false);

  const [groupsErr, setGroupsErr] = useState<string | null>(null);
  const [savingProfileGreeting, setSavingProfileGreeting] = useState(false);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [joinBusyKey, setJoinBusyKey] = useState<string | null>(null);
  const [greetingBusyId, setGreetingBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<TopView>("owned");

  const [pgEnabled, setPgEnabled] = useState(false);
  const [pgPrice, setPgPrice] = useState<string>("");
  const [pgCurrency, setPgCurrency] = useState<Currency>("MXN");

  const [groupDraft, setGroupDraft] = useState<Record<string, GroupDraft>>({});
  const [savedGroupDraft, setSavedGroupDraft] = useState<
    Record<string, GroupDraft>
  >({});
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
  }, [viewer?.uid]);

  useEffect(() => {
    async function loadMyCommunities() {
      if (!viewer?.uid) {
        setMyGroups([]);
        setGroupDraft({});
        setSavedGroupDraft({});
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

        const draft: Record<string, GroupDraft> = {};
        const initialOpen: Record<string, boolean> = {};
        const initialGreetingOpen: Record<string, boolean> = {};
        const initialJoinOpen: Record<string, boolean> = {};
        const initialGroupMeta: Record<string, GroupDocLite> = {};

        for (const g of rows) {
          const saludo = pickSaludoOffering(g.offerings);
          const sub = pickSubscription(g.monetization);

          draft[g.id] = {
            subscriptionEnabled: sub.enabled,
            subscriptionPrice: sub.price == null ? "" : String(sub.price),
            subscriptionCurrency: sub.currency ?? "MXN",
            saludoEnabled: saludo.enabled,
            saludoPrice: saludo.price == null ? "" : String(saludo.price),
            saludoCurrency: saludo.currency ?? "MXN",
          };

          initialOpen[g.id] = false;
          initialGreetingOpen[g.id] = false;
          initialJoinOpen[g.id] = false;
          initialGroupMeta[g.id] = g;
        }

        setGroupDraft(draft);
        setSavedGroupDraft(draft);
        setOpenCommunities((prev) => ({ ...initialOpen, ...prev }));
        setGreetingSectionOpen((prev) => ({ ...initialGreetingOpen, ...prev }));
        setJoinSectionOpen((prev) => ({ ...initialJoinOpen, ...prev }));
        setGroupMetaMap((prev) => ({ ...prev, ...initialGroupMeta }));
      } catch (e: any) {
        setGroupsErr(e?.message ?? "No se pudieron cargar tus comunidades.");
        setMyGroups([]);
        setGroupDraft({});
        setSavedGroupDraft({});
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
          const allVisible: GroupDocLite[] = snap.docs
            .map((d) => ({
              ...(d.data() as Omit<GroupDocLite, "id">),
              id: d.id,
            }))
            .filter((g) => g?.ownerId !== viewer.uid);

          setBrowseGroups(allVisible);

          const membershipChecks = await Promise.all(
            allVisible.map(async (g) => {
              try {
                const memberSnap = await getDoc(
                  doc(db, "groups", g.id, "members", viewer.uid)
                );

                const joinReqSnap = await getDoc(
                  doc(db, "groups", g.id, "joinRequests", viewer.uid)
                );

                return {
                  group: g,
                  isJoined: memberSnap.exists(),
                  hasPendingJoin:
                    joinReqSnap.exists() &&
                    (joinReqSnap.data() as any)?.status === "pending",
                  joinCreatedAt: joinReqSnap.exists()
                    ? ((joinReqSnap.data() as any)?.createdAt as
                        | Timestamp
                        | undefined)
                    : undefined,
                };
              } catch {
                return {
                  group: g,
                  isJoined: false,
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
            .filter((x) => x.hasPendingJoin)
            .map((x) => ({
              id: viewer.uid,
              groupId: x.group.id,
              status: "pending",
              createdAt: x.joinCreatedAt,
            }));

          setJoinedGroups(joined);
          setPendingJoinRequestsSent(pending);

          const meta: Record<string, GroupDocLite> = {};
          [...allVisible, ...joined].forEach((g) => {
            meta[g.id] = g;
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
    joinUnsubsRef.current.forEach((fn) => fn());
    joinUnsubsRef.current = [];

    if (!viewer?.uid || myGroups.length === 0) {
      setJoinRequestsByGroup({});
      return;
    }

    const unsubs: Array<() => void> = [];

    for (const g of myGroups) {
      if (g.visibility === "public") continue;

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
  }, [viewer?.uid, myGroups]);

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
        const grouped: Record<string, Array<{ id: string; data: GreetingRequestDoc }>> =
          {};

        snap.docs.forEach((d) => {
          const data = d.data() as GreetingRequestDoc;
          const gid = data.groupId;
          if (!gid) return;
          if (!grouped[gid]) grouped[gid] = [];
          grouped[gid].push({ id: d.id, data });
        });

        setGreetingsByGroup(grouped);
      },
      (e: any) => {
        setGroupsErr(e?.message ?? "No se pudieron cargar solicitudes de saludo.");
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
    const allGroupIds = myGroups.map((g) => g.id);
    if (allGroupIds.length === 0) return;

    setSeenCountsByGroup((prev) => {
      const next = { ...prev };

      for (const groupId of allGroupIds) {
        const joinCount = (joinRequestsByGroup[groupId] ?? []).length;
        const greetingCount = (greetingsByGroup[groupId] ?? []).length;

        if (!next[groupId]) {
          next[groupId] = { join: joinCount, greeting: greetingCount };
        }
      }

      return next;
    });
  }, [myGroups, joinRequestsByGroup, greetingsByGroup]);

  const relevantUserIds = useMemo(() => {
    const ids = new Set<string>();

    for (const rows of Object.values(joinRequestsByGroup)) {
      rows.forEach((r) => ids.add(r.userId));
    }

    for (const rows of Object.values(greetingsByGroup)) {
      rows.forEach((r) => ids.add(r.data.buyerId));
    }

    buyerPending.forEach((r) => ids.add(r.data.creatorId));

    return Array.from(ids).filter(Boolean);
  }, [joinRequestsByGroup, greetingsByGroup, buyerPending]);

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

  async function saveGroupSettings(groupId: string) {
    const g = myGroups.find((x) => x.id === groupId);
    if (!g) return;

    const d = groupDraft[groupId];
    if (!d) return;

    const isPublic = g.visibility === "public";
    const subscriptionPriceNum =
      d.subscriptionPrice.trim() === "" ? null : Number(d.subscriptionPrice);
    const saludoPriceNum =
      d.saludoPrice.trim() === "" ? null : Number(d.saludoPrice);

    if (
      d.subscriptionEnabled &&
      (subscriptionPriceNum == null ||
        Number.isNaN(subscriptionPriceNum) ||
        subscriptionPriceNum <= 0)
    ) {
      setGroupsErr("❌ Precio inválido para la suscripción mensual.");
      return;
    }

    if (
      d.saludoEnabled &&
      (saludoPriceNum == null || Number.isNaN(saludoPriceNum) || saludoPriceNum < 0)
    ) {
      setGroupsErr("❌ Precio inválido para saludos.");
      return;
    }

    if (isPublic && d.subscriptionEnabled) {
      setGroupsErr(
        "❌ Las comunidades públicas no pueden activar suscripción mensual."
      );
      return;
    }

    const existing = Array.isArray(g.offerings) ? g.offerings : [];
    const nextOfferings: GroupOffering[] = [];
    const hasType = (t: string) =>
      existing.some((o: any) => String(o?.type) === t);

    nextOfferings.push({
      type: "saludo",
      enabled: d.saludoEnabled,
      price: d.saludoEnabled ? saludoPriceNum : null,
      currency: d.saludoEnabled ? d.saludoCurrency : null,
    });

    if (hasType("consejo")) {
      const o = existing.find((x: any) => String(x?.type) === "consejo") as any;
      nextOfferings.push({
        type: "consejo",
        enabled: o?.enabled === true,
        price: o?.price ?? null,
        currency: o?.currency ?? null,
      });
    }

    if (hasType("mensaje")) {
      const o = existing.find((x: any) => String(x?.type) === "mensaje") as any;
      nextOfferings.push({
        type: "mensaje",
        enabled: o?.enabled === true,
        price: o?.price ?? null,
        currency: o?.currency ?? null,
      });
    }

    setSavingGroupId(groupId);
    setGroupsErr(null);
    setMsg(null);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        monetization: {
          isPaid: isPublic ? false : d.subscriptionEnabled,
          priceMonthly: isPublic || !d.subscriptionEnabled ? null : subscriptionPriceNum,
          currency: isPublic || !d.subscriptionEnabled ? null : d.subscriptionCurrency,
        },
      });

      await updateOfferings(groupId, nextOfferings);

      setMyGroups((prev) =>
        prev.map((gg) => {
          if (gg.id !== groupId) return gg;

          const filtered = (gg.offerings ?? []).filter(
            (o: any) => String(o?.type) !== "saludo"
          );

          return {
            ...gg,
            monetization: {
              isPaid: isPublic ? false : d.subscriptionEnabled,
              priceMonthly:
                isPublic || !d.subscriptionEnabled ? null : subscriptionPriceNum,
              currency:
                isPublic || !d.subscriptionEnabled ? null : d.subscriptionCurrency,
            },
            offerings: [
              ...filtered,
              {
                type: "saludo",
                enabled: d.saludoEnabled,
                price: d.saludoEnabled ? saludoPriceNum : null,
                currency: d.saludoEnabled ? d.saludoCurrency : null,
              },
            ],
          };
        })
      );

      setSavedGroupDraft((prev) => ({
        ...prev,
        [groupId]: {
          ...d,
          subscriptionEnabled: isPublic ? false : d.subscriptionEnabled,
          subscriptionPrice:
            isPublic || !d.subscriptionEnabled ? "" : d.subscriptionPrice,
          subscriptionCurrency: d.subscriptionCurrency,
          saludoEnabled: d.saludoEnabled,
          saludoPrice: d.saludoEnabled ? d.saludoPrice : "",
          saludoCurrency: d.saludoCurrency,
        },
      }));

      setGroupDraft((prev) => ({
        ...prev,
        [groupId]: {
          ...prev[groupId],
          subscriptionEnabled: isPublic ? false : prev[groupId].subscriptionEnabled,
          subscriptionPrice:
            isPublic || !prev[groupId].subscriptionEnabled
              ? ""
              : prev[groupId].subscriptionPrice,
          saludoPrice: prev[groupId].saludoEnabled
            ? prev[groupId].saludoPrice
            : "",
        },
      }));

      setMsg("✅ Configuración de comunidad guardada.");
    } catch (e: any) {
      setGroupsErr(e?.message ?? "❌ No se pudo actualizar la comunidad.");
    } finally {
      setSavingGroupId(null);
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
          ? "✅ Solicitud de saludo aceptada."
          : "✅ Solicitud de saludo rechazada."
      );
    } catch (e: any) {
      setGroupsErr(e?.message ?? "❌ No se pudo actualizar la solicitud.");
    } finally {
      setGreetingBusyId(null);
    }
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
    opts?: { compact?: boolean; subtitle?: string }
  ) {
    const communityName = g.name ?? "(Sin nombre)";
    const avatarFallback = getInitials(communityName);

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

            {opts?.subtitle ? <div style={styles.subtle}>{opts.subtitle}</div> : null}
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
    const publics = joinedGroups.filter((g) => g.visibility === "public");
    const privates = joinedGroups.filter((g) => g.visibility === "private");
    const hiddens = joinedGroups.filter((g) => g.visibility === "hidden");
    const others = joinedGroups.filter(
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
  }, [joinedGroups]);

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

        .owner-top-nav-icons {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
          align-items: center;
          width: 100%;
        }

        .owner-top-nav-icons button {
          outline: none;
          box-shadow: none;
          border: none;
        }

        .owner-top-nav-icons button:focus,
        .owner-top-nav-icons button:focus-visible,
        .owner-top-nav-icons button:active {
          outline: none;
          box-shadow: none;
          border: none;
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

          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                ...styles.card,
                padding: "6px 8px",
                borderRadius: 22,
              }}
            >
              <div className="owner-top-nav-icons">
                <button
                  type="button"
                  onClick={() => setActiveView("owned")}
                  aria-label="Mis comunidades"
                  title="Mis comunidades"
                  style={{
                    height: 48,
                    borderRadius: 14,
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    background: "transparent",
                    color:
                      activeView === "owned"
                        ? "#fff"
                        : "rgba(255,255,255,0.46)",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: "0",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      justifyItems: "center",
                      gap: 6,
                    }}
                  >
                    <IconMyCommunities active={activeView === "owned"} />
                    <span
                      style={{
                        width: 18,
                        height: 3,
                        borderRadius: 999,
                        background:
                          activeView === "owned" ? "#fff" : "transparent",
                      }}
                    />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveView("communities")}
                  aria-label="Otras comunidades"
                  title="Otras comunidades"
                  style={{
                    height: 48,
                    borderRadius: 14,
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    background: "transparent",
                    color:
                      activeView === "communities"
                        ? "#fff"
                        : "rgba(255,255,255,0.46)",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: "0",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      justifyItems: "center",
                      gap: 6,
                    }}
                  >
                    <IconOtherCommunities active={activeView === "communities"} />
                    <span
                      style={{
                        width: 18,
                        height: 3,
                        borderRadius: 999,
                        background:
                          activeView === "communities" ? "#fff" : "transparent",
                      }}
                    />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveView("greetings")}
                  aria-label="Saludos"
                  title="Saludos"
                  style={{
                    height: 48,
                    borderRadius: 14,
                    border: "none",
                    outline: "none",
                    boxShadow: "none",
                    background: "transparent",
                    color:
                      activeView === "greetings"
                        ? "#fff"
                        : "rgba(255,255,255,0.46)",
                    cursor: "pointer",
                    display: "grid",
                    placeItems: "center",
                    padding: "0",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      justifyItems: "center",
                      gap: 6,
                    }}
                  >
                    <IconGreetings active={activeView === "greetings"} />
                    <span
                      style={{
                        width: 18,
                        height: 3,
                        borderRadius: 999,
                        background:
                          activeView === "greetings" ? "#fff" : "transparent",
                      }}
                    />
                  </div>
                </button>
              </div>
            </div>

            {activeView === "owned" && (
              <>
                {!loadingGroups && myGroups.length === 0 && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.58)",
                      padding: "2px 2px 0",
                    }}
                  >
                    No tienes comunidades como owner.
                  </div>
                )}

                {ownedGrouped.map((section) => (
                  <div key={section.key} style={{ display: "grid", gap: 8 }}>
                    <div style={styles.sectionTitle}>{section.title}</div>

                    {section.items.map((g) => {
                      const d = groupDraft[g.id];
                      const saved = savedGroupDraft[g.id];
                      if (!d || !saved) return null;

                      const isOpen = openCommunities[g.id] === true;
                      const saving = savingGroupId === g.id;
                      const isPublic = g.visibility === "public";
                      const joinRequests = joinRequestsByGroup[g.id] ?? [];
                      const greetings = greetingsByGroup[g.id] ?? [];
                      const communityName = g.name ?? "(Sin nombre)";
                      const avatarFallback = getInitials(communityName);
                      const saludoEnabled = d.saludoEnabled;
                      const showJoinSection = !isPublic && joinRequests.length > 0;
                      const showGreetingsSection = saludoEnabled && greetings.length > 0;
                      const greetingListOpen = greetingSectionOpen[g.id] === true;
                      const joinListOpen = joinSectionOpen[g.id] === true;

                      const currentJoinCount = showJoinSection ? joinRequests.length : 0;
                      const currentGreetingCount = showGreetingsSection ? greetings.length : 0;

                      const seen = seenCountsByGroup[g.id] ?? {
                        join: 0,
                        greeting: 0,
                      };

                      const hasNewJoin = currentJoinCount > seen.join;
                      const hasNewGreeting = currentGreetingCount > seen.greeting;
                      const hasAlert = !isOpen && (hasNewJoin || hasNewGreeting);

                      const subChanged =
                        d.subscriptionEnabled !== saved.subscriptionEnabled ||
                        d.subscriptionPrice !== saved.subscriptionPrice ||
                        d.subscriptionCurrency !== saved.subscriptionCurrency;

                      const saludoChanged =
                        d.saludoEnabled !== saved.saludoEnabled ||
                        d.saludoPrice !== saved.saludoPrice ||
                        d.saludoCurrency !== saved.saludoCurrency;

                      const subscriptionCalc =
                        d.subscriptionEnabled && subChanged
                          ? calcNetAmount(d.subscriptionPrice)
                          : null;

                      const saludoCalc =
                        d.saludoEnabled && saludoChanged
                          ? calcNetAmount(d.saludoPrice)
                          : null;

                      const borderBackground =
                        hasAlert && hasNewJoin && hasNewGreeting
                          ? "linear-gradient(90deg, rgba(47,140,255,0.95) 0%, rgba(47,140,255,0.95) 50%, rgba(34,197,94,0.95) 50%, rgba(34,197,94,0.95) 100%)"
                          : hasAlert && hasNewJoin
                          ? "linear-gradient(90deg, rgba(47,140,255,0.95), rgba(47,140,255,0.95))"
                          : hasAlert && hasNewGreeting
                          ? "linear-gradient(90deg, rgba(34,197,94,0.95), rgba(34,197,94,0.95))"
                          : null;

                      return (
                        <div
                          key={g.id}
                          style={{
                            borderRadius: 16,
                            padding: hasAlert ? 1 : 0,
                            background: borderBackground ?? "transparent",
                            boxShadow: hasAlert
                              ? hasNewJoin && hasNewGreeting
                                ? "0 0 0 1px rgba(255,255,255,0.03), 0 10px 28px rgba(0,0,0,0.18)"
                                : hasNewJoin
                                ? "0 0 0 1px rgba(47,140,255,0.14), 0 10px 28px rgba(0,0,0,0.18)"
                                : "0 0 0 1px rgba(34,197,94,0.14), 0 10px 28px rgba(0,0,0,0.18)"
                              : undefined,
                            animation: hasAlert ? "ownerSidebarBuzz 4.8s infinite" : undefined,
                          }}
                        >
                          <div
                            style={{
                              ...styles.card,
                              border: "none",
                              margin: 0,
                              borderRadius: 16,
                              background: "rgba(0,0,0,0.96)",
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
                                  flex: 1,
                                }}
                                title="Ir a la comunidad"
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

                                <div
                                  style={{
                                    minWidth: 0,
                                    display: "grid",
                                    gap: 2,
                                    flex: 1,
                                  }}
                                >
                                  <span
                                    style={{
                                      fontSize: 13,
                                      fontWeight: 700,
                                      color: "#fff",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {communityName}
                                  </span>
                                </div>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  const nextOpen = !openCommunities[g.id];
                                  setOpenCommunities((prev) => ({
                                    ...prev,
                                    [g.id]: nextOpen,
                                  }));

                                  if (nextOpen) {
                                    setSeenCountsByGroup((prev) => ({
                                      ...prev,
                                      [g.id]: {
                                        join: currentJoinCount,
                                        greeting: currentGreetingCount,
                                      },
                                    }));
                                  }
                                }}
                                aria-label={
                                  isOpen
                                    ? "Cerrar opciones de comunidad"
                                    : "Abrir opciones de comunidad"
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
                                <Chevron open={isOpen} />
                              </button>
                            </div>

                            {isOpen && (
                              <div
                                style={{
                                  marginTop: 9,
                                  paddingTop: 9,
                                  borderTop: "1px solid rgba(255,255,255,0.06)",
                                  display: "grid",
                                  gap: 8,
                                }}
                              >
                                {showJoinSection && (
                                  <div style={styles.sectionPanel}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setJoinSectionOpen((prev) => ({
                                          ...prev,
                                          [g.id]: !prev[g.id],
                                        }))
                                      }
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        padding: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 10,
                                        width: "100%",
                                        color: "#fff",
                                        cursor: "pointer",
                                        textAlign: "left",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 8,
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 12,
                                            color: "#fff",
                                            fontWeight: 700,
                                          }}
                                        >
                                          Solicitudes de acceso
                                        </span>
                                        <CountBadge count={joinRequests.length} tone="blue" />
                                      </div>
                                      <Chevron open={joinListOpen} />
                                    </button>

                                    {joinListOpen && (
                                      <div className="mini-vertical-scroll">
                                        <div style={{ display: "grid", gap: 7 }}>
                                          {joinRequests.map((r) => {
                                            const approveKey = `${g.id}:${r.userId}:approve`;
                                            const rejectKey = `${g.id}:${r.userId}:reject`;
                                            const busy =
                                              joinBusyKey === approveKey ||
                                              joinBusyKey === rejectKey;
                                            const requester = userMiniMap[r.userId] ?? null;
                                            const letter = getInitials(requester?.displayName);

                                            return (
                                              <div key={r.id} style={styles.miniItem}>
                                                <div
                                                  style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    minWidth: 0,
                                                  }}
                                                >
                                                  {requester?.photoURL ? (
                                                    <img
                                                      src={requester.photoURL}
                                                      alt={requester.displayName}
                                                      style={{
                                                        width: 28,
                                                        height: 28,
                                                        borderRadius: 10,
                                                        objectFit: "cover",
                                                        border:
                                                          "1px solid rgba(255,255,255,0.12)",
                                                        flexShrink: 0,
                                                      }}
                                                    />
                                                  ) : (
                                                    <div
                                                      style={{
                                                        width: 28,
                                                        height: 28,
                                                        borderRadius: 10,
                                                        background:
                                                          "rgba(255,255,255,0.05)",
                                                        border:
                                                          "1px solid rgba(255,255,255,0.12)",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        fontWeight: 700,
                                                        fontSize: 11,
                                                        color: "#fff",
                                                        flexShrink: 0,
                                                      }}
                                                    >
                                                      {letter}
                                                    </div>
                                                  )}

                                                  <div style={{ minWidth: 0 }}>
                                                    <div
                                                      style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                        minWidth: 0,
                                                        flexWrap: "wrap",
                                                      }}
                                                    >
                                      
                                                      {renderUserLink(r.userId)}
                                                    </div>
                                                    <div style={styles.subtle}>
                                                      Solicitud pendiente
                                                    </div>
                                                  </div>
                                                </div>

                                                <div
                                                  style={{
                                                    display: "flex",
                                                    gap: 8,
                                                    flexWrap: "wrap",
                                                  }}
                                                >
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleApproveJoin(g.id, r.userId)
                                                    }
                                                    disabled={busy}
                                                    style={{
                                                      ...styles.buttonPrimary,
                                                      opacity: busy ? 0.8 : 1,
                                                      cursor: busy
                                                        ? "not-allowed"
                                                        : "pointer",
                                                    }}
                                                  >
                                                    {busy ? "Procesando..." : "Aprobar"}
                                                  </button>

                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleRejectJoin(g.id, r.userId)
                                                    }
                                                    disabled={busy}
                                                    style={{
                                                      ...styles.buttonSecondary,
                                                      opacity: busy ? 0.7 : 1,
                                                      cursor: busy
                                                        ? "not-allowed"
                                                        : "pointer",
                                                    }}
                                                  >
                                                    {busy ? "Procesando..." : "Rechazar"}
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {showGreetingsSection && (
                                  <div style={styles.sectionPanel}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setGreetingSectionOpen((prev) => ({
                                          ...prev,
                                          [g.id]: !prev[g.id],
                                        }))
                                      }
                                      style={{
                                        background: "transparent",
                                        border: "none",
                                        padding: 0,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 10,
                                        width: "100%",
                                        color: "#fff",
                                        cursor: "pointer",
                                        textAlign: "left",
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 8,
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontSize: 12,
                                            color: "#fff",
                                            fontWeight: 700,
                                          }}
                                        >
                                          Solicitudes de saludo
                                        </span>
                                        <CountBadge count={greetings.length} tone="green" />
                                      </div>
                                      <Chevron open={greetingListOpen} />
                                    </button>

                                    {greetingListOpen && (
                                      <div className="mini-vertical-scroll">
                                        <div style={{ display: "grid", gap: 7 }}>
                                          {greetings.map((r) => {
                                            const req = r.data;
                                            const busy = greetingBusyId === r.id;

                                            return (
                                              <div key={r.id} style={styles.miniItem}>
                                                <div style={{ display: "grid", gap: 3 }}>
                                                  <div
                                                    style={{
                                                      fontSize: 12,
                                                      fontWeight: 700,
                                                      color: "#fff",
                                                      lineHeight: 1.25,
                                                    }}
                                                  >
                                                    {typeLabel(req.type)} para{" "}
                                                    <span
                                                      style={{
                                                        color: "rgba(255,255,255,0.88)",
                                                      }}
                                                    >
                                                      {req.toName}
                                                    </span>
                                                  </div>

                                                  <div
                                                    style={{
                                                      display: "flex",
                                                      alignItems: "center",
                                                      gap: 6,
                                                      flexWrap: "wrap",
                                                    }}
                                                  >
                                                    <span style={styles.subtle}>Comprador:</span>
                                                    {renderUserLink(req.buyerId)}
                                                  </div>

                                                  {req.createdAt ? (
                                                    <div style={styles.subtle}>
                                                      {fmtDate(req.createdAt)}
                                                    </div>
                                                  ) : null}
                                                </div>

                                                {req.instructions ? (
                                                  <div
                                                    style={{
                                                      borderRadius: 10,
                                                      border:
                                                        "1px solid rgba(255,255,255,0.10)",
                                                      background: "rgba(0,0,0,0.18)",
                                                      padding: "7px 8px",
                                                      whiteSpace: "pre-wrap",
                                                      fontSize: 12,
                                                      lineHeight: 1.3,
                                                      color: "rgba(255,255,255,0.92)",
                                                    }}
                                                  >
                                                    {req.instructions}
                                                  </div>
                                                ) : null}

                                                <div
                                                  style={{
                                                    display: "flex",
                                                    gap: 8,
                                                    flexWrap: "wrap",
                                                  }}
                                                >
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleGreetingAction(r.id, "accept")
                                                    }
                                                    disabled={busy}
                                                    style={{
                                                      ...styles.buttonPrimary,
                                                      opacity: busy ? 0.8 : 1,
                                                      cursor: busy
                                                        ? "not-allowed"
                                                        : "pointer",
                                                    }}
                                                  >
                                                    {busy ? "Procesando..." : "Aceptar"}
                                                  </button>

                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleGreetingAction(r.id, "reject")
                                                    }
                                                    disabled={busy}
                                                    style={{
                                                      ...styles.buttonSecondary,
                                                      opacity: busy ? 0.7 : 1,
                                                      cursor: busy
                                                        ? "not-allowed"
                                                        : "pointer",
                                                    }}
                                                  >
                                                    {busy ? "Procesando..." : "Rechazar"}
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}

                                {!isPublic && (
                                  <div style={styles.sectionPanel}>
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        gap: 10,
                                      }}
                                    >
                                      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                                        <span
                                          style={{
                                            fontSize: 12,
                                            color: "#fff",
                                            fontWeight: 700,
                                          }}
                                        >
                                          Suscripción mensual
                                        </span>
                                      </div>

                                      <Switch
                                        checked={d.subscriptionEnabled}
                                        disabled={saving}
                                        onChange={(next) =>
                                          setGroupDraft((prev) => ({
                                            ...prev,
                                            [g.id]: {
                                              ...prev[g.id],
                                              subscriptionEnabled: next,
                                              subscriptionPrice: next
                                                ? prev[g.id].subscriptionPrice
                                                : "",
                                            },
                                          }))
                                        }
                                        label="Activar suscripción mensual"
                                      />
                                    </div>

                                    {d.subscriptionEnabled && (
                                      <>
                                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                          <input
                                            type="number"
                                            value={d.subscriptionPrice}
                                            onChange={(e) =>
                                              setGroupDraft((prev) => ({
                                                ...prev,
                                                [g.id]: {
                                                  ...prev[g.id],
                                                  subscriptionPrice: e.target.value,
                                                },
                                              }))
                                            }
                                            placeholder="Precio mensual"
                                            style={{ ...styles.input, width: 116 }}
                                          />

                                          <select
                                            value={d.subscriptionCurrency}
                                            onChange={(e) =>
                                              setGroupDraft((prev) => ({
                                                ...prev,
                                                [g.id]: {
                                                  ...prev[g.id],
                                                  subscriptionCurrency:
                                                    e.target.value as Currency,
                                                },
                                              }))
                                            }
                                            style={{ ...styles.input, flex: 1, minWidth: 82 }}
                                          >
                                            <option value="MXN">MXN</option>
                                            <option value="USD">USD</option>
                                          </select>
                                        </div>

                                        {subscriptionCalc && (
                                          <div
                                            style={{
                                              fontSize: 10,
                                              lineHeight: 1.3,
                                              color: "rgba(255,255,255,0.42)",
                                              paddingTop: 1,
                                            }}
                                          >
                                            Por una suscripción de{" "}
                                            {formatMoney(
                                              subscriptionCalc.gross,
                                              d.subscriptionCurrency
                                            )}
                                            , tú cobras{" "}
                                            {formatMoney(
                                              subscriptionCalc.net,
                                              d.subscriptionCurrency
                                            )}{" "}
                                          </div>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}

                                <div style={styles.sectionPanel}>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 10,
                                    }}
                                  >
                                    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                                      <span
                                        style={{
                                          fontSize: 12,
                                          color: "#fff",
                                          fontWeight: 700,
                                        }}
                                      >
                                        Saludos en comunidad
                                      </span>
                                    </div>

                                    <Switch
                                      checked={d.saludoEnabled}
                                      disabled={saving}
                                      onChange={(next) =>
                                        setGroupDraft((prev) => ({
                                          ...prev,
                                          [g.id]: {
                                            ...prev[g.id],
                                            saludoEnabled: next,
                                            saludoPrice: next
                                              ? prev[g.id].saludoPrice
                                              : "",
                                          },
                                        }))
                                      }
                                      label="Saludos activos en esta comunidad"
                                    />
                                  </div>

                                  {d.saludoEnabled && (
                                    <>
                                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                        <input
                                          type="number"
                                          value={d.saludoPrice}
                                          onChange={(e) =>
                                            setGroupDraft((prev) => ({
                                              ...prev,
                                              [g.id]: {
                                                ...prev[g.id],
                                                saludoPrice: e.target.value,
                                              },
                                            }))
                                          }
                                          placeholder="Precio"
                                          style={{ ...styles.input, width: 100 }}
                                        />

                                        <select
                                          value={d.saludoCurrency}
                                          onChange={(e) =>
                                            setGroupDraft((prev) => ({
                                              ...prev,
                                              [g.id]: {
                                                ...prev[g.id],
                                                saludoCurrency:
                                                  e.target.value as Currency,
                                              },
                                            }))
                                          }
                                          style={{ ...styles.input, flex: 1, minWidth: 82 }}
                                        >
                                          <option value="MXN">MXN</option>
                                          <option value="USD">USD</option>
                                        </select>
                                      </div>

                                      {saludoCalc && (
                                        <div
                                          style={{
                                            fontSize: 10,
                                            lineHeight: 1.3,
                                            color: "rgba(255,255,255,0.42)",
                                            paddingTop: 1,
                                          }}
                                        >
                                          Por un saludo de{" "}
                                          {formatMoney(
                                            saludoCalc.gross,
                                            d.saludoCurrency
                                          )}
                                          , tú cobras{" "}
                                          {formatMoney(saludoCalc.net, d.saludoCurrency)}{" "}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  onClick={() => saveGroupSettings(g.id)}
                                  disabled={saving}
                                  style={{
                                    ...styles.buttonSecondary,
                                    width: "100%",
                                    opacity: saving ? 0.7 : 1,
                                    cursor: saving ? "not-allowed" : "pointer",
                                  }}
                                >
                                  {saving ? "Guardando..." : "Guardar cambios"}
                                </button>

                                {isPublic && (
                                  <div
                                    style={{
                                      fontSize: 10,
                                      lineHeight: 1.35,
                                      color: "rgba(255,255,255,0.36)",
                                      padding: "0 2px 2px",
                                    }}
                                  >
                                    Para activar suscripción mensual tu comunidad debe
                                    ser privada u oculta.
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </>
            )}

            {activeView === "communities" && (
              <>
                {joinedGrouped.map((section) => (
                  <div key={`joined-${section.key}`} style={{ display: "grid", gap: 8 }}>
                    <div style={styles.sectionTitle}>{section.title}</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {section.items.map((g) =>
                        renderCommunityCard(g, { subtitle: "Ya formas parte" })
                      )}
                    </div>
                  </div>
                ))}

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={styles.sectionTitle}>Solicitudes de acceso enviadas</div>

                  {pendingJoinRequestsSent.length === 0 ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.58)",
                        padding: "2px 2px 0",
                      }}
                    >
                      No tienes solicitudes pendientes.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 8 }}>
                      {pendingJoinRequestsSent.map((row) => {
                        const community = groupMetaMap[row.groupId] ?? null;
                        if (!community) return null;

                        return renderCommunityCard(community, {
                          subtitle: row.createdAt
                            ? `Solicitud pendiente · ${fmtDate(row.createdAt)}`
                            : "Solicitud pendiente",
                        });
                      })}
                    </div>
                  )}
                </div>

                {browseGrouped.map((section) => (
                  <div key={`browse-${section.key}`} style={{ display: "grid", gap: 8 }}>
                    <div style={styles.sectionTitle}>{section.title}</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {section.items.map((g) =>
                        renderCommunityCard(g, {
                          subtitle:
                            g.visibility === "private"
                              ? "Acceso con solicitud"
                              : "Acceso abierto",
                        })
                      )}
                    </div>
                  </div>
                ))}

                {!loadingCommunities &&
                  joinedGroups.length === 0 &&
                  pendingJoinRequestsSent.length === 0 &&
                  browseGroups.length === 0 && (
                    <div
                      style={{
                        fontSize: 12,
                        color: "rgba(255,255,255,0.58)",
                        padding: "2px 2px 0",
                      }}
                    >
                      No hay comunidades disponibles.
                    </div>
                  )}
              </>
            )}

            {activeView === "greetings" && (
              <div style={{ display: "grid", gap: 8 }}>
                <div style={styles.sectionTitle}>Saludos solicitados</div>

                {buyerPending.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.58)",
                      padding: "2px 2px 0",
                    }}
                  >
                    No tienes saludos pendientes por recibir.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {buyerPending.map((row) => {
                      const req = row.data;
                      const group = groupMetaMap[req.groupId] ?? null;

                      return (
                        <div key={row.id} style={styles.card}>
                          <div style={{ display: "grid", gap: 5 }}>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: "#fff",
                                lineHeight: 1.25,
                              }}
                            >
                              {typeLabel(req.type)} para {req.toName}
                            </div>

                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              <span style={styles.subtle}>Creador:</span>
                              {renderUserLink(req.creatorId)}
                            </div>

                            {group ? (
                              <button
                                type="button"
                                onClick={() => router.push(`/groups/${group.id}`)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  padding: 0,
                                  margin: 0,
                                  textAlign: "left",
                                  cursor: "pointer",
                                  color: "#fff",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  textDecoration: "underline",
                                  textUnderlineOffset: 2,
                                }}
                              >
                                {group.name ?? "Ir a la comunidad"}
                              </button>
                            ) : null}

                            {req.instructions ? (
                              <div
                                style={{
                                  borderRadius: 10,
                                  border: "1px solid rgba(255,255,255,0.10)",
                                  background: "rgba(0,0,0,0.18)",
                                  padding: "7px 8px",
                                  whiteSpace: "pre-wrap",
                                  fontSize: 12,
                                  lineHeight: 1.3,
                                  color: "rgba(255,255,255,0.92)",
                                }}
                              >
                                {req.instructions}
                              </div>
                            ) : null}

                            {req.createdAt ? (
                              <div style={styles.subtle}>{fmtDate(req.createdAt)}</div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
        </div>
      </aside>
    </>
  );
}