"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
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
  type Timestamp,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  banGroupMember,
  demoteGroupAdminToMember,
  muteGroupMember,
  promoteGroupMemberToAdmin,
  removeGroupMember,
  unbanGroupMember,
  unmuteGroupMember,
} from "../../../../../lib/groups/groupModeration";
import GroupJoinRequestsSection from "./GroupJoinRequestsSection";
import GroupModeratorInvitePanel from "./GroupModeratorInvitePanel";
// Switch canónico compartido con la configuración de servicios (perfil ⇄ comunidad).
import { Switch } from "@/components/services/config/serviceConfigKit";
// Mismos componentes que la página de búsqueda: campo con lupa morada y menú de filtro.
import { VibraNavigationIcon } from "@/app/components/VibraServiceIcons/VibraNavigationIcons";
import { WalletFilterMenu } from "@/app/(protected)/wallet/components/WalletUi";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import {
  membersMemoryCache,
  getMutedUntilDate, memberInitials, memberPrimaryName, normalizeRole,
  resolveEffectiveStatus, statusDotColor,
  type EnrichedMember, type FilterValue, type GroupMembersTabProps,
  type MemberAction, type MemberDoc,
} from "./GroupMembersTab.parts";

export default function GroupMembersTab({
  groupId,
  isOwner,
  isModerator = false,
  canMembersViewList,
  initialShowRequests = false,
  canReceiveJoinRequests = false,
  canInviteModerators = false,
  initialShowModeratorPanel = false,
}: GroupMembersTabProps) {
  const currentUid = auth.currentUser?.uid ?? null;
  const tGroups = useTranslations("groups");
  const tCommon = useTranslations("common");

  function localizedRole(role?: string): string {
    const normalized = normalizeRole(role);
    if (normalized === "owner") return tGroups("roleOwner");
    if (normalized === "mod") return tGroups("roleMod");
    return tGroups("roleMember");
  }

  function localizedStatus(status?: string, mutedUntil?: unknown): string {
    const normalized = resolveEffectiveStatus(status, mutedUntil);
    if (normalized === "muted") {
      const until = getMutedUntilDate(mutedUntil);
      if (until) {
        const diffMs = until.getTime() - Date.now();
        if (diffMs > 0) {
          const days = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
          const remaining = tGroups("muteRemainingDays", { count: days });
          return tGroups("statusMutedWith", { remaining });
        }
      }
      return tGroups("statusMuted");
    }
    if (normalized === "subscribed") return tGroups("statusSubscribed");
    if (normalized === "banned") return tGroups("statusBanned");
    if (normalized === "removed") return tGroups("statusRemoved");
    return tGroups("statusActive");
  }

  function localizedActionLabel(action: MemberAction): string {
    if (action === "promote_to_mod") return tGroups("actionPromoteToMod");
    if (action === "demote_to_member") return tGroups("actionDemoteToMember");
    if (action === "mute") return tGroups("mute");
    if (action === "unmute") return tGroups("unmute");
    if (action === "ban") return tGroups("ban");
    if (action === "unban") return tGroups("unban");
    return tGroups("actionRemoveFull");
  }

  function localizedMemberName(member: EnrichedMember): string {
    return member.displayName?.trim() || member.handle?.trim() || tGroups("memberNoName");
  }

  const [members, setMembers] = useState<EnrichedMember[]>(
    () => membersMemoryCache.get(groupId) ?? []
  );
  const [loading, setLoading] = useState(() => !membersMemoryCache.has(groupId));
  const [error, setError] = useState<string | null>(null);
  const { toast: membersToast, showToast: showMembersToast } = useVibraToast();
  useEffect(() => { if (error) showMembersToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterValue>("all");
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [openMenuForUid, setOpenMenuForUid] = useState<string | null>(null);
  const [actionLoadingForUid, setActionLoadingForUid] = useState<string | null>(
    null
  );
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [moderatorPanelOpen, setModeratorPanelOpen] = useState(
    initialShowModeratorPanel
  );
  const [muteModalOpen, setMuteModalOpen] = useState(false);
  const [muteTarget, setMuteTarget] = useState<EnrichedMember | null>(null);
  const [muteDays, setMuteDays] = useState("7");

  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const menuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const fontStack =
    'inherit';

  const safeCanMembersViewList = canMembersViewList === true;
  const canUseFilters = isOwner || isModerator;
  const canSeeStatus = true;
  const canViewList = isOwner || isModerator || safeCanMembersViewList;

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // El menú de acciones es un panel CENTRADO (mismo patrón que los 3 puntos de
  // una publicación), así que ya no hay que calcular su posición junto al botón.
  // El fondo queda bloqueado mientras está abierto — también con el modal de mute.
  useBodyScrollLock(openMenuForUid !== null || muteModalOpen);

  useEffect(() => {
    if (!openMenuForUid && !muteModalOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenuForUid(null);
        setMuteModalOpen(false);
        setMuteTarget(null);
        setMuteDays("7");
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [openMenuForUid, muteModalOpen]);

  useEffect(() => {
    if (!canViewList) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }

    // Con cache disponible mostramos los datos guardados sin spinner; el
    // onSnapshot refresca en segundo plano.
    if (!membersMemoryCache.has(groupId)) {
      setLoading(true);
    }
    setError(null);

    const membersRef = collection(db, "groups", groupId, "members");

    const unsub = onSnapshot(
      membersRef,
      async (snap) => {
        try {
          const rawMembers = snap.docs.map((d) => {
            const data = d.data() as Omit<MemberDoc, "id">;
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
                  const userData = userSnap.data() as { firstName?: string; lastName?: string; displayName?: string; handle?: string; photoURL?: string };
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

          membersMemoryCache.set(groupId, enriched);
          setMembers(enriched);
          setLoading(false);
        } catch (e: unknown) {
          console.error(e);
          setError((e instanceof Error ? e.message : null) ?? tGroups("membersLoadError"));
          setLoading(false);
        }
      },
      (e) => {
        console.error(e);
        setError(e?.message ?? tGroups("membersLoadError"));
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
              filter === "subscribed" ||
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
          return normalized === "mod" ? 0 : 1;
        };

        const statusWeight = (status?: string, mutedUntil?: unknown) => {
          const normalized = resolveEffectiveStatus(status, mutedUntil);
          if (normalized === "active") return 0;
          if (normalized === "muted") return 1;
          if (normalized === "banned") return 2;
          return 3;
        };

        const awRole = roleWeight(a.roleInGroup || a.role);
        const bwRole = roleWeight(b.roleInGroup || b.role);

        if (awRole !== bwRole) return awRole - bwRole;

        const awStatus = statusWeight(a.status, a.mutedUntil);
        const bwStatus = statusWeight(b.status, b.mutedUntil);

        if (awStatus !== bwStatus) return awStatus - bwStatus;

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
    } catch (e: unknown) {
      console.error(e);
      setError(
        (e instanceof Error ? e.message : null) ?? tGroups("visibilityUpdateError")
      );
    } finally {
      setSavingVisibility(false);
    }
  }

  function canManageMember(member: EnrichedMember) {
    if (!member.resolvedUid) return false;
    if (member.resolvedUid === currentUid) return false;

    const role = normalizeRole(member.roleInGroup || member.role);

    if (role === "owner") return false;

    if (isOwner) {
      return true;
    }

    if (isModerator) {
      return role === "member";
    }

    return false;
  }

  function getAvailableActions(member: EnrichedMember): MemberAction[] {
    const actions: MemberAction[] = [];
    const status = resolveEffectiveStatus(member.status, member.mutedUntil);
    const role = normalizeRole(member.roleInGroup || member.role);

    if (isOwner) {
      if (
        role === "member" &&
        (status === "active" || status === "subscribed")
      ) {
        actions.push("promote_to_mod");
      }

      if (role === "mod") {
        actions.push("demote_to_member");
      }
    }

    if (status === "banned") {
      actions.push("unban");
      return actions;
    }

    if (status === "removed") {
      return actions;
    }

    if (status === "muted") {
      actions.push("unmute", "ban", "remove");
      return actions;
    }

    actions.push("mute", "ban", "remove");
    return actions;
  }
  async function runAction(
    member: EnrichedMember,
    action: Exclude<MemberAction, "mute">
  ) {
    const targetUserId = member.resolvedUid;
    if (!targetUserId) return;

    setError(null);
    setActionMessage(null);
    setActionLoadingForUid(targetUserId);

    try {
      if (action === "promote_to_mod") {
        await promoteGroupMemberToAdmin(groupId, targetUserId);
      } else if (action === "demote_to_member") {
        await demoteGroupAdminToMember(groupId, targetUserId);
      } else if (action === "unmute") {
        await unmuteGroupMember(groupId, targetUserId);
      } else if (action === "ban") {
        await banGroupMember(groupId, targetUserId);
      } else if (action === "unban") {
        await unbanGroupMember(groupId, targetUserId);
      } else if (action === "remove") {
        await removeGroupMember(groupId, targetUserId);
      }

      const displayName = localizedMemberName(member);
      setActionMessage(tGroups("actionApplied", { action: localizedActionLabel(action), name: displayName }));
      setOpenMenuForUid(null);
    } catch (e: unknown) {
      console.error(e);
      setError((e instanceof Error ? e.message : null) ?? tGroups("actionCompletionError"));
    } finally {
      setActionLoadingForUid(null);
    }
  }

  function handleMemberAction(member: EnrichedMember, action: MemberAction) {
    if (action === "mute") {
      setError(null);
      setActionMessage(null);
      setMuteTarget(member);
      setMuteDays("7");
      setMuteModalOpen(true);
      setOpenMenuForUid(null);
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
        tGroups("muteApplied", { name: localizedMemberName(muteTarget), days: durationDays })
      );
      closeMuteModal();
    } catch (e: unknown) {
      console.error(e);
      setError((e instanceof Error ? e.message : null) ?? tGroups("actionCompletionError"));
    } finally {
      setActionLoadingForUid(null);
    }
  }

  const wrapStyle: CSSProperties = {
    display: "grid",
    gap: 12,
    fontFamily: fontStack,
  };

  // Limpieza de UI: el feed de integrantes ya no vive dentro de una tarjeta.
  // Sin borde, sin relleno de color y sin blur — el contenido respira directo
  // sobre el fondo de la comunidad.
  const cardStyle: CSSProperties = {
    padding: 0,
    color: "#fff",
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
    justifyContent: "space-between",
    gap: 12,
    minWidth: 0,
    marginTop: 12,
  };

  // Opciones del filtro con el mismo componente que usa /search.
  const filterLabels: Record<FilterValue, string> = {
    all: tGroups("filterAll"),
    active: tGroups("filterActive"),
    subscribed: tGroups("filterSubscribed"),
    muted: tGroups("filterMuted"),
    banned: tGroups("filterBanned"),
    removed: tGroups("filterRemoved"),
    mod: tGroups("filterMods"),
    member: tGroups("filterMembers"),
  };

  const filterOptions = (
    ["all", "active", "subscribed", "muted", "banned", "removed", "mod", "member"] as FilterValue[]
  ).map((value) => ({ value, label: filterLabels[value] }));

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

  // La descripción ahora explica los dos estados, así que necesita leerse:
  // mismo tamaño que el resto de textos secundarios de la pestaña.
  const switchSubtitleStyle: CSSProperties = {
    fontSize: isMobile ? 10.5 : 11.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.58)",
    marginTop: 2,
  };

  // Misma fila que en la página de búsqueda: campo elástico + menú de filtro.
  const controlsRow: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  };

  // Campo de búsqueda idéntico al de /search: relleno tenue, radio 12, sin borde,
  // con la lupa morada dentro al final.
  const searchFieldStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: "8px 10px 8px 12px",
    boxSizing: "border-box",
  };

  const inputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    border: "none",
    background: "transparent",
    outline: "none",
    color: "#fff",
    fontSize: 13,
    fontFamily: fontStack,
    lineHeight: 1.5,
    WebkitAppearance: "none",
    appearance: "none",
  };

  const listStyle: CSSProperties = {
    display: "grid",
    gap: 8,
    marginTop: 14,
    overflow: "visible",
  };

  // Botón de acciones: 3 puntos verticales, mismo tratamiento que en un post.
  const leftMenuButtonStyle: CSSProperties = {
    width: isMobile ? 28 : 32,
    height: isMobile ? 28 : 32,
    borderRadius: 0,
    border: "none",
    background: "transparent",
    color: "rgba(255,255,255,0.84)",
    display: "grid",
    placeItems: "center",
    padding: 0,
    cursor: "pointer",
    flexShrink: 0,
    fontSize: 18,
    lineHeight: 1,
    WebkitTapHighlightColor: "transparent",
  };

  // Avatar sin aro. Conserva un relleno tenue porque es el fondo de las
  // iniciales cuando la persona no tiene foto.
  const avatarStyle: CSSProperties = {
    width: isMobile ? 34 : 42,
    height: isMobile ? 34 : 42,
    borderRadius: "50%",
    overflow: "hidden",
    display: "grid",
    placeItems: "center",
    background: "rgba(255,255,255,0.06)",
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

  // @usuario bajo el nombre: mismo tratamiento tenue que en el buscador de
  // moderadores y en las tarjetas de perfil.
  const handleStyle: CSSProperties = {
    fontSize: isMobile ? 10.5 : 11.5,
    lineHeight: 1.2,
    color: "rgba(255,255,255,0.5)",
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
    flexWrap: "wrap",
  };

  // En laptop el estado ocupa un ANCHO FIJO. El texto varía mucho de largo
  // ("Activo" vs "Muteado, restan 12 días") y, al ir todo alineado a la derecha,
  // eso movía la línea vertical de fila en fila. Con ancho fijo, la línea cae
  // siempre en el mismo punto y la columna se lee limpia.
  const STATUS_COLUMN_WIDTH = 168;

  const statusWrap: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: isMobile ? 5 : 7,
    fontSize: isMobile ? 9.5 : 11.5,
    color: "rgba(255,255,255,0.68)",
    lineHeight: 1,
    whiteSpace: "nowrap",
    minWidth: 0,
    ...(isMobile ? {} : { width: STATUS_COLUMN_WIDTH, flexShrink: 0 }),
  };

  // El texto del estado se recorta si no cabe, en vez de empujar la línea.
  const statusTextStyle: CSSProperties = {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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

  // El rol es texto, no una píldora.
  const roleBadge: CSSProperties = {
    minWidth: isMobile ? 86 : 104,
    textAlign: "right",
    padding: 0,
    fontSize: isMobile ? 9.5 : 11.5,
    fontWeight: 500,
    color: "rgba(255,255,255,0.68)",
    whiteSpace: "nowrap",
    lineHeight: 1.1,
  };

  // Mismo ítem que el menú de 3 puntos de una publicación: texto centrado.
  const menuItemStyle: CSSProperties = {
    width: "100%",
    minHeight: 36,
    padding: "8px 10px",
    borderRadius: 0,
    border: "none",
    background: "transparent",
    color: "#fff",
    fontSize: 12,
    fontWeight: 500,
    fontFamily: fontStack,
    textAlign: "center",
    cursor: "pointer",
  };

  const disabledMenuItemStyle: CSSProperties = {
    ...menuItemStyle,
    color: "rgba(255,255,255,0.38)",
    cursor: "not-allowed",
  };

  // Mensajes (vacío / resultado de una acción): texto suelto, sin caja.
  const emptyStyle: CSSProperties = {
    marginTop: 14,
    padding: 0,
    fontSize: isMobile ? 10.5 : 11.5,
    lineHeight: 1.35,
    color: "rgba(255,255,255,0.72)",
  };

  const actionNoticeStyle: CSSProperties = {
    marginTop: 12,
    padding: 0,
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

  /**
   * Carga de la lista: skeletons con el relleno y la onda canónicos de
   * vibra_style.md, calcados a la geometría de la fila real (mismo alto de
   * avatar, mismas columnas) para que al llegar los datos nada salte.
   */
  function renderMembersSkeleton() {
    const avatarSize = isMobile ? 34 : 42;
    const showMenuColumn = isOwner || isModerator;

    return (
      <div style={{ ...listStyle }} aria-hidden="true">
        <style>{`
          .vbMembersSkel {
            background-color: rgba(255,255,255,0.08);
            background-image: linear-gradient(
              100deg,
              rgba(255,255,255,0.05) 30%,
              rgba(255,255,255,0.11) 50%,
              rgba(255,255,255,0.05) 70%
            );
            background-size: 300% 100%;
            animation: vbSkelWave 1.6s ease-in-out infinite;
          }
          @keyframes vbSkelWave {
            0%   { background-position: 180% 0; }
            100% { background-position: -80% 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .vbMembersSkel {
              animation: none;
              background: rgba(255,255,255,0.07);
            }
          }
        `}</style>

        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            style={{
              display: "grid",
              gridTemplateColumns: showMenuColumn
                ? `${isMobile ? 28 : 32}px ${avatarSize}px minmax(0, 1fr) auto`
                : `${avatarSize}px minmax(0, 1fr) auto`,
              gap: isMobile ? 8 : 12,
              alignItems: "center",
              padding: isMobile ? "6px 0" : "8px 0",
            }}
          >
            {showMenuColumn && <span />}

            <span
              className="vbMembersSkel"
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: "50%",
                flexShrink: 0,
              }}
            />

            <span style={{ display: "grid", gap: isMobile ? 5 : 6, minWidth: 0 }}>
              {/* Nombre */}
              <span
                className="vbMembersSkel"
                style={{ height: isMobile ? 10 : 11, borderRadius: 6, width: "46%" }}
              />
              {/* @usuario */}
              <span
                className="vbMembersSkel"
                style={{ height: isMobile ? 9 : 10, borderRadius: 6, width: "30%" }}
              />
              {/* Estado + rol (en celular van bajo el nombre) */}
              {isMobile && (
                <span
                  className="vbMembersSkel"
                  style={{ height: 9, borderRadius: 6, width: "62%" }}
                />
              )}
            </span>

            {!isMobile && (
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  className="vbMembersSkel"
                  style={{ height: 11, borderRadius: 6, width: STATUS_COLUMN_WIDTH }}
                />
                <span
                  className="vbMembersSkel"
                  style={{ height: 11, borderRadius: 6, width: 104 }}
                />
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <section style={cardStyle}>
        <div style={topRow}>
          <div style={titleBlock}>
            <h2 style={titleStyle}>Integrantes de la comunidad</h2>
            <p style={subtitleStyle}>
              Busca, filtra y administra los miembros del comunidad.
            </p>
          </div>

        </div>

        <div style={controlsRow}>
          <div style={searchFieldStyle}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tGroups("searchMembersPlaceholder")}
              aria-label={tGroups("searchMembersPlaceholder")}
              style={inputStyle}
            />
            {/* La lista filtra al teclear: la lupa es indicativa, no un botón. */}
            <span
              aria-hidden="true"
              style={{ flexShrink: 0, display: "grid", placeItems: "center" }}
            >
              <VibraNavigationIcon type="search" size={20} strokeWidth={2.2} />
            </span>
          </div>

          {canUseFilters && (
            <WalletFilterMenu
              label={filterLabels[filter]}
              menuLabel={tGroups("filterAll")}
              value={[filter]}
              options={filterOptions}
              onChange={(next) => setFilter((next[0] ?? "all") as FilterValue)}
              allValue="all"
              singleSelect
            />
          )}
        </div>

        {/* El control de visibilidad de la lista vive bajo el buscador: es una
            preferencia de la comunidad, no parte del encabezado. */}
        {isOwner && (
          <div style={visibilityRow}>
            <div style={switchTextWrap}>
              <div style={switchTitleStyle}>
                {tGroups("allowMembersViewListTitle")}
              </div>
              <div style={switchSubtitleStyle}>
                {tGroups("allowMembersViewListDescription")}
              </div>

              {/* Permite nombrar moderador a alguien que NO es integrante: en una
                  comunidad de suscripción, exigirle pagar para poder moderar no
                  tiene sentido. Nunca en comunidades ocultas. */}
              {canInviteModerators && (
              <button
                type="button"
                onClick={() => setModeratorPanelOpen(true)}
                style={{
                  marginTop: 8,
                  justifySelf: "start",
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  color: "#a855f7",
                  fontSize: isMobile ? 12 : 13,
                  fontWeight: 600,
                  fontFamily: fontStack,
                  lineHeight: 1.35,
                  cursor: "pointer",
                }}
              >
                {tGroups("inviteModeratorCta")}
              </button>
              )}
            </div>

            {/* Switch canónico compartido (mismo de la config de servicios),
                en el morado de marca. */}
            <Switch
              checked={safeCanMembersViewList}
              disabled={savingVisibility}
              onChange={(next) => handleToggleMembersVisibility(next)}
              activeColor="#a855f7"
              label={tGroups("allowMembersViewListLabel")}
            />
          </div>
        )}

        {(isOwner || isModerator) && (
          <GroupJoinRequestsSection
            groupId={groupId}
            canManage={isOwner || isModerator}
            enabled={canReceiveJoinRequests}
            defaultOpen={initialShowRequests}
          />
        )}

        {actionMessage && <div style={actionNoticeStyle}>{actionMessage}</div>}

        {!canViewList && !isOwner && !isModerator && (
          <div style={emptyStyle}>
            {tGroups("membersListHidden")}
          </div>
        )}

        {canViewList && loading && renderMembersSkeleton()}
        <VibraToast toast={membersToast} />

        {canViewList && !loading && !error && filteredMembers.length === 0 && (
          <div style={emptyStyle}>{tGroups("noMembersFound")}</div>
        )}

        {canViewList && !loading && !error && filteredMembers.length > 0 && (
          <div style={listStyle}>
            {filteredMembers.map((member) => {
              const displayName = localizedMemberName(member);
              const statusText = localizedStatus(member.status, member.mutedUntil);
              const roleText = localizedRole(member.roleInGroup || member.role);
              const dotColor = statusDotColor(member.status, member.mutedUntil);
              const canManage = canManageMember(member);
              const menuOpen = openMenuForUid === member.resolvedUid;
              const isProcessing = actionLoadingForUid === member.resolvedUid;
              const actions = getAvailableActions(member);

              // Fila plana: sin tarjeta propia (ni borde ni fondo). Solo el
              // ritmo vertical separa a un integrante del siguiente.
              const rowStyle: CSSProperties = {
                display: "grid",
                gridTemplateColumns: canManage && actions.length > 0
                  ? isMobile
                    ? "auto 34px minmax(0, 1fr) auto"
                    : "auto 42px minmax(0, 1fr) auto"
                  : isMobile
                    ? "34px minmax(0, 1fr) auto"
                    : "42px minmax(0, 1fr) auto",
                gap: isMobile ? 8 : 12,
                alignItems: "center",
                padding: isMobile ? "6px 0" : "8px 0",
                overflow: "visible",
              };

              return (
                <div key={member.id} style={rowStyle}>
                  {canManage && actions.length > 0 && (
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
                        ...leftMenuButtonStyle,
                        opacity: isProcessing ? 0.65 : 1,
                        cursor: isProcessing ? "not-allowed" : "pointer",
                      }}
                    >
                      ⋮
                    </button>
                  )}

                  <div style={avatarStyle}>
                    {member.photoURL ? (
                      <Image
                        src={member.photoURL}
                        alt={displayName}
                        width={isMobile ? 34 : 42}
                        height={isMobile ? 34 : 42}
                        style={{ objectFit: "cover" }}
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

                    {member.handle ? (
                      <div style={handleStyle}>@{member.handle}</div>
                    ) : null}

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

                        <div style={roleBadge}>{roleText}</div>
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
                          <span style={statusTextStyle}>{statusText}</span>
                        </div>
                      </>
                    )}

                    {!isMobile && <div style={roleBadge}>{roleText}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <GroupModeratorInvitePanel
        open={moderatorPanelOpen}
        onClose={() => setModeratorPanelOpen(false)}
        groupId={groupId}
        currentUserId={currentUid}
      />

      {openMenuForUid &&
        typeof document !== "undefined" &&
        (() => {
          const member = filteredMembers.find(
            (item) => item.resolvedUid === openMenuForUid
          );
          if (!member) return null;

          const isProcessing = actionLoadingForUid === member.resolvedUid;
          const actions = getAvailableActions(member);

          return createPortal(
            <>
              <style>{`
                @keyframes vbMembersMenuFadeIn {
                  from { opacity: 0; }
                  to   { opacity: 1; }
                }
                @keyframes vbMembersMenuScaleIn {
                  from { opacity: 0; transform: scale(0.92); }
                  to   { opacity: 1; transform: scale(1); }
                }
              `}</style>

              {/* Backdrop */}
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 99990,
                  background: "rgba(0,0,0,0.50)",
                  animation: "vbMembersMenuFadeIn 0.18s ease",
                }}
                onClick={() => setOpenMenuForUid(null)}
              />

              {/* Panel centrado — igual en celular y laptop (mismo que en un post) */}
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 99991,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div
                  ref={menuPanelRef}
                  role="menu"
                  style={{
                    pointerEvents: "auto",
                    width: "min(280px, 88vw)",
                    background: "rgba(8,9,11,0.985)",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    padding: 0,
                    display: "grid",
                    gap: 0,
                    overflow: "hidden",
                    boxShadow:
                      "0 30px 90px rgba(0,0,0,0.56), 0 0 0 1px rgba(255,255,255,0.035)",
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                    animation: "vbMembersMenuScaleIn 0.18s ease",
                  }}
                >
                  {actions.map((action, index) => {
                    const isDanger =
                      action === "ban" ||
                      action === "remove" ||
                      action === "demote_to_member";

                    return (
                      <button
                        key={action}
                        type="button"
                        role="menuitem"
                        disabled={isProcessing}
                        onClick={() => handleMemberAction(member, action)}
                        style={{
                          ...menuItemStyle,
                          minHeight: 46,
                          fontSize: 14,
                          padding: "11px 16px",
                          borderTop: index > 0 ? "1px solid rgba(255,255,255,0.08)" : "none",
                          ...(isProcessing
                            ? { color: "rgba(255,255,255,0.35)", cursor: "not-allowed" }
                            : isDanger
                              ? { color: "#ff8a8a" }
                              : {}),
                        }}
                      >
                        {isProcessing ? tGroups("processing") : localizedActionLabel(action)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>,
            document.body
          );
        })()}

      {muteModalOpen &&
        muteTarget &&
        typeof document !== "undefined" &&
        createPortal(
          <div style={modalBackdropStyle} onClick={closeMuteModal}>
            <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
              <h3 style={modalTitleStyle}>{tGroups("muteModalTitle")}</h3>
              <p style={modalTextStyle}>
                {tGroups("muteModalText", { name: localizedMemberName(muteTarget) })}
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
                  {tCommon("cancel")}
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
                    ? tGroups("muteModalApplying")
                    : tGroups("muteModalApply")}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}