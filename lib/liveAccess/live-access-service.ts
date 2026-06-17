import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
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
