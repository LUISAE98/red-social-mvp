import { doc, getDoc, collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
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
  createdAt: unknown;
};

/**
 * El ticket lo crea SIEMPRE el backend al aprobarse el pago (Stripe →
 * `reconcile` → `liveAccess/{liveId}/users/{uid}`), nunca el cliente: crear el
 * doc acuña la ganancia del creador en el ledger (`onLiveAccessLedger`).
 *
 * `userId` puede ser el uid de una cuenta real o el de un invitado (auth anónima).
 */
export async function checkLiveAccess(liveId: string, userId: string): Promise<boolean> {
  const ref = doc(db, "liveAccess", liveId, "users", userId);
  const snap = await getDoc(ref);
  return snap.exists() && snap.data()?.status === "paid";
}

/**
 * Igual que `checkLiveAccess` pero en tiempo real: mientras el paywall está
 * abierto, el acceso se refleja solo en cuanto el webhook materializa el ticket
 * (el cobro es asíncrono, no hay que hacer polling ni reabrir el visor).
 */
export function subscribeToLiveAccess(
  liveId: string,
  userId: string,
  onAccess: (paid: boolean) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, "liveAccess", liveId, "users", userId),
    (snap) => onAccess(snap.exists() && snap.data()?.status === "paid"),
    (err) => { onAccess(false); onError?.(err); },
  );
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
