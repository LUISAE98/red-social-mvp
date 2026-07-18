"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { leaveGroup } from "@/lib/groups/membership";
import { useTranslations } from "next-intl";
import { usePriceFormat, type PriceFormatter } from "@/lib/currency/usePriceFormat";
import type { DisplayCurrency } from "@/lib/currency/catalog";
import type { Timestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

import type {
  GroupDocLite,
  JoinRequestRow,
  OutgoingJoinRequestRow,
  UserMini,
} from "./OwnerSidebar";
import { dismissHiddenGroupTransition } from "@/lib/groups/sidebarGroups";
import { Chevron, CountBadge } from "./OwnerSidebar";

type Props = {
  currentUserId: string | null;
  loadingCommunities: boolean;
  joinedGroups: GroupDocLite[];
  pendingJoinRequestsSent: OutgoingJoinRequestRow[];
  browseGroups: GroupDocLite[];
  joinedGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  subscriptionPendingGroups: GroupDocLite[];
  browseGrouped: Array<{ key: string; title: string; items: GroupDocLite[] }>;
  groupMetaMap: Record<string, GroupDocLite>;
  styles: Record<string, React.CSSProperties>;
  fmtDate: (ts?: Timestamp | null) => string;
  renderCommunityCard: (
    g: GroupDocLite,
    opts?: { compact?: boolean; subtitle?: React.ReactNode }
  ) => React.ReactNode;
  joinRequestsByGroup: Record<string, JoinRequestRow[]>;
  joinSectionOpen: Record<string, boolean>;
  setJoinSectionOpen: React.Dispatch<
    React.SetStateAction<Record<string, boolean>>
  >;
  handleApproveJoin: (groupId: string, userId: string) => Promise<void>;
  handleRejectJoin: (groupId: string, userId: string) => Promise<void>;
  joinBusyKey: string | null;
  userMiniMap: Record<string, UserMini>;
  getInitials: (name?: string | null) => string;
  renderUserLink: (uid: string) => React.ReactNode;
  onCreateCommunity: () => void;
  newPostsCounts?: Record<string, number>;
};

type SidebarMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

type SidebarMemberRole = "owner" | "mod" | "member" | null;

type AccessState =
  | "joined"
  | "legacy_free"
  | "subscribed"
  | "requires_subscription"
  | "banned";

type NoticeTone = "warning" | "success" | "info" | "danger";

type PriceAwareGroup = GroupDocLite & {
  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: "MXN" | "USD" | string | null;
};

function normalizeMemberStatus(group: GroupDocLite): SidebarMemberStatus {
  const raw = group?.memberStatus ?? null;

  if (raw === "active") return "active";
  if (raw === "subscribed") return "subscribed";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";

  return null;
}

function normalizeMemberRole(group: GroupDocLite): SidebarMemberRole {
  const raw =
    typeof group?.memberRole === "string"
      ? group.memberRole.trim().toLowerCase()
      : null;

  if (raw === "owner") return "owner";
  if (raw === "mod" || raw === "moderator") return "mod";
  if (raw === "member") return "member";

  return null;
}

function isActuallyJoinedStatus(status: SidebarMemberStatus) {
  return (
    status === "active" ||
    status === "subscribed" ||
    status === "muted"
  );
}

function statusDotColor(status?: SidebarMemberStatus) {
  if (status === "subscribed") return "#38bdf8";
  if (status === "muted") return "#f5a623";
  if (status === "banned") return "#ef4444";
  if (status === "removed") return "#b91c1c";
  return "#22c55e";
}

function statusLabel(status?: SidebarMemberStatus, tg?: (key: string) => string) {
  if (status === "subscribed") return tg ? tg("statusSubscribed") : "Suscrito";
  if (status === "muted") return tg ? tg("statusMuted") : "Muteado";
  if (status === "banned") return tg ? tg("statusBanned") : "Baneado";
  if (status === "removed") return tg ? tg("statusRemoved") : "Expulsado";
  return tg ? tg("statusActive") : "Activo";
}

function roleLabel(role?: SidebarMemberRole, tg?: (key: string) => string) {
  if (role === "mod") return tg ? tg("roleMod") : "Moderador";
  if (role === "owner") return tg ? tg("roleOwner") : "Owner";
  return tg ? tg("roleMember") : "Miembro";
}

function resolveAccessState(group: GroupDocLite): AccessState {
  if (group.sidebarState === "legacy_free") return "legacy_free";
  if (group.sidebarState === "requires_subscription") {
    return "requires_subscription";
  }
  if (group.sidebarState === "banned") return "banned";

  if (
    group.membershipAccessType === "legacy_free" ||
    group.legacyComplimentary === true
  ) {
    return "legacy_free";
  }

  if (
    group.membershipAccessType === "subscription" ||
    group.membershipAccessType === "subscribed" ||
    group.memberStatus === "subscribed" ||
    group.subscriptionActive === true
  ) {
    return "subscribed";
  }

  if (group.requiresSubscription === true) {
    return "requires_subscription";
  }

  if (normalizeMemberStatus(group) === "banned") {
    return "banned";
  }

  return "joined";
}

function isJoinedLikeState(state: AccessState) {
  return (
    state === "joined" ||
    state === "legacy_free" ||
    state === "subscribed" ||
    state === "banned"
  );
}

function shouldShowGroup(group: GroupDocLite, dismissedIds: Set<string>) {
  if (group.canDismiss === true && dismissedIds.has(group.id)) {
    return false;
  }

  return true;
}

type MoneyFormatter = PriceFormatter["format"];

function getPriceIncreaseMeta(group: GroupDocLite) {
  const priceAware = group as PriceAwareGroup;

  const previous =
    typeof priceAware.previousSubscriptionPriceMonthly === "number"
      ? priceAware.previousSubscriptionPriceMonthly
      : null;

  const next =
    typeof priceAware.nextSubscriptionPriceMonthly === "number"
      ? priceAware.nextSubscriptionPriceMonthly
      : null;

  const currency =
    typeof priceAware.subscriptionPriceChangeCurrency === "string" &&
    priceAware.subscriptionPriceChangeCurrency.trim()
      ? priceAware.subscriptionPriceChangeCurrency.trim().toUpperCase()
      : group.monetization?.subscriptionCurrency ||
        group.monetization?.currency ||
        "MXN";

  return {
    previous,
    next,
    currency,
  };
}

function buildJoinedSubtitle(
  group: GroupDocLite,
  isMobile: boolean,
  newCount?: number,
  tg?: (key: string) => string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tc?: (key: string, values?: any) => string
): React.ReactNode {
  const status = normalizeMemberStatus(group);
  const role = normalizeMemberRole(group);
  const statusText = statusLabel(status, tg);
  const dotColor = statusDotColor(status);
  const accessState = resolveAccessState(group);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: isMobile ? 5 : 7,
        fontSize: isMobile ? 9.5 : 11.5,
        color: "rgba(255,255,255,0.68)",
        lineHeight: 1,
        whiteSpace: "nowrap",
        minWidth: 0,
        flexWrap: "wrap",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: isMobile ? 7 : 8,
          height: isMobile ? 7 : 8,
          borderRadius: "50%",
          background: dotColor,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span>{statusText}</span>

      {role === "mod" && (
        <>
          <span
            aria-hidden="true"
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span>{roleLabel(role, tg)}</span>
        </>
      )}

      {accessState === "legacy_free" && (
        <>
          <span
            aria-hidden="true"
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span style={{ color: "#86efac" }}>Acceso legado gratis</span>
        </>
      )}

{accessState === "requires_subscription" && (
        <>
          <span
            aria-hidden="true"
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span style={{ color: "#fbbf24" }}>Debes suscribirte</span>
        </>
      )}

      {(newCount ?? 0) > 0 && (
        <>
          <span
            aria-hidden="true"
            style={{ color: "rgba(255,255,255,0.34)", flexShrink: 0 }}
          >
            •
          </span>
          <span style={{ color: "#a855f7", fontWeight: 700 }}>
            {tc ? tc("newPostsCount", { count: newCount }) : `${newCount} ${newCount === 1 ? "nuevo" : "nuevos"}`}
          </span>
        </>
      )}
    </span>
  );
}

function buildAccessNotice(
  group: GroupDocLite,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tg?: (key: string, values?: Record<string, any>) => any,
  formatMoney?: MoneyFormatter
):
  | {
      title?: string;
      text: string;
      tone: NoticeTone;
      showSubscribeCta?: boolean;
      showDismissCta?: boolean;
      /** Banner puramente informativo: puede cerrarse con la ⨯ (persiste local). */
      closable?: boolean;
    }
  | null {
  const state = resolveAccessState(group);

  if (state === "requires_subscription") {
    const isFreeToSubscriptionReminder =
      group.canDismiss === true &&
      (group.transitionReason === "subscription_required_after_transition" ||
        group.transitionReason === "subscription_transition");

    const isPriceIncreaseReminder =
      group.canDismiss === true &&
      group.transitionReason ===
        "subscription_price_increase_requires_resubscribe";

    if (isPriceIncreaseReminder) {
      const { previous, next, currency } = getPriceIncreaseMeta(group);
      const fmt = (v: number) =>
        formatMoney
          ? formatMoney(v, { baseCurrency: (currency ?? "MXN") as DisplayCurrency, code: true })
          : `${v}`;

      const text =
        previous != null && next != null
          ? tg
            ? tg("bannerPriceIncreaseText", {
                prev: fmt(previous),
                next: fmt(next),
              })
            : `La suscripción pasó de ${fmt(previous)} a ${fmt(next)}. Para seguir dentro debes suscribirte con el nuevo monto.`
          : tg
          ? tg("bannerPriceIncreaseFallbackText")
          : "La suscripción aumentó de precio. Para seguir dentro debes suscribirte con el nuevo monto.";

      return {
        title: tg ? tg("bannerPriceIncreaseTitle") : "Esta comunidad aumentó su precio de suscripción",
        text,
        tone: "warning",
        showSubscribeCta: true,
        showDismissCta: false,
      };
    }

    if (isFreeToSubscriptionReminder) {
      return {
        title: tg ? tg("bannerFreeToSubscriptionTitle") : "Esta comunidad cambió a suscripción",
        text: tg ? tg("bannerFreeToSubscriptionText") : "Antes estabas dentro gratis, pero esta comunidad ahora requiere suscripción para continuar.",
        tone: "warning",
        showSubscribeCta: true,
        showDismissCta: false,
      };
    }

    return {
      title: tg ? tg("bannerAccessRequiresSubscriptionTitle") : "Acceso requiere suscripción",
      text: tg ? tg("bannerAccessRequiresSubscriptionText") : "Esta comunidad requiere suscripción. Debes suscribirte para continuar.",
      tone: "warning",
      showSubscribeCta: true,
      showDismissCta: false,
    };
  }

  if (state === "legacy_free") {
    return {
      title: tg ? tg("bannerAccessPreservedTitle") : "Acceso conservado",
      text: tg ? tg("bannerAccessPreservedText") : "Esta comunidad ahora es de suscripción, pero conservas acceso gratis porque ya estabas dentro antes del cambio.",
      tone: "success",
      showSubscribeCta: false,
      showDismissCta: false,
      closable: true,
    };
  }

  if (state === "banned") {
    return {
      title: tg ? tg("bannerAccessRestrictedTitle") : "Acceso restringido",
      text: tg ? tg("bannerAccessRestrictedText") : "No puedes interactuar normalmente en esta comunidad porque tu estado actual está restringido.",
      tone: "danger",
      showSubscribeCta: false,
      showDismissCta: false,
    };
  }

  return null;
}

function noticeStyles(
  tone: NoticeTone,
  isMobile: boolean
): React.CSSProperties {
  return {
    borderRadius: 10,
    border:
      tone === "warning"
        ? "1px solid rgba(251,191,36,0.28)"
        : tone === "success"
        ? "1px solid rgba(134,239,172,0.22)"
        : tone === "danger"
        ? "1px solid rgba(252,165,165,0.24)"
        : "1px solid rgba(147,197,253,0.22)",
    background:
      tone === "warning"
        ? "rgba(251,191,36,0.08)"
        : tone === "success"
        ? "rgba(134,239,172,0.08)"
        : tone === "danger"
        ? "rgba(252,165,165,0.08)"
        : "rgba(147,197,253,0.08)",
    padding: "8px 10px",
    fontSize: isMobile ? 10 : 11,
    lineHeight: 1.35,
    color:
      tone === "warning"
        ? "rgba(255,235,180,0.96)"
        : tone === "success"
        ? "rgba(220,255,230,0.96)"
        : tone === "danger"
        ? "rgba(255,220,220,0.96)"
        : "rgba(220,236,255,0.96)",
    display: "grid",
    gap: 6,
  };
}

function LeaveGroupActionCard(params: {
  group: GroupDocLite;
  isMobile: boolean;
  renderCommunityCard: (
    g: GroupDocLite,
    opts?: { compact?: boolean; subtitle?: React.ReactNode }
  ) => React.ReactNode;
  subtitle: React.ReactNode;
  openMenuGroupId?: string | null;
  onToggleMenu?: (groupId: string) => void;
  onLeave: (group: GroupDocLite) => void;
  leaveLabel?: string;
}) {
  const tCommon = useTranslations("common");
  const { group, renderCommunityCard, subtitle, onLeave } = params;

  const actionWidth = 150;

const [startX, setStartX] = useState<number | null>(null);
const [dragX, setDragX] = useState(0);
const [isOpen, setIsOpen] = useState(false);
const didDragRef = useRef(false);

  const currentX = isOpen ? actionWidth : dragX;

  function closeAction() {
    setIsOpen(false);
    setDragX(0);
    setStartX(null);
  }

  return (
    <div
style={{
  position: "relative",
  overflow: "hidden",
  borderRadius: 16,
  minWidth: 0,
  background: "transparent",
}}
    >
<div
  style={{
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: currentX,
    overflow: "hidden",
    borderRadius: 16,
    zIndex: 1,
    pointerEvents: currentX > 0 ? "auto" : "none",
  }}
>
  <button
    type="button"
    onClick={() => onLeave(group)}
    style={{
      width: actionWidth,
      height: "100%",
      border: "none",
      background: "linear-gradient(90deg, #ef4444 0%, #dc2626 100%)",
      color: "#fff",
      cursor: "pointer",
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: -0.1,
      display: "grid",
      placeItems: "center",
      padding: "0 14px",
    }}
  >
    {params.leaveLabel ?? tCommon("leave")}
  </button>
</div>

      <div
style={{
  position: "relative",
  zIndex: 2,
  transform: `translateX(${currentX}px)`,
  transition: startX === null ? "transform 180ms ease" : "none",
  borderRadius: 16,
  touchAction: "pan-y",
  background: "transparent",
  boxShadow: "none",
}}
onPointerDown={(event) => {
  didDragRef.current = false;
  setStartX(event.clientX);
}}
        onPointerMove={(event) => {
          if (startX === null) return;

          const deltaX = event.clientX - startX;

if (deltaX > 0) {
  if (deltaX > 6) {
    didDragRef.current = true;
  }

  setDragX(Math.min(deltaX, actionWidth));
  return;
}

          if (deltaX < -18) {
            closeAction();
          }
        }}
        onPointerUp={() => {
          if (dragX >= 58) {
            setIsOpen(true);
            setDragX(0);
          } else {
            closeAction();
          }

          setStartX(null);
        }}
       onPointerCancel={closeAction}
onClickCapture={(event) => {
  if (didDragRef.current) {
    event.preventDefault();
    event.stopPropagation();
    didDragRef.current = false;
  }
}}
      >
        {renderCommunityCard(group, { subtitle })}
      </div>
    </div>
  );
}

// Banners informativos "Acceso conservado" (legado) cerrados por el usuario.
// Persisten localmente por grupo: una vez cerrado, no vuelve a abrirse ni al
// refrescar. Es solo UI (no afecta membresía ni visibilidad del grupo).
const LEGACY_BANNER_DISMISSED_KEY = "vibra:legacy-access-banner-dismissed";

function readDismissedLegacyBanners(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LEGACY_BANNER_DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissedLegacyBanners(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LEGACY_BANNER_DISMISSED_KEY,
      JSON.stringify(Array.from(ids))
    );
  } catch {}
}

export default function OwnerSidebarOtherGroups({
  currentUserId,
  loadingCommunities,
  pendingJoinRequestsSent,
  joinedGrouped,
  groupMetaMap,
  styles,
  fmtDate,
  renderCommunityCard,
  joinRequestsByGroup,
  joinSectionOpen,
  setJoinSectionOpen,
  handleApproveJoin,
  handleRejectJoin,
  joinBusyKey,
  userMiniMap,
  getInitials,
  renderUserLink,
  onCreateCommunity,
  newPostsCounts = {},
}: Props) {
  const tCommon = useTranslations("common");
  const tGroups = useTranslations("groups");
  const tNav = useTranslations("nav");
  const { format: formatMoney } = usePriceFormat();
  const router = useRouter();
  const [dismissedGroupIds, setDismissedGroupIds] = useState<Set<string>>(
    () => new Set()
  );
  const [dismissingGroupIds, setDismissingGroupIds] = useState<Set<string>>(
    () => new Set()
  );

  // Banners "Acceso conservado" cerrados (por grupo), hidratados desde
  // localStorage tras el montaje para no romper el render del servidor.
  const [legacyBannerDismissedIds, setLegacyBannerDismissedIds] = useState<
    Set<string>
  >(() => new Set());

  useEffect(() => {
    setLegacyBannerDismissedIds(readDismissedLegacyBanners());
  }, []);

  function dismissLegacyBanner(groupId: string) {
    if (!groupId.trim()) return;
    setLegacyBannerDismissedIds((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      writeDismissedLegacyBanners(next);
      return next;
    });
  }

  const [leaveTargetGroup, setLeaveTargetGroup] = useState<GroupDocLite | null>(
  null
);
const [leavingGroupId, setLeavingGroupId] = useState<string | null>(null);

  const isMobile =
    typeof window !== "undefined" ? window.innerWidth <= 640 : false;

  function persistDismissed(next: Set<string>) {
    setDismissedGroupIds(next);
  }

  function handleSubscribe(groupId: string) {
    router.push(`/groups/${groupId}?service=suscripcion`);
  }

function openLeaveConfirm(group: GroupDocLite) {
  setLeaveTargetGroup(group);
}

function closeLeaveConfirm() {
  if (leavingGroupId) return;
  setLeaveTargetGroup(null);
}

async function handleConfirmLeaveGroup() {
  if (!leaveTargetGroup) return;
  if (!currentUserId) return;
  if (leavingGroupId) return;

  setLeavingGroupId(leaveTargetGroup.id);

  try {
    await leaveGroup(leaveTargetGroup.id, currentUserId);
    setLeaveTargetGroup(null);
  } catch (error) {
    console.error("leaveGroup error", error);
  } finally {
    setLeavingGroupId(null);
  }
}

  async function handleDismiss(groupId: string) {
    if (!groupId.trim()) return;
    if (dismissingGroupIds.has(groupId)) return;

    setDismissingGroupIds((prev) => {
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });

    try {
      await dismissHiddenGroupTransition(groupId);

      const next = new Set(dismissedGroupIds);
      next.add(groupId);
      persistDismissed(next);
    } catch (error) {
      console.error("dismissHiddenGroupTransition error", error);
    } finally {
      setDismissingGroupIds((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  }

  const visibleJoinedGrouped = useMemo(() => {
    return joinedGrouped
      .map((section) => ({
        ...section,
        items: section.items.filter((g) =>
          shouldShowGroup(g, dismissedGroupIds)
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [joinedGrouped, dismissedGroupIds]);

 const visiblePendingJoinRequestsSent: OutgoingJoinRequestRow[] =
  pendingJoinRequestsSent.filter((row: OutgoingJoinRequestRow) => {
    const community = groupMetaMap[row.groupId] ?? null;
    if (!community) {
      return true;
    }

    if (community.canDismiss === true) {
      return false;
    }

    const state = resolveAccessState(community);
    return !isJoinedLikeState(state);
  });

  const hasAnyJoined = visibleJoinedGrouped.some(
    (section) => section.items.length > 0
  );

  const hasAnyPending = visiblePendingJoinRequestsSent.length > 0;

  return (
    <>
      {visibleJoinedGrouped.map((section, sectionIndex) => (
        <div key={`joined-${section.key}`} style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionHeaderRow}>
            <div style={styles.sectionTitle}>{section.title}</div>

            {sectionIndex === 0 ? (
              <button
                type="button"
                onClick={onCreateCommunity}
                style={styles.createInlineButton}
                aria-label={tGroups("createCommunity")}
                title={tGroups("createCommunity")}
              >
                <span aria-hidden="true">+</span>
                <span>Crear</span>
              </button>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {section.items.map((g) => {
              const role = normalizeMemberRole(g);
              const isMod = role === "mod";
              const joinRequests = joinRequestsByGroup[g.id] ?? [];
              const joinListOpen = joinSectionOpen[g.id] === true;
              const accessNotice = buildAccessNotice(g, tGroups, formatMoney);
              const accessState = resolveAccessState(g);
              const memberStatus = normalizeMemberStatus(g);

              const showJoinSection =
                isMod &&
                g.visibility !== "public" &&
                joinRequests.length > 0 &&
                (accessState === "joined" ||
                  accessState === "legacy_free" ||
                  accessState === "subscribed") &&
                isActuallyJoinedStatus(memberStatus);

              if (!showJoinSection) {
                const notice = buildAccessNotice(g, tGroups, formatMoney);
return (
  <div key={g.id} style={{ display: "grid", gap: 6 }}>
<LeaveGroupActionCard
  group={g}
  isMobile={isMobile}
  renderCommunityCard={renderCommunityCard}
  subtitle={buildJoinedSubtitle(g, isMobile, newPostsCounts[g.id], tGroups, tCommon)}
  onLeave={openLeaveConfirm}
  leaveLabel={tCommon("leave")}
/>

    {notice && (
      <div style={noticeStyles(notice.tone, isMobile)}>
        {notice.title ? (
          <div style={{ fontWeight: 700 }}>
            {notice.title}
          </div>
        ) : null}

        <div>{notice.text}</div>

        {notice.showSubscribeCta && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
            <button
              type="button"
              onClick={() => handleSubscribe(g.id)}
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.16)",
                background: "#fff",
                color: "#000",
                fontSize: 12,
                fontWeight: 700,
                lineHeight: 1.1,
                cursor: "pointer",
              }}
            >
              {tGroups("subscribe")}
            </button>
          </div>
        )}
      </div>
    )}
  </div>
);
              }

              return (
                <div
                  key={g.id}
                  style={{
                    display: "grid",
                    gap: 9,
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) auto",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <LeaveGroupActionCard
                      group={g}
                      isMobile={isMobile}
                      renderCommunityCard={renderCommunityCard}
                      subtitle={buildJoinedSubtitle(g, isMobile, newPostsCounts[g.id], tGroups, tCommon)}
                      onLeave={openLeaveConfirm}
                      leaveLabel={tCommon("leave")}
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setJoinSectionOpen((prev) => ({
                          ...prev,
                          [g.id]: !prev[g.id],
                        }))
                      }
                      aria-label={
                        joinListOpen
                          ? tGroups("closeJoinRequests")
                          : tGroups("openJoinRequests")
                      }
                      style={{
                        minWidth: 52,
                        height: 28,
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.02)",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        cursor: "pointer",
                        flexShrink: 0,
                        padding: "0 8px",
                      }}
                    >
                      <CountBadge count={joinRequests.length} tone="blue" />
                      <Chevron open={joinListOpen} />
                    </button>
                  </div>

                  {accessNotice &&
                    !(
                      accessNotice.closable &&
                      legacyBannerDismissedIds.has(g.id)
                    ) && (
                    <div
                      style={{
                        ...noticeStyles(accessNotice.tone, isMobile),
                        ...(accessNotice.closable
                          ? { position: "relative", paddingRight: 34 }
                          : null),
                      }}
                    >
                      {accessNotice.closable && (
                        <button
                          type="button"
                          onClick={() => dismissLegacyBanner(g.id)}
                          aria-label={tCommon("close")}
                          title={tCommon("close")}
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 8,
                            width: 22,
                            height: 22,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            borderRadius: 6,
                            border: "none",
                            background: "rgba(255,255,255,0.08)",
                            color: "rgba(255,255,255,0.7)",
                            fontSize: 14,
                            lineHeight: 1,
                            cursor: "pointer",
                          }}
                        >
                          ✕
                        </button>
                      )}
                      {accessNotice.title ? (
                        <div style={{ fontWeight: 700 }}>
                          {accessNotice.title}
                        </div>
                      ) : null}
                      <div>{accessNotice.text}</div>

                      {(accessNotice.showSubscribeCta ||
                        accessNotice.showDismissCta) && (
                        <div
                          style={{
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginTop: 2,
                          }}
                        >
                          {accessNotice.showSubscribeCta && (
                            <button
                              type="button"
                              onClick={() => handleSubscribe(g.id)}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.16)",
                                background: "#fff",
                                color: "#000",
                                fontSize: 12,
                                fontWeight: 700,
                                lineHeight: 1.1,
                                cursor: "pointer",
                              }}
                            >
                              {tGroups("subscribe")}
                            </button>
                          )}

                          {accessNotice.showDismissCta && (
                            <button
                              type="button"
                              disabled={dismissingGroupIds.has(g.id)}
                              onClick={() => {
                                void handleDismiss(g.id);
                              }}
                              style={{
                                padding: "8px 12px",
                                borderRadius: 10,
                                border: "1px solid rgba(255,255,255,0.10)",
                                background: "rgba(255,255,255,0.05)",
                                color: "#fff",
                                fontSize: 12,
                                fontWeight: 600,
                                lineHeight: 1.1,
                                cursor: dismissingGroupIds.has(g.id)
                                  ? "not-allowed"
                                  : "pointer",
                                opacity: dismissingGroupIds.has(g.id) ? 0.7 : 1,
                              }}
                            >
                              {dismissingGroupIds.has(g.id)
                                ? tCommon("forgetting")
                                : tCommon("forget")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div
                    style={{
                      maxHeight: joinListOpen ? "800px" : "0",
                      overflow: "hidden",
                      opacity: joinListOpen ? 1 : 0,
                      transition: "max-height 360ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
                    }}
                  >
                    <div style={styles.sectionPanel}>
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
                          {tGroups("joinRequestSectionTitle")}
                        </span>
                        <CountBadge count={joinRequests.length} tone="blue" />
                      </div>

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
                                    <Image
                                      src={requester.photoURL}
                                      alt={requester.displayName}
                                      width={28} height={28}
                                      style={{
                                        borderRadius: 10,
                                        objectFit: "cover",
                                        border: "1px solid rgba(255,255,255,0.12)",
                                        flexShrink: 0,
                                      }}
                                    />
                                  ) : (
                                    <div
                                      style={{
                                        width: 28,
                                        height: 28,
                                        borderRadius: 10,
                                        background: "rgba(255,255,255,0.05)",
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
                                      {tGroups("joinRequestPending")}
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
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {busy ? tCommon("processing") : tGroups("approveButton")}
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
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {busy ? tCommon("processing") : tCommon("reject")}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {hasAnyPending && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={styles.sectionHeaderRow}>
            <div style={styles.sectionTitle}>{tGroups("joinRequestSectionTitle")}</div>

            {!hasAnyJoined ? (
              <button
                type="button"
                onClick={onCreateCommunity}
                style={styles.createInlineButton}
                aria-label={tGroups("createCommunity")}
                title={tGroups("createCommunity")}
              >
                <span aria-hidden="true">+</span>
                <span>Crear</span>
              </button>
            ) : null}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {visiblePendingJoinRequestsSent.map((row: OutgoingJoinRequestRow) => {
              const community = groupMetaMap[row.groupId] ?? null;
              if (!community) return null;

              return renderCommunityCard(community, {
                subtitle: row.createdAt
                  ? `${tGroups("joinRequestPending")} · ${fmtDate(row.createdAt)}`
                  : tGroups("joinRequestPending"),
              });
            })}
          </div>
        </div>
      )}

      {!loadingCommunities &&
        !hasAnyJoined &&
        !hasAnyPending && (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={styles.sectionHeaderRow}>
              <div style={styles.sectionTitle}>{tNav("otherCommunities")}</div>

              <button
                type="button"
                onClick={onCreateCommunity}
                style={styles.createInlineButton}
                aria-label={tGroups("createCommunity")}
                title={tGroups("createCommunity")}
              >
                <span aria-hidden="true">+</span>
                <span>Crear</span>
              </button>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "rgba(255,255,255,0.58)",
                padding: "2px 2px 0",
              }}
            >
              {tGroups("noOwnerCommunities")}
            </div>
          </div>
        )}
        {leaveTargetGroup && (
  <div
    role="dialog"
    aria-modal="true"
    aria-label={tGroups("leaveGroupAriaLabel")}
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: "rgba(0,0,0,0.72)",
      backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
      display: "grid",
      placeItems: "center",
      padding: 18,
    }}
  >
    <div
      style={{
        width: "min(420px, 100%)",
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(18,18,20,0.98)",
        boxShadow: "0 24px 80px rgba(0,0,0,0.46)",
        padding: 20,
        display: "grid",
        gap: 14,
        color: "#fff",
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
<div
  style={{
    fontSize: 17,
    fontWeight: 650,
    letterSpacing: -0.2,
  }}
>
  {tGroups("leaveConfirm")}
</div>

        <div
          style={{
            fontSize: 13,
            lineHeight: 1.45,
            color: "rgba(255,255,255,0.68)",
          }}
        >
          Vas a salir de{" "}
          <strong style={{ color: "#fff" }}>
            {leaveTargetGroup.name ?? "esta comunidad"}
          </strong>
          . Si después quieres volver, tendrás que unirte otra vez o solicitar
          acceso según la configuración del grupo.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
<button
  type="button"
  onClick={closeLeaveConfirm}
  disabled={!!leavingGroupId}
  style={{
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.045)",
    color: "#fff",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 550,
    cursor: leavingGroupId ? "not-allowed" : "pointer",
    opacity: leavingGroupId ? 0.7 : 1,
  }}
>
  {tCommon("cancel")}
</button>

<button
  type="button"
  onClick={handleConfirmLeaveGroup}
  disabled={!!leavingGroupId}
  style={{
    border: "1px solid rgba(248,113,113,0.26)",
    background: "rgba(239,68,68,0.88)",
    color: "#fff",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: leavingGroupId ? "not-allowed" : "pointer",
    opacity: leavingGroupId ? 0.75 : 1,
  }}
>
  {leavingGroupId ? tCommon("loading") : tCommon("leave")}
</button>
      </div>
    </div>
  </div>
)}
    </>
  );
}
