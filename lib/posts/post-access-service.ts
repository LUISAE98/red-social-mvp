import { collection, query, where, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Subscribes to VOD purchase revenue for a post (creator-only).
 * Requires the caller to be the post's creator (enforced by Firestore rules via allow list).
 * Only counts docs where creatorId is set — docs from before this field was added are excluded.
 */
export function subscribeToVodRevenue(
  postId: string,
  creatorId: string,
  onData: (totalAmount: number, buyerCount: number) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, "postAccess"),
    where("postId", "==", postId),
    where("creatorId", "==", creatorId),
  );
  return onSnapshot(
    q,
    (snap) => {
      let total = 0;
      let count = 0;
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.status === "active") {
          const price = typeof data.price === "number" ? data.price : 0;
          total += price;
          count++;
        }
      });
      onData(total, count);
    },
    (err) => onError?.(err),
  );
}
