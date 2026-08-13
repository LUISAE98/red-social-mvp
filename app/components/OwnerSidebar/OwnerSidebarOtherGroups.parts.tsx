"use client";

// Tipos, helpers y el sub-componente LeaveGroupActionCard de OwnerSidebarOtherGroups
// (aislados a nivel de módulo). Extraído para reducir el componente principal.

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

export type Props = {
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

export type SidebarMemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

export type SidebarMemberRole = "owner" | "mod" | "member" | null;

export type AccessState =
  | "joined"
  | "legacy_free"
  | "subscribed"
  | "requires_subscription"
  | "banned";

export type NoticeTone = "warning" | "success" | "info" | "danger";

export type PriceAwareGroup = GroupDocLite & {
  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: "MXN" | "USD" | string | null;
};

export function normalizeMemberStatus(group: GroupDocLite): SidebarMemberStatus {
  const raw = group?.memberStatus ?? null;

  if (raw === "active") return "active";
  if (raw === "subscribed") return "subscribed";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";

  return null;
}

export function normalizeMemberRole(group: GroupDocLite): SidebarMemberRole {
  const raw =
    typeof group?.memberRole === "string"
      ? group.memberRole.trim().toLowerCase()
      : null;

  if (raw === "owner") return "owner";
  if (raw === "mod" || raw === "moderator") return "mod";
  if (raw === "member") return "member";

  return null;
}

export function isActuallyJoinedStatus(status: SidebarMemberStatus) {
  return (
    status === "active" ||
    status === "subscribed" ||
    status === "muted"
  );
}

export function statusDotColor(status?: SidebarMemberStatus) {
  if (status === "subscribed") return "#38bdf8";
  if (status === "muted") return "#f5a623";
  if (status === "banned") return "#ef4444";
  if (status === "removed") return "#b91c1c";
  return "#22c55e";
}

export function statusLabel(status?: SidebarMemberStatus, tg?: (key: string) => string) {
  if (status === "subscribed") return tg ? tg("statusSubscribed") : "Suscrito";
  if (status === "muted") return tg ? tg("statusMuted") : "Muteado";
  if (status === "banned") return tg ? tg("statusBanned") : "Baneado";
  if (status === "removed") return tg ? tg("statusRemoved") : "Expulsado";
  return tg ? tg("statusActive") : "Activo";
}

export function roleLabel(role?: SidebarMemberRole, tg?: (key: string) => string) {
  if (role === "mod") return tg ? tg("roleMod") : "Moderador";
  if (role === "owner") return tg ? tg("roleOwner") : "Owner";
  return tg ? tg("roleMember") : "Miembro";
}

export function resolveAccessState(group: GroupDocLite): AccessState {
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

export function isJoinedLikeState(state: AccessState) {
  return (
    state === "joined" ||
    state === "legacy_free" ||
    state === "subscribed" ||
    state === "banned"
  );
}

export function shouldShowGroup(group: GroupDocLite, dismissedIds: Set<string>) {
  if (group.canDismiss === true && dismissedIds.has(group.id)) {
    return false;
  }

  return true;
}

export type MoneyFormatter = PriceFormatter["format"];

export function getPriceIncreaseMeta(group: GroupDocLite) {
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

export function buildJoinedSubtitle(
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

export function buildAccessNotice(
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

export function noticeStyles(
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

export function LeaveGroupActionCard(params: {
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
    insetInlineStart: 0,
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
export const LEGACY_BANNER_DISMISSED_KEY = "vibra:legacy-access-banner-dismissed";

export function readDismissedLegacyBanners(): Set<string> {
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

export function writeDismissedLegacyBanners(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LEGACY_BANNER_DISMISSED_KEY,
      JSON.stringify(Array.from(ids))
    );
  } catch {}
}

