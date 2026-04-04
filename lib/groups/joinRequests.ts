import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
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

  await setDoc(
    ref,
    {
      userId: uid,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function cancelJoinRequest(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "joinRequests", uid);
  await deleteDoc(ref);
}