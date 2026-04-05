import {
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Tipos de acceso a grupo alineados con sidebar + group page + backend transition
 */
type MembershipAccessType =
  | "standard" // join normal gratis
  | "subscription" // metadata de acceso por suscripción
  | "legacy_free"; // usuario conservó acceso gratis tras transición

type MembershipStatus =
  | "active"
  | "subscribed";

type JoinWithSubscriptionOptions = {
  priceMonthly?: number;
  currency?: string;
};

function buildBaseMemberFields(uid: string, status: MembershipStatus) {
  return {
    userId: uid,
    roleInGroup: "member",
    status,
    updatedAt: serverTimestamp(),

    // limpieza de estados incompatibles previos
    removedAt: deleteField(),
    removedBy: deleteField(),
    removedReason: deleteField(),
    removedDueToSubscriptionTransition: deleteField(),
    transitionPendingAction: false,
    transitionDirection: deleteField(),
    transitionResolvedAt: deleteField(),

    // compatibilidad general
    subscriptionEndedAt: deleteField(),
    subscriptionEndedBy: deleteField(),
  };
}

/**
 * Join estándar (flujo actual)
 */
export async function joinGroup(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "members", uid);

  await setDoc(
    ref,
    {
      ...buildBaseMemberFields(uid, "active"),

      accessType: "standard" as MembershipAccessType,
      requiresSubscription: false,
      subscriptionActive: false,

      joinedAt: serverTimestamp(),

      // limpiar metadata de suscripción / legado
      subscribedAt: deleteField(),
      subscriptionPriceMonthly: deleteField(),
      subscriptionCurrency: deleteField(),
      legacyGrantedAt: deleteField(),
      legacyGrantedBy: deleteField(),
      legacyComplimentary: deleteField(),
    },
    { merge: true }
  );
}

/**
 * Join vía suscripción
 *
 * Regla nueva:
 * - status = "subscribed"
 * - accessType = "subscription"
 *
 * Así distinguimos claramente:
 * - active => acceso gratis / legacy
 * - subscribed => acceso pagado por suscripción
 */
export async function joinGroupWithSubscription(
  groupId: string,
  uid: string,
  options?: JoinWithSubscriptionOptions
) {
  const ref = doc(db, "groups", groupId, "members", uid);

  await setDoc(
    ref,
    {
      ...buildBaseMemberFields(uid, "subscribed"),

      accessType: "subscription" as MembershipAccessType,
      requiresSubscription: true,
      subscriptionActive: true,

      subscriptionPriceMonthly: options?.priceMonthly ?? null,
      subscriptionCurrency: options?.currency ?? "MXN",
      subscribedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),

      // limpiar metadata incompatible
      legacyGrantedAt: deleteField(),
      legacyGrantedBy: deleteField(),
      legacyComplimentary: deleteField(),
    },
    { merge: true }
  );
}

/**
 * Join como legacy free
 *
 * Cuando el grupo pasa de gratis → suscripción
 * y decides mantener a los usuarios existentes gratis.
 *
 * Regla:
 * - siguen siendo status = "active"
 * - accessType = "legacy_free"
 */
export async function joinGroupAsLegacyFree(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "members", uid);

  await setDoc(
    ref,
    {
      ...buildBaseMemberFields(uid, "active"),

      accessType: "legacy_free" as MembershipAccessType,
      requiresSubscription: false,
      subscriptionActive: false,
      legacyComplimentary: true,

      legacyGrantedAt: serverTimestamp(),
      joinedAt: serverTimestamp(),

      // limpiar metadata incompatible
      subscribedAt: deleteField(),
      subscriptionPriceMonthly: deleteField(),
      subscriptionCurrency: deleteField(),
    },
    { merge: true }
  );
}

/**
 * Leave group
 *
 * Se mantiene deleteDoc para que "salir" elimine la membresía real.
 * Esto además coincide con la nueva regla que queremos reforzar:
 * cuando alguien queda fuera del grupo, debe quedar como no-miembro,
 * no como expulsado visualmente.
 */
export async function leaveGroup(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "members", uid);
  await deleteDoc(ref);
}