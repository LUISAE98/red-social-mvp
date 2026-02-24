import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export async function joinGroup(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "members", uid);
  await setDoc(ref, {
    joinedAt: serverTimestamp(),
    role: "member",
    status: "active",
  }, { merge: true });
}

export async function leaveGroup(groupId: string, uid: string) {
  const ref = doc(db, "groups", groupId, "members", uid);
  await deleteDoc(ref);
}
