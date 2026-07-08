// OwnerSidebar.utils.ts
// Helpers puros y constantes extraídos de OwnerSidebar.tsx.
// No dependen del estado del componente. Los tipos se importan como type-only
// desde OwnerSidebar (sin ciclo en runtime) para mantener una sola fuente de verdad.

import type { Timestamp } from "firebase/firestore";
import type {
  Currency,
  SidebarMemberStatus,
  GroupRoleLite,
  GroupDocLite,
  UserDoc,
  MeetGreetStatus,
  MeetGreetRequestDoc,
} from "./OwnerSidebar";

export const OWNER_SIDEBAR_NO_SHOW_GRACE_MS = 15 * 60 * 1000;
export const OWNER_SIDEBAR_FOLLOWING_LIMIT = 30;

export function visibilitySectionTitle(v: string, t?: (key: string) => string) {
  if (v === "public") return t ? t("visibilityPublicTitle") : "Comunidades públicas";
  if (v === "private") return t ? t("visibilityPrivateTitle") : "Comunidades privadas";
  if (v === "hidden") return t ? t("visibilityHiddenTitle") : "Comunidades ocultas";
  return t ? t("otherCommunities") : "Otras comunidades";
}

export function typeLabel(t: string) {
  if (t === "saludo") return "Saludo";
  if (t === "consejo") return "Consejo";
  if (t === "mensaje") return "Mensaje";
  if (t === "meet_greet_digital") return "Sesión en vivo";
  if (t === "clase_personalizada") return "Sesión exclusiva";
  if (t === "exclusive_session") return "Sesión exclusiva";
  if (t === "digital_exclusive_session") return "Sesión exclusiva";
  return t;
}

export function getServiceBucketKey(data: {
  source?: string | null;
  profileUserId?: string | null;
  creatorId?: string | null;
  groupId?: string | null;
}) {
  if (data.source === "profile") {
    return `profile:${data.profileUserId ?? data.creatorId ?? "unknown"}`;
  }

  return data.groupId ?? null;
}

export function isMeetGreetCreatorActiveItem(status?: MeetGreetStatus | null) {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "scheduled" ||
    status === "reschedule_requested" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

export function isMeetGreetPendingItem(status?: MeetGreetStatus | null) {
  return (
    status === "pending_creator_response" ||
    status === "accepted_pending_schedule" ||
    status === "scheduled" ||
    status === "reschedule_requested" ||
    status === "ready_to_prepare" ||
    status === "in_preparation"
  );
}

export function isBuyerRequestedVisibleItem(status?: MeetGreetStatus | null) {
  return (
    isMeetGreetPendingItem(status) ||
    status === "rejected" ||
    status === "refund_requested" ||
    status === "refund_review" ||
    status === "cancelled"
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

export function friendlyJoinErrorMessage(err: unknown, fallback = "Ocurrió un error.") {
  const errMsg = err instanceof Error ? err.message : "";
  const msg = errMsg.toLowerCase();
  if (
    msg.includes("solicitud no existe") ||
    msg.includes("not-found") ||
    msg.includes("does not exist")
  ) {
    return null;
  }
  return errMsg || fallback;
}

export function buildDisplayName(user?: Partial<UserDoc> | null, uid?: string, userFallback = "Usuario") {
  const dn = user?.displayName?.trim();
  if (dn) return dn;

  const full = [user?.firstName?.trim(), user?.lastName?.trim()]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (full) return full;
  if (uid) return `${userFallback} ${uid.slice(0, 6)}`;
  return userFallback;
}

export function shouldOwnerSidebarTreatAsNoShowRejected(
  item?: Pick<MeetGreetRequestDoc, "status" | "scheduledAt"> | null,
  nowMs = Date.now()
) {
  if (!item?.scheduledAt) return false;

  if (
    item.status !== "scheduled" &&
    item.status !== "ready_to_prepare" &&
    item.status !== "in_preparation"
  ) {
    return false;
  }

  return (
    nowMs >=
    item.scheduledAt.toDate().getTime() + OWNER_SIDEBAR_NO_SHOW_GRACE_MS
  );
}

export function normalizeOwnerSidebarNoShowStatus<T extends MeetGreetRequestDoc>(
  item: T,
  nowMs = Date.now()
): T {
  if (!shouldOwnerSidebarTreatAsNoShowRejected(item, nowMs)) return item;

  return {
    ...item,
    status: "rejected",
    rejectionReason:
      item.rejectionReason ??
      "Rechazado automáticamente por no iniciar la sesión dentro de los 15 minutos de tolerancia.",
  };
}

export function normalizeSidebarMemberStatus(raw: unknown): SidebarMemberStatus {
  if (raw === "banned") return "banned";
  if (raw === "muted") return "muted";
  if (raw === "subscribed") return "subscribed";
  if (raw === "active") return "active";
  if (raw === "removed") return "removed";

  if (raw === "kicked") return "removed";
  if (raw === "expelled") return "removed";

  return null;
}

export function normalizeSidebarGroupRole(raw: unknown): GroupRoleLite {
  if (raw === "owner") return "owner";
  if (raw === "mod" || raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

export function sortGroupsWithModsFirst(items: GroupDocLite[]) {
  return [...items].sort((a, b) => {
    const aIsMod = a.memberRole === "mod" ? 0 : 1;
    const bIsMod = b.memberRole === "mod" ? 0 : 1;

    if (aIsMod !== bIsMod) return aIsMod - bIsMod;

    const aName = (a.name ?? "").trim().toLocaleLowerCase("es-MX");
    const bName = (b.name ?? "").trim().toLocaleLowerCase("es-MX");
    return aName.localeCompare(bName, "es-MX");
  });
}

export function resolveSidebarSubscriptionEnabled(group?: GroupDocLite | null) {
  return (
    group?.monetization?.subscriptionsEnabled === true ||
    group?.monetization?.isPaid === true
  );
}

export function resolveSidebarSubscriptionPrice(group?: GroupDocLite | null) {
  return (
    group?.monetization?.subscriptionPriceMonthly ??
    group?.monetization?.priceMonthly ??
    null
  );
}

export function resolveSidebarSubscriptionCurrency(group?: GroupDocLite | null) {
  return (
    group?.monetization?.subscriptionCurrency ??
    group?.monetization?.currency ??
    null
  );
}

export function formatSidebarMoney(value: number, currency: Currency) {
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
