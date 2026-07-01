import { doc, onSnapshot, setDoc, serverTimestamp, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";

const COLLECTION = "liveCreatorStats";

export function subscribeToPeakRevenue(
  authorId: string,
  onData: (peak: number) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, COLLECTION, authorId),
    (snap) => {
      const peak = snap.data()?.peakRevenue;
      onData(typeof peak === "number" ? peak : 0);
    },
    () => onData(0),
  );
}

export async function updatePeakRevenueIfRecord(
  authorId: string,
  revenue: number,
): Promise<void> {
  const ref = doc(db, COLLECTION, authorId);
  await setDoc(ref, { peakRevenue: revenue, updatedAt: serverTimestamp() }, { merge: true });
}
