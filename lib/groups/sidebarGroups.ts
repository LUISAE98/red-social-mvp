import {
  collection,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { resolveEffectiveMemberStatus } from "@/lib/groups/groupAdapters";
import { CACHE_TTL } from "@/lib/cache/ttl";

export type MembershipAccessType =
  | "standard"
  | "subscription"
  | "subscribed"
  | "legacy_free"
  | "subscription_required"
  | "unknown";

export type SidebarGroupState =
  | "joined"
  | "legacy_free"
  | "requires_subscription"
  | "banned";

export type SidebarGroup = {
  id: string;
  name?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  coverUrl?: string | null;
  ownerId?: string | null;
  visibility?: "public" | "private" | "hidden" | string | null;
  avatarUrl?: string | null;

  memberStatus?:
    | "active"
    | "subscribed"
    | "muted"
    | "banned"
    | "removed"
    | "kicked"
    | "expelled"
    | null;

  memberRole?: "owner" | "mod" | "moderator" | "member" | string | null;

  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: "MXN" | "USD" | null;

    subscriptionsEnabled?: boolean;
    subscriptionPriceMonthly?: number | null;
    subscriptionCurrency?: "MXN" | "USD" | null;
  } | null;

  offerings?: Array<{
    type: string;
    enabled?: boolean;
    price?: number | null;
    currency?: "MXN" | "USD" | null;
  }>;

  membershipAccessType?: MembershipAccessType | null;
  requiresSubscription?: boolean | null;
  subscriptionActive?: boolean | null;
  legacyComplimentary?: boolean | null;
  transitionPendingAction?: boolean | null;
  transitionReason?: string | null;
  canDismiss?: boolean | null;
  sidebarState?: SidebarGroupState | null;

  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: "MXN" | "USD" | string | null;
};

type GetMyHiddenJoinedGroupsResult = {
  success?: boolean;
  groups?: SidebarGroup[] | null;
};

type DismissHiddenGroupTransitionParams = {
  groupId: string;
};

type DismissHiddenGroupTransitionResult = {
  ok?: boolean;
  alreadyDismissed?: boolean;
  groupId?: string | null;
};

function normalizeGroupId(groupId: string): string {
  return typeof groupId === "string" ? groupId.trim() : "";
}

function normalizeSidebarGroupFromUserMembership(
  id: string,
  data: Record<string, unknown>
): SidebarGroup | null {
  const groupId =
    typeof data.groupId === "string" && data.groupId.trim()
      ? data.groupId.trim()
      : id.trim();

  if (!groupId) return null;

  const status = resolveEffectiveMemberStatus(
    typeof data.status === "string" ? data.status : null,
    data.mutedUntil
  );

  if (status === "removed" || status === "kicked" || status === "expelled") {
    return null;
  }

  return {
    id: groupId,
    name:
      typeof data.name === "string"
        ? data.name
        : typeof data.groupName === "string"
          ? data.groupName
          : null,
    description:
      typeof data.description === "string"
        ? data.description
        : typeof data.groupDescription === "string"
          ? data.groupDescription
          : null,
    imageUrl:
      typeof data.imageUrl === "string"
        ? data.imageUrl
        : typeof data.groupImageUrl === "string"
          ? data.groupImageUrl
          : null,
    avatarUrl:
      typeof data.avatarUrl === "string"
        ? data.avatarUrl
        : typeof data.groupAvatarUrl === "string"
          ? data.groupAvatarUrl
          : null,
    coverUrl:
      typeof data.coverUrl === "string"
        ? data.coverUrl
        : typeof data.groupCoverUrl === "string"
          ? data.groupCoverUrl
          : null,
    ownerId:
      typeof data.ownerId === "string"
        ? data.ownerId
        : typeof data.groupOwnerId === "string"
          ? data.groupOwnerId
          : null,
    visibility:
      typeof data.visibility === "string"
        ? data.visibility
        : typeof data.groupVisibility === "string"
          ? data.groupVisibility
          : null,

    memberStatus: status as SidebarGroup["memberStatus"],
    memberRole:
      typeof data.roleInGroup === "string"
        ? data.roleInGroup
        : typeof data.role === "string"
          ? data.role
          : "member",

    membershipAccessType:
      typeof data.accessType === "string"
        ? (data.accessType as MembershipAccessType)
        : null,
    requiresSubscription: data.requiresSubscription === true,
    subscriptionActive: data.subscriptionActive === true,
    legacyComplimentary: data.legacyComplimentary === true,
    transitionPendingAction: data.transitionPendingAction === true,
    transitionReason:
      typeof data.removedReason === "string" ? data.removedReason : null,
    canDismiss: data.canDismiss === true,
    sidebarState:
      status === "banned"
        ? "banned"
        : data.accessType === "legacy_free" || data.legacyComplimentary === true
          ? "legacy_free"
          : data.requiresSubscription === true &&
            data.accessType !== "subscription" &&
            data.accessType !== "subscribed" &&
            data.subscriptionActive !== true &&
            status !== "subscribed"
            ? "requires_subscription"
            : "joined",
  };
}

export function subscribeToMySidebarGroups(
  uid: string,
  onNext: (groups: SidebarGroup[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const normalizedUid = typeof uid === "string" ? uid.trim() : "";

  if (!normalizedUid) {
    onNext([]);
    return () => {};
  }

  return onSnapshot(
    collection(db, "users", normalizedUid, "groupMemberships"),
    (snap) => {
      const groups = snap.docs
        .map((docSnap) =>
          normalizeSidebarGroupFromUserMembership(
            docSnap.id,
            docSnap.data() as Record<string, unknown>
          )
        )
        .filter((group): group is SidebarGroup => group !== null);

      onNext(groups);
    },
    (error) => {
      onError?.(error);
      onNext([]);
    }
  );
}

/**
 * Caché corta y deduplicador de llamadas en vuelo para las comunidades ocultas
 * a las que pertenece quien mira.
 *
 * 🚨 Medido en Sentry (30 días de producción): esta función se llamaba **240
 * veces** con una mediana de **265 ms**, unos 139 segundos acumulados solo en la
 * pantalla de perfil. No tenía caché de ninguna clase, y `fetchAccessibleGroupIds`
 * la invoca dentro de un `Promise.all` desde varios caminos del feed — así que
 * una sola carga podía disparar la misma llamada dos o tres veces EN PARALELO.
 *
 * `enVuelo` arregla eso: quien llegue mientras hay una petición viva se cuelga
 * de ella en vez de abrir otra. Es la mitad que más rinde.
 *
 * ⚠️ El plazo es de UN MINUTO (`TERCEROS`) y no de los diez del catálogo, a
 * propósito. Esta lista decide qué identificadores entran en las consultas del
 * feed, y la membresía de una comunidad oculta la cambia OTRA PERSONA: si
 * alguien te saca, seguir usando un identificador viejo hace que las reglas de
 * Firestore nieguen la consulta —y en un `in` la niegan ENTERA, no solo esa
 * comunidad—. No hay fuga de datos, pero sí un feed roto. Un minuto es
 * suficiente para colapsar la ráfaga de una navegación y bastante corto para no
 * arrastrar una membresía revocada.
 *
 * Por lo mismo NO baja a disco: sobrevivir a la recarga es justo lo que aquí no
 * se quiere.
 */
let cacheOcultas: { grupos: SidebarGroup[]; guardadoEn: number } | null = null;
let enVuelo: Promise<SidebarGroup[]> | null = null;

/** Se llama al entrar o salir de una comunidad, para no esperar al minuto. */
export function invalidarComunidadesOcultas(): void {
  cacheOcultas = null;
}

export async function getMyHiddenJoinedGroups(): Promise<SidebarGroup[]> {
  if (cacheOcultas && Date.now() - cacheOcultas.guardadoEn <= CACHE_TTL.TERCEROS) {
    return cacheOcultas.grupos;
  }

  if (enVuelo) return enVuelo;

  enVuelo = pedirComunidadesOcultas()
    .then((grupos) => {
      cacheOcultas = { grupos, guardadoEn: Date.now() };
      return grupos;
    })
    .finally(() => {
      enVuelo = null;
    });

  return enVuelo;
}

async function pedirComunidadesOcultas(): Promise<SidebarGroup[]> {
  const fn = httpsCallable<Record<string, never>, GetMyHiddenJoinedGroupsResult>(
    functions,
    "getMyHiddenJoinedGroups"
  );

  const res = await fn({});

  if (!Array.isArray(res.data?.groups)) {
    return [];
  }

  return res.data.groups.filter(
    (group): group is SidebarGroup =>
      !!group && typeof group.id === "string" && group.id.trim().length > 0
  );
}

export async function dismissHiddenGroupTransition(
  groupId: string
): Promise<DismissHiddenGroupTransitionResult> {
  const normalizedGroupId = normalizeGroupId(groupId);

  if (!normalizedGroupId) {
    throw new Error("groupId es requerido.");
  }

  const fn = httpsCallable<
    DismissHiddenGroupTransitionParams,
    DismissHiddenGroupTransitionResult
  >(functions, "dismissHiddenGroupTransition");

  const res = await fn({ groupId: normalizedGroupId });

  return {
    ok: res.data?.ok === true,
    alreadyDismissed: res.data?.alreadyDismissed === true,
    groupId:
      typeof res.data?.groupId === "string" && res.data.groupId.trim()
        ? res.data.groupId.trim()
        : normalizedGroupId,
  };
}

/**
 * Helpers locales para no depender todavía de types/group.ts
 * mientras consolidamos el tipado central.
 */

export function sidebarGroupHasSubscription(group: SidebarGroup): boolean {
  return (
    group.monetization?.subscriptionsEnabled === true ||
    group.monetization?.isPaid === true
  );
}

export function sidebarGroupSubscriptionPrice(
  group: SidebarGroup
): number | null {
  if (typeof group.monetization?.subscriptionPriceMonthly === "number") {
    return group.monetization.subscriptionPriceMonthly;
  }

  if (typeof group.monetization?.priceMonthly === "number") {
    return group.monetization.priceMonthly;
  }

  return null;
}

export function sidebarGroupSubscriptionCurrency(
  group: SidebarGroup
): "MXN" | "USD" {
  return (
    group.monetization?.subscriptionCurrency ||
    group.monetization?.currency ||
    "MXN"
  );
}

export function sidebarGroupWasRemovedBySubscriptionTransition(
  group: SidebarGroup
): boolean {
  return (
    group.requiresSubscription === true &&
    group.canDismiss === true &&
    (group.transitionReason === "subscription_required_after_transition" ||
      group.transitionReason === "subscription_transition" ||
      group.transitionReason ===
        "subscription_price_increase_requires_resubscribe")
  );
}

export function resolveSidebarGroupAccessState(
  group: SidebarGroup
):
  | "joined"
  | "legacy_free"
  | "subscribed"
  | "requires_subscription"
  | "banned" {
  if (group.sidebarState === "banned") {
    return "banned";
  }

  if (group.sidebarState === "legacy_free") {
    return "legacy_free";
  }

  if (group.sidebarState === "requires_subscription") {
    return "requires_subscription";
  }

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

  if (
    group.membershipAccessType === "subscription_required" ||
    group.requiresSubscription === true ||
    sidebarGroupWasRemovedBySubscriptionTransition(group)
  ) {
    return "requires_subscription";
  }

  if (group.memberStatus === "banned") {
    return "banned";
  }

  return "joined";
}

export function sidebarGroupCanBeDismissed(group: SidebarGroup): boolean {
  return group.canDismiss === true;
}

export function sidebarGroupIsLegacyFree(group: SidebarGroup): boolean {
  return (
    group.sidebarState === "legacy_free" ||
    group.membershipAccessType === "legacy_free" ||
    group.legacyComplimentary === true
  );
}

export function sidebarGroupRequiresSubscription(
  group: SidebarGroup
): boolean {
  return (
    group.sidebarState === "requires_subscription" ||
    group.membershipAccessType === "subscription_required" ||
    group.requiresSubscription === true ||
    sidebarGroupWasRemovedBySubscriptionTransition(group)
  );
}

/**
 * Compat helpers temporales para no romper imports existentes
 * mientras migramos el resto del sidebar.
 */

export type HiddenSidebarState = SidebarGroupState;
export type HiddenJoinedGroup = SidebarGroup;

export const hiddenGroupHasSubscription = sidebarGroupHasSubscription;
export const hiddenGroupSubscriptionPrice = sidebarGroupSubscriptionPrice;
export const hiddenGroupSubscriptionCurrency = sidebarGroupSubscriptionCurrency;
export const resolveHiddenGroupAccessState = resolveSidebarGroupAccessState;
export const hiddenGroupCanBeDismissed = sidebarGroupCanBeDismissed;
export const hiddenGroupIsLegacyFree = sidebarGroupIsLegacyFree;
export const hiddenGroupRequiresSubscription =
  sidebarGroupRequiresSubscription;
export const hiddenGroupWasRemovedBySubscriptionTransition =
  sidebarGroupWasRemovedBySubscriptionTransition;