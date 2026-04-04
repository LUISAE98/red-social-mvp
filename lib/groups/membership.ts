import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Tipos de acceso a grupo (preparación para suscripciones)
 */
type MembershipAccessType =
  | "standard" // join normal
  | "subscription" // usuario se suscribió
  | "legacy_free"; // usuario se quedó gratis tras cambio

/**
 * Join estándar (flujo actual)
 */
export async function joinGroup(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "members", uid);

  await setDoc(
    ref,
    {
      userId: uid,
      roleInGroup: "member",
      status: "active",

      // 🔹 NUEVO: metadata de acceso
      accessType: "standard" as MembershipAccessType,
      requiresSubscription: false,

      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Join vía suscripción (flujo nuevo sin pago real todavía)
 */
export async function joinGroupWithSubscription(
  groupId: string,
  uid: string,
  options?: {
    priceMonthly?: number;
    currency?: string;
  }
) {
  const ref = doc(db, "groups", groupId, "members", uid);

  await setDoc(
    ref,
    {
      userId: uid,
      roleInGroup: "member",
      status: "active",

      // 🔹 CLAVE: este usuario entró como suscriptor
      accessType: "subscription" as MembershipAccessType,
      requiresSubscription: true,
      subscriptionActive: true,

      // 🔹 metadata para futuro checkout
      subscriptionPriceMonthly: options?.priceMonthly ?? null,
      subscriptionCurrency: options?.currency ?? "MXN",

      subscribedAt: serverTimestamp(),

      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Join como legacy (cuando grupo pasa de gratis → suscripción
 * y decides mantener usuarios gratis)
 */
export async function joinGroupAsLegacyFree(
  groupId: string,
  uid: string
) {
  const ref = doc(db, "groups", groupId, "members", uid);

  await setDoc(
    ref,
    {
      userId: uid,
      roleInGroup: "member",
      status: "active",

      // 🔹 usuario no paga aunque ahora sea grupo de pago
      accessType: "legacy_free" as MembershipAccessType,
      requiresSubscription: false,
      subscriptionActive: false,

      legacyGrantedAt: serverTimestamp(),

      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Leave group
 */
export async function leaveGroup(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "members", uid);
  await deleteDoc(ref);
}