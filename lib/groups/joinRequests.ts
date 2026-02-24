import { doc, setDoc, serverTimestamp, deleteDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export async function requestToJoin(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "joinRequests", uid);

  await setDoc(
    ref,
    {
      userId: uid,
      status: "pending",
      requestedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function cancelJoinRequest(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "joinRequests", uid);
  await deleteDoc(ref);
}