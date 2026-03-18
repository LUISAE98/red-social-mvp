"use client";

import Link from "next/link";
import {
  CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  banGroupMember,
  muteGroupMember,
  removeGroupMember,
  unbanGroupMember,
  unmuteGroupMember,
} from "../../../../lib/groups/groupModeration";

type GroupMembersTabProps = {
  groupId: string;
  isOwner: boolean;
  canMembersViewList: boolean;
};

type MemberDoc = {
  id: string;
  uid?: string;
  userId?: string;
  role?: string;
  roleInGroup?: string;
  status?: string;
  mutedUntil?: any;
  createdAt?: any;
  joinedAt?: any;
  updatedAt?: any;
};

type EnrichedMember = MemberDoc & {
  resolvedUid: string;
  displayName: string | null;
  handle: string | null;
  photoURL: string | null;
};

type FilterValue =
  | "all"
  | "active"
  | "muted"
  | "banned"
  | "removed"
  | "mod"
  | "member";

type ModerationAction =
  | "mute"
  | "unmute"
  | "ban"
  | "unban"
  | "remove";

type MenuPosition = {
  top: number;
  left: number;
};

type CanonicalMemberStatus = "active" | "muted" | "banned" | "removed";

function normalizeRole(role?: string) {
  if (role === "owner") return "owner";
  if (role === "mod") return "mod";
  if (role === "moderator") return "mod";
  return "member";
}

function getMutedUntilDate(mutedUntil?: any): Date | null {
  if (!mutedUntil) return null;

  if (mutedUntil?.toDate instanceof Function) {
    const d = mutedUntil.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }

  if (mutedUntil instanceof Date && !Number.isNaN(mutedUntil.getTime())) {
    return mutedUntil;
  }

  if (typeof mutedUntil === "string" || typeof mutedUntil === "number") {
    const d = new Date(mutedUntil);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function resolveEffectiveStatus(
  status?: string,
  mutedUntil?: any
): CanonicalMemberStatus {
  if (status === "banned") return "banned";
  if (status === "removed") return "removed";

  // Compatibilidad legacy temporal
  if (status === "kicked") return "removed";
  if (status === "expelled") return "removed";

  if (status === "muted") {
    const until = getMutedUntilDate(mutedUntil);
    if (until && until.getTime() <= Date.now()) {
      return "active";
    }
    return "muted";
  }

  return "active";
}

function getRemainingMutedDaysLabel(mutedUntil?: any) {
  const until = getMutedUntilDate(mutedUntil);
  if (!until) return null;

  const diffMs = until.getTime() - Date.now();
  if (diffMs <= 0) return null;

  const days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  return days === 1 ? "resta 1 día" : `restan ${days} días`;
}

function friendlyRole(role?: string) {
  const normalized = normalizeRole(role);
  if (normalized === "mod") return "Moderador";
  return "Miembro";
}

function friendlyStatus(status?: string, mutedUntil?: any) {
  const normalized = resolveEffectiveStatus(status, mutedUntil);

  if (normalized === "muted") {
    const remaining = getRemainingMutedDaysLabel(mutedUntil);
    return remaining ? `Muteado, ${remaining}` : "Muteado";
  }

  if (normalized === "banned") return "Baneado";
  if (normalized === "removed") return "Expulsado";
  return "Activo";
}

function statusDotColor(status?: string, mutedUntil?: any) {
  const normalized = resolveEffectiveStatus(status, mutedUntil);
  if (normalized === "banned") return "#ff4d4f";
  if (normalized === "removed") return "#b91c1c";
  if (normalized === "muted") return "#f5a623";
  return "#22c55e";
}

function memberInitials(member: EnrichedMember) {
  const raw =
    member.displayName?.trim() ||
    member.handle?.trim() ||
    member.resolvedUid ||
    "U";
  return raw.slice(0, 2).toUpperCase();
}

function memberPrimaryName(member: EnrichedMember) {
  return (
    member.displayName?.trim() ||
    member.handle?.trim() ||
    "Usuario sin nombre"
  );
}

function buildActionLabel(action: ModerationAction) {
  if (action === "mute") return "Mutear";
  if (action === "unmute") return "Quitar mute";
  if (action === "ban") return "Banear";
  if (action === "unban") return "Quitar ban";
  return "Expulsar del grupo";
}

export default function GroupMembersTab({
  groupId,
  isOwner,
  canMembersViewList,
}: GroupMembersTabProps) {
  const currentUid = auth.currentUser?.uid ?? null;
  const [members, setMembers] = useState<EnrichedMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [openMenuForUid, setOpenMenuForUid] = useState<string | null>(null);
  const [actionLoadingForUid, setActionLoadingForUid] = useState<string | null>(
    null
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const [muteModalOpen, setMuteModalOpen] = useState(false);
  const [muteTarget, setMuteTarget] = useState<EnrichedMember | null>(null);
  const [muteDays, setMuteDays] = useState("7");

  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';

  const safeCanMembersViewList = canMembersViewList === true;
  const canUseFilters = isOwner;
  const canSeeStatus = isOwner;
  const canViewList = isOwner || safeCanMembersViewList;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!openMenuForUid) return;

    const openUid = openMenuForUid;

    function updateMenuPosition() {
      const button = menuButtonRefs.current[openUid];
      if (!button) {
        setMenuPosition(null);
        return;
      }

      const rect = button.getBoundingClientRect();
      const panelWidth = isMobile ? 170 : 190;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const estimatedPanelHeight = 180;
      const gap = 8;

      let left = rect.right - panelWidth;
      if (left < 8) left = 8;
      if (left + panelWidth > viewportWidth - 8) {
        left = viewportWidth - panelWidth - 8;
      }

      let top = rect.bottom + gap;
      if (top + estimatedPanelHeight > viewportHeight - 8) {
        top = Math.max(8, rect.top - estimatedPanelHeight - gap);
      }

      setMenuPosition({ top, left });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [openMenuForUid, isMobile]);

  useEffect(() => {
    if (!openMenuForUid && !muteModalOpen) return;

    const openUid = openMenuForUid;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;

      const panelEl = menuPanelRef.current;
      const buttonEl = openUid ? menuButtonRefs.current[openUid] ?? null : null;
      const clickedInsidePanel = !!panelEl && panelEl.contains(target);
      const clickedButton = !!buttonEl && buttonEl.contains(target);

      if (!clickedInsidePanel && !clickedButton && !muteModalOpen) {
        setOpenMenuForUid(null);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuForUid(null);
        setMuteModalOpen(false);
        setMuteTarget(null);
        setMuteDays("7");
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openMenuForUid, muteModalOpen]);

  useEffect(() => {
    if (!canViewList) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const membersRef = collection(db, "groups", groupId, "members");

    const unsub = onSnapshot(
      membersRef,
      async (snap) => {
        try {
          const rawMembers = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              ...data,
            } as MemberDoc;
          });

          const enriched = await Promise.all(
            rawMembers.map(async (member) => {
              const resolvedUid = member.uid || member.userId || member.id;
              let displayName: string | null = null;
              let handle: string | null = null;
              let photoURL: string | null = null;

              try {
                const userSnap = await getDoc(doc(db, "users", resolvedUid));
                if (userSnap.exists()) {
                  const userData = userSnap.data() as any;
                  const firstName =
                    typeof userData.firstName === "string"
                      ? userData.firstName.trim()
                      : "";
                  const lastName =
                    typeof userData.lastName === "string"
                      ? userData.lastName.trim()
                      : "";
                  const fullName = `${firstName} ${lastName}`.trim();

                  displayName =
                    (typeof userData.displayName === "string" &&
                      userData.displayName.trim()) ||
                    fullName ||
                    null;

                  handle =
                    (typeof userData.handle === "string" &&
                      userData.handle.trim()) ||
                    null;

                  photoURL =
                    (typeof userData.photoURL === "string" &&
                      userData.photoURL.trim()) ||
                    null;
                }
              } catch (e) {
                console.error("No se pudo leer users/{uid}:", resolvedUid, e);
              }

              return {
                ...member,
                resolvedUid,
                displayName,
                handle,
                photoURL,
              } as EnrichedMember;
            })
          );

          setMembers(enriched);
          setLoading(false);
        } catch (e: any) {
          console.error(e);
          setError(e?.message ?? "No se pudo cargar la lista de integrantes.");
          setLoading(false);
        }
      },
      (e) => {
        console.error(e);
        setError(e?.message ?? "No se pudo cargar la lista de integrantes.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, [groupId, canViewList]);

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();

    return members
      .filter((member) => {
        const role = normalizeRole(member.roleInGroup || member.role);
        if (role === "owner") return false;

        const status = resolveEffectiveStatus(member.status, member.mutedUntil);
        const name = memberPrimaryName(member).toLowerCase();
        const handle = (member.handle || "").toLowerCase();

        const matchesSearch =
          !term || name.includes(term) || handle.includes(term);

        const matchesFilter =
          !canUseFilters || filter === "all"
            ? true
            : filter === "active" ||
              filter === "muted" ||
              filter === "banned" ||
              filter === "removed"
            ? status === filter
            : role === filter;

        return matchesSearch && matchesFilter;
      })
      .sort((a, b) => {
        const roleWeight = (role?: string) => {
          const normalized = normalizeRole(role);
          if (normalized === "mod") return 0;
          return 1;
        };

        const aw = roleWeight(a.roleInGroup || a.role);
        const bw = roleWeight(b.roleInGroup || b.role);

        if (aw !== bw) return aw - bw;

        const an = memberPrimaryName(a).toLowerCase();
        const bn = memberPrimaryName(b).toLowerCase();
        return an.localeCompare(bn);
      });
  }, [members, search, filter, canUseFilters]);

  async function handleToggleMembersVisibility(nextValue: boolean) {
    if (!isOwner) return;

    setSavingVisibility(true);
    setError(null);

    try {
      await updateDoc(doc(db, "groups", groupId), {
        settings: {
          membersListVisibility: nextValue ? "members" : "owner_only",
        },
      });
    } catch (e: any) {
      console.error(e);
      setError(
        e?.message ?? "No se pudo actualizar la visibilidad de integrantes."
      );
    } finally {
      setSavingVisibility(false);
    }
  }

  function canModerateMember(member: EnrichedMember) {
    if (!isOwner) return false;
    if (!member.resolvedUid) return false;
    if (member.resolvedUid === currentUid) return false;

    const role = normalizeRole(member.roleInGroup || member.role);
    if (role === "owner") return false;

    return true;
  }

  function getAvailableActions(member: EnrichedMember): ModerationAction[] {
    const status = resolveEffectiveStatus(member.status, member.mutedUntil);

    if (status === "banned") {
      return ["unban"];
    }

    if (status === "removed") {
      return [];
    }

    if (status === "muted") {
      return ["unmute", "ban", "remove"];
    }

    return ["mute", "ban", "remove"];
  }

  async function runAction(
    member: EnrichedMember,
    action: Exclude<ModerationAction, "mute">
  ) {
    const targetUserId = member.resolvedUid;
    if (!targetUserId) return;

    setError(null);
    setActionMessage(null);
    setActionLoadingForUid(targetUserId);

    try {
      if (action === "unmute") {
        await unmuteGroupMember(groupId, targetUserId);
      } else if (action === "ban") {
        await banGroupMember(groupId, targetUserId);
      } else if (action === "unban") {
        await unbanGroupMember(groupId, targetUserId);
      } else if (action === "remove") {
        await removeGroupMember(groupId, targetUserId);
      }

      const displayName = memberPrimaryName(member);
      setActionMessage(`${buildActionLabel(action)} aplicado a ${displayName}.`);
      setOpenMenuForUid(null);
      setMenuPosition(null);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "No se pudo completar la acción.");
    } finally {
      setActionLoadingForUid(null);
    }
  }

  function handleModerationAction(
    member: EnrichedMember,
    action: ModerationAction
  ) {
    if (action === "mute") {
      setError(null);
      setActionMessage(null);
      setMuteTarget(member);
      setMuteDays("7");
      setMuteModalOpen(true);
      setOpenMenuForUid(null);
      setMenuPosition(null);
      return;
    }

    void runAction(member, action);
  }

  function closeMuteModal() {
    if (muteTarget && actionLoadingForUid === muteTarget.resolvedUid) return;
    setMuteModalOpen(false);
    setMuteTarget(null);
    setMuteDays("7");
  }

  async function handleConfirmMute() {
    if (!muteTarget?.resolvedUid) return;

    const durationDays = Number(muteDays);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
      setError("durationDays debe ser un entero entre 1 y 365.");
      return;
    }

    setError(null);
    setActionMessage(null);
    setActionLoadingForUid(muteTarget.resolvedUid);

    try {
      await muteGroupMember(groupId, muteTarget.resolvedUid, durationDays);
      setActionMessage(
        `Mutear aplicado a ${memberPrimaryName(muteTarget)} durante ${durationDays} día(s).`
      );
      closeMuteModal();
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "No se pudo completar la acción.");
    } finally {
      setActionLoadingForUid(null);
    }
  }

  const wrapStyle: CSSProperties = {
    display: "grid",
    gap: 12,
    fontFamily: fontStack,
  };

  const cardStyle: CSSProperties = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.028)",
    padding: isMobile ? 12 : 14,
    color: "#fff",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    boxSizing: "border-box",
    overflow: "visible",
  };

  const topRow: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: isMobile ? "flex-start" : "center",
    gap: 10,
    flexWrap: "wrap",
  };

  const titleBlock: CSSProperties = {
    minWidth: 0,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: isMobile ? 14 : 16,
    fontWeight: 600,
    lineHeight: 1.1,
    letterSpacing: "-0.02em",
    color: "#fff",
  };

  const subtitleStyle: CSSProperties = {
    margin: "4px 0 0 0",
    fontSize: isMobile ? 10.5 : 12,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.62)",
  };

  const visibilityRow: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    marginTop: isMobile ? 2 : 0,
  };

  const switchTextWrap: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: 1,
  };

  const switchTitleStyle: CSSProperties = {
    fontSize: isMobile ? 10.5 : 11.5,
    fontWeight: 600,
    lineHeight: 1.15,
    color: "rgba(255,255,255,0.93)",
  };

  const switchSubtitleStyle: CSSProperties = {
    fontSize: isMobile ? 9.5 : 10,
    lineHeight: 1.2,
    color: "rgba(255,255,255,0.58)",
  };

  const switchButtonStyle: CSSProperties = {
    position: "relative",
    width: 36,
    height: 20,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: safeCanMembersViewList ? "#ffffff" : "rgba(255,255,255,0.10)",
    transition: "all 0.2s ease",
    cursor: savingVisibility ? "not-allowed" : "pointer",
    flexShrink: 0,
    padding: 0,
    opacity: savingVisibility ? 0.7 : 1,
  };

  const switchThumbStyle: CSSProperties = {
    position: "absolute",
    top: 2,
    left: safeCanMembersViewList ? 18 : 2,
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: safeCanMembersViewList ? "#000" : "#fff",
    transition: "all 0.2s ease",
  };

  const controlsRow: CSSProperties = {
    display: "grid",
    gridTemplateColumns: canUseFilters
      ? isMobile
        ? "minmax(0, 1fr) 118px"
        : "minmax(0, 1fr) 180px"
      : "minmax(0, 1fr)",
    gap: 8,
    marginTop: 12,
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    height: isMobile ? 36 : 40,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.035)",
    color: "#fff",
    padding: isMobile ? "0 10px" : "0 11px",
    outline: "none",
    fontSize: isMobile ? 11.5 : 12.5,
    fontWeight: 400,
    fontFamily: fontStack,
    boxSizing: "border-box",
    WebkitAppearance: "none",
    appearance: "none",
  };

  const selectStyle: CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
    background: isMobile ? "#111" : "rgba(255,255,255,0.035)",
  };

  const helperText: CSSProperties = {
    marginTop: 9,
    marginBottom: 0,
    fontSize: isMobile ? 10 : 10.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.60)",
  };

  const listStyle: CSSProperties = {
    display: "grid",
    gap: 8,
    marginTop: 14,
    overflow: "visible",
  };

  const rowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile
      ? "34px minmax(0, 1fr) auto"
      : "42px minmax(0, 1fr) auto",
    gap: isMobile ? 8 : 12,
    alignItems: "center",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: isMobile ? "8px 9px" : "10px 12px",
    overflow: "visible",
  };

  const avatarStyle: CSSProperties = {
    width: isMobile ? 34 : 42,
    height: isMobile ? 34 : 42,
    borderRadius: "50%",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: isMobile ? 10.5 : 12,
    fontWeight: 700,
    flexShrink: 0,
  };

  const centerColStyle: CSSProperties = {
    minWidth: 0,
    display: "grid",
    gap: isMobile ? 3 : 4,
  };

  const nameLinkStyle: CSSProperties = {
    fontSize: isMobile ? 11.5 : 13,
    fontWeight: 600,
    color: "#fff",
    textDecoration: "none",
    lineHeight: 1.2,
    display: "inline-block",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "100%",
  };

  const namePlainStyle: CSSProperties = {
    fontSize: isMobile ? 11.5 : 13,
    fontWeight: 600,
    color: "#fff",
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };

  const mobileMetaRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  };

  const statusWrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: isMobile ? 5 : 7,
    fontSize: isMobile ? 9.5 : 11.5,
    color: "rgba(255,255,255,0.68)",
    lineHeight: 1,
    whiteSpace: "nowrap",
    minWidth: 0,
  };

  const desktopRightMetaWrap: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    justifySelf: "end",
    overflow: "visible",
    position: "relative",
  };

  const dividerStyle: CSSProperties = {
    width: 1,
    height: isMobile ? 16 : 22,
    background: "rgba(255,255,255,0.10)",
  };

  const roleBadge: CSSProperties = {
    minWidth: isMobile ? 72 : 92,
    textAlign: "center",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    padding: isMobile ? "6px 8px" : "8px 11px",
    fontSize: isMobile ? 9.5 : 11.5,
    fontWeight: 500,
    color: "#fff",
    whiteSpace: "nowrap",
    lineHeight: 1.1,
  };

  const menuButtonStyle: CSSProperties = {
    width: isMobile ? 32 : 34,
    height: isMobile ? 32 : 34,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
    lineHeight: 1,
    fontSize: 18,
    flexShrink: 0,
  };

  const menuPanelStyle: CSSProperties = {
    position: "fixed",
    minWidth: isMobile ? 170 : 190,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(12,12,12,0.98)",
    boxShadow: "0 14px 34px rgba(0,0,0,0.34)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    padding: 6,
    zIndex: 300,
    display: "grid",
    gap: 4,
  };

  const menuItemStyle: CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 10px",
    borderRadius: 8,
    border: "none",
    background: "transparent",
    color: "#fff",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: fontStack,
    textAlign: "left",
    cursor: "pointer",
  };

  const dangerMenuItemStyle: CSSProperties = {
    ...menuItemStyle,
    color: "#ff8a8a",
  };

  const disabledMenuItemStyle: CSSProperties = {
    ...menuItemStyle,
    color: "rgba(255,255,255,0.38)",
    cursor: "not-allowed",
  };

  const emptyStyle: CSSProperties = {
    marginTop: 14,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: isMobile ? "10px 11px" : "11px 12px",
    fontSize: isMobile ? 10.5 : 11.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.72)",
  };

  const actionNoticeStyle: CSSProperties = {
    marginTop: 12,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: isMobile ? "10px 11px" : "11px 12px",
    fontSize: isMobile ? 10.5 : 11.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.82)",
  };

  const modalBackdropStyle: CSSProperties = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.62)",
    display: "grid",
    placeItems: "center",
    padding: 16,
    zIndex: 100000,
  };

  const modalCardStyle: CSSProperties = {
    width: "min(420px, 92vw)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(12,12,12,0.98)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    padding: 16,
    display: "grid",
    gap: 12,
    color: "#fff",
  };

  const modalTitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.15,
  };

  const modalTextStyle: CSSProperties = {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.5,
    color: "rgba(255,255,255,0.76)",
  };

  const modalInputStyle: CSSProperties = {
    width: "100%",
    height: 42,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    color: "#fff",
    padding: "0 12px",
    outline: "none",
    fontSize: 13,
    fontFamily: fontStack,
    boxSizing: "border-box",
  };

  const secondaryButtonStyle: CSSProperties = {
    minHeight: 30,
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.86)",
    fontSize: 11.5,
    fontWeight: 500,
    fontFamily: fontStack,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  const primaryButtonStyle: CSSProperties = {
    ...secondaryButtonStyle,
    background: "#fff",
    color: "#000",
    border: "1px solid rgba(255,255,255,0.12)",
  };

  return (
    <div style={wrapStyle}>
      <section style={cardStyle}>
        <div style={topRow}>
          <div style={titleBlock}>
            <h2 style={titleStyle}>Integrantes del grupo</h2>
            <p style={subtitleStyle}>
              Busca, filtra y consulta los miembros del grupo.
            </p>
          </div>

          {isOwner && (
            <div style={visibilityRow}>
              <div style={switchTextWrap}>
                <div style={switchTitleStyle}>Permitir lista visible</div>
                <div style={switchSubtitleStyle}>Acceso para miembros</div>
              </div>

              <button
                type="button"
                aria-pressed={safeCanMembersViewList}
                aria-label="Permitir que los miembros vean esta lista"
                onClick={() =>
                  handleToggleMembersVisibility(!safeCanMembersViewList)
                }
                disabled={savingVisibility}
                style={switchButtonStyle}
              >
                <span style={switchThumbStyle} />
              </button>
            </div>
          )}
        </div>

        <div style={controlsRow}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre o username"
            style={inputStyle}
          />

          {canUseFilters && (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterValue)}
              style={selectStyle}
            >
              <option value="all" style={{ background: "#141414", color: "#fff" }}>
                Todos
              </option>
              <option value="active" style={{ background: "#141414", color: "#fff" }}>
                Activos
              </option>
              <option value="muted" style={{ background: "#141414", color: "#fff" }}>
                Muteados
              </option>
              <option value="banned" style={{ background: "#141414", color: "#fff" }}>
                Baneados
              </option>
              <option value="removed" style={{ background: "#141414", color: "#fff" }}>
                Expulsados
              </option>
              <option value="mod" style={{ background: "#141414", color: "#fff" }}>
                Moderadores
              </option>
              <option value="member" style={{ background: "#141414", color: "#fff" }}>
                Miembros
              </option>
            </select>
          )}
        </div>

        {isOwner && (
          <p style={helperText}>
            Cuando esta opción está desactivada, solo tú podrás ver la lista de integrantes.
          </p>
        )}

        {actionMessage && <div style={actionNoticeStyle}>{actionMessage}</div>}

        {!canViewList && !isOwner && (
          <div style={emptyStyle}>
            El owner de esta comunidad no permite que otros miembros vean la lista de integrantes.
          </div>
        )}

        {canViewList && loading && <div style={emptyStyle}>Cargando integrantes...</div>}
        {canViewList && !loading && error && <div style={emptyStyle}>{error}</div>}

        {canViewList && !loading && !error && filteredMembers.length === 0 && (
          <div style={emptyStyle}>No encontramos integrantes con ese criterio.</div>
        )}

        {canViewList && !loading && !error && filteredMembers.length > 0 && (
          <div style={listStyle}>
            {filteredMembers.map((member) => {
              const displayName = memberPrimaryName(member);
              const statusText = friendlyStatus(member.status, member.mutedUntil);
              const roleText = friendlyRole(member.roleInGroup || member.role);
              const dotColor = statusDotColor(member.status, member.mutedUntil);
              const canModerate = canModerateMember(member);
              const menuOpen = openMenuForUid === member.resolvedUid;
              const isProcessing = actionLoadingForUid === member.resolvedUid;
              const actions = getAvailableActions(member);

              return (
                <div key={member.id} style={rowStyle}>
                  <div style={avatarStyle}>
                    {member.photoURL ? (
                      <img
                        src={member.photoURL}
                        alt={displayName}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <span>{memberInitials(member)}</span>
                    )}
                  </div>

                  <div style={centerColStyle}>
                    {member.handle ? (
                      <Link
                        href={`/u/${member.handle}`}
                        style={nameLinkStyle}
                        title={`Ir al perfil de ${displayName}`}
                      >
                        {displayName}
                      </Link>
                    ) : (
                      <div style={namePlainStyle}>{displayName}</div>
                    )}

                    {canSeeStatus && isMobile && (
                      <div style={mobileMetaRowStyle}>
                        <div style={statusWrap}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: dotColor,
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          <span>{statusText}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={desktopRightMetaWrap}>
                    {canSeeStatus && !isMobile && (
                      <>
                        <div style={dividerStyle} />
                        <div style={statusWrap}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: dotColor,
                              display: "inline-block",
                              flexShrink: 0,
                            }}
                          />
                          <span>{statusText}</span>
                        </div>
                      </>
                    )}

                    <div style={roleBadge}>{roleText}</div>

                    {canModerate && actions.length > 0 && (
                      <div style={{ position: "relative", overflow: "visible" }}>
                        <button
                          ref={(el) => {
                            menuButtonRefs.current[member.resolvedUid] = el;
                          }}
                          type="button"
                          onClick={() =>
                            setOpenMenuForUid((prev) =>
                              prev === member.resolvedUid ? null : member.resolvedUid
                            )
                          }
                          aria-haspopup="menu"
                          aria-expanded={menuOpen}
                          aria-label={`Abrir acciones para ${displayName}`}
                          disabled={isProcessing}
                          style={{
                            ...menuButtonStyle,
                            opacity: isProcessing ? 0.65 : 1,
                            cursor: isProcessing ? "not-allowed" : "pointer",
                          }}
                        >
                          ⋮
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {openMenuForUid &&
        menuPosition &&
        typeof document !== "undefined" &&
        (() => {
          const member = filteredMembers.find(
            (item) => item.resolvedUid === openMenuForUid
          );
          if (!member) return null;

          const isProcessing = actionLoadingForUid === member.resolvedUid;
          const actions = getAvailableActions(member);

          return createPortal(
            <div
              ref={menuPanelRef}
              style={{
                ...menuPanelStyle,
                top: menuPosition.top,
                left: menuPosition.left,
              }}
              role="menu"
            >
              {actions.map((action) => {
                const isDanger = action === "ban" || action === "remove";

                return (
                  <button
                    key={action}
                    type="button"
                    role="menuitem"
                    disabled={isProcessing}
                    onClick={() => handleModerationAction(member, action)}
                    style={
                      isProcessing
                        ? disabledMenuItemStyle
                        : isDanger
                        ? dangerMenuItemStyle
                        : menuItemStyle
                    }
                  >
                    {isProcessing ? "Procesando..." : buildActionLabel(action)}
                  </button>
                );
              })}
            </div>,
            document.body
          );
        })()}

      {muteModalOpen &&
        muteTarget &&
        typeof document !== "undefined" &&
        createPortal(
          <div style={modalBackdropStyle} onClick={closeMuteModal}>
            <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
              <h3 style={modalTitleStyle}>Mutear integrante</h3>
              <p style={modalTextStyle}>
                Elige durante cuántos días quieres mutear a{" "}
                <strong>{memberPrimaryName(muteTarget)}</strong>.
              </p>

              <input
                type="number"
                min={1}
                max={365}
                value={muteDays}
                onChange={(e) => setMuteDays(e.target.value)}
                style={modalInputStyle}
                placeholder="Ej. 7"
                disabled={actionLoadingForUid === muteTarget.resolvedUid}
              />

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <button
                  type="button"
                  onClick={closeMuteModal}
                  disabled={actionLoadingForUid === muteTarget.resolvedUid}
                  style={
                    actionLoadingForUid === muteTarget.resolvedUid
                      ? disabledMenuItemStyle
                      : secondaryButtonStyle
                  }
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleConfirmMute}
                  disabled={
                    actionLoadingForUid === muteTarget.resolvedUid ||
                    !Number.isInteger(Number(muteDays)) ||
                    Number(muteDays) < 1 ||
                    Number(muteDays) > 365
                  }
                  style={
                    actionLoadingForUid === muteTarget.resolvedUid ||
                    !Number.isInteger(Number(muteDays)) ||
                    Number(muteDays) < 1 ||
                    Number(muteDays) > 365
                      ? disabledMenuItemStyle
                      : primaryButtonStyle
                  }
                >
                  {actionLoadingForUid === muteTarget.resolvedUid
                    ? "Aplicando..."
                    : "Aplicar mute"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}