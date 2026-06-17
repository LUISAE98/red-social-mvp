import {
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type GroupMonetizationLike = {
  isPaid?: boolean;
  subscriptionsEnabled?: boolean;
};

type GroupDocLike = {
  visibility?: "public" | "private" | "hidden";
  monetization?: GroupMonetizationLike;
  subscriptionsEnabled?: boolean;
};

function groupRequiresSubscription(group: GroupDocLike | undefined): boolean {
  if (!group) return false;

  const monetization = group.monetization;
  const subscriptionsEnabled =
    group.subscriptionsEnabled === true ||
    monetization?.subscriptionsEnabled === true;

  const isPaid = monetization?.isPaid === true;

  return subscriptionsEnabled || isPaid;
}

export async function requestToJoin(groupId: string, uid: string) {
  const groupRef = doc(db, "groups", groupId);
  const groupSnap = await getDoc(groupRef);

  if (!groupSnap.exists()) {
    throw new Error("GROUP_NOT_FOUND");
  }

  const group = groupSnap.data() as GroupDocLike;

  if (groupRequiresSubscription(group)) {
    /**
     * Importante:
     * No usamos joinRequest estándar para grupos con suscripción.
     * La UI debe capturar este error y mandar al flujo de Suscribirme.
     */
    throw new Error("GROUP_REQUIRES_SUBSCRIPTION");
  }

  const ref = doc(db, "groups", groupId, "joinRequests", uid);
  const userJoinRequestRef = doc(
    db,
    "users",
    uid,
    "joinRequestsSent",
    groupId
  );

  const batch = writeBatch(db);

  batch.set(
    ref,
    {
      userId: uid,
      groupId,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(
    userJoinRequestRef,
    {
      groupId,
      userId: uid,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();
}

export async function cancelJoinRequest(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "joinRequests", uid);
  const userJoinRequestRef = doc(
    db,
    "users",
    uid,
    "joinRequestsSent",
    groupId
  );

  const batch = writeBatch(db);

  batch.delete(ref);
  batch.delete(userJoinRequestRef);

  await batch.commit();
}