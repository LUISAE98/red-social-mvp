import { doc, getDoc, setDoc, collection, onSnapshot, serverTimestamp, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type LiveAccess = {
  liveId: string;
  userId: string;
  postId: string;
  groupId?: string | null;
  authorId: string;
  accessType: "live_ticket";
  amount: number;
  currency: "MXN" | "USD";
  status: "paid";
  paymentMode: "simulated";
  createdAt: unknown;
};

export async function checkLiveAccess(liveId: string, userId: string): Promise<boolean> {
  const ref = doc(db, "liveAccess", liveId, "users", userId);
  const snap = await getDoc(ref);
  return snap.exists() && snap.data()?.status === "paid";
}

export async function grantSimulatedLiveAccess(params: {
  liveId: string;
  userId: string;
  postId: string;
  authorId: string;
  groupId?: string | null;
  amount: number;
  currency: "MXN" | "USD";
}): Promise<void> {
  const ref = doc(db, "liveAccess", params.liveId, "users", params.userId);
  await setDoc(ref, {
    liveId: params.liveId,
    userId: params.userId,
    postId: params.postId,
    authorId: params.authorId,
    groupId: params.groupId ?? null,
    accessType: "live_ticket",
    amount: params.amount,
    currency: params.currency,
    status: "paid",
    paymentMode: "simulated",
    createdAt: serverTimestamp(),
  });
}

/**
 * Subscribes to total ticket revenue for a live (creator-only).
 * Requires the caller to be the live's author (enforced by Firestore rules via allow list).
 */
export function subscribeToTicketRevenue(
  postId: string,
  onData: (totalAmount: number, ticketCount: number) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, "liveAccess", postId, "users"),
    (snap) => {
      let total = 0;
      snap.docs.forEach((d) => {
        const amt = d.data().amount;
        if (typeof amt === "number") total += amt;
      });
      onData(total, snap.size);
    },
    (err) => onError?.(err),
  );
}
