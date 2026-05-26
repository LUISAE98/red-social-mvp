import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";


const db = getFirestore();

type TogglePostSavePayload = {
  postId?: unknown;
};

type MemberStatus = "active" | "subscribed" | "muted" | "banned" | "removed" | null;
type MemberRole = "owner" | "mod" | "moderator" | "member" | null;

function normalizePostId(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "postId inválido.");
  }

  const postId = value.trim();

  if (!postId) {
    throw new HttpsError("invalid-argument", "postId requerido.");
  }

  return postId;
}

function normalizeMemberStatus(value: unknown): MemberStatus {
  if (value === "active") return "active";
  if (value === "subscribed") return "subscribed";
  if (value === "muted") return "muted";
  if (value === "banned") return "banned";
  if (value === "removed" || value === "kicked" || value === "expelled") return "removed";
  return null;
}

function normalizeMemberRole(value: unknown): MemberRole {
  if (value === "owner") return "owner";
  if (value === "mod") return "mod";
  if (value === "moderator") return "moderator";
  if (value === "member") return "member";
  return null;
}

function isReadableMemberStatus(status: MemberStatus): boolean {
  return status === "active" || status === "subscribed" || status === "muted";
}

function getCurrentSaveCount(postData: FirebaseFirestore.DocumentData): number {
  const value = postData?.counts?.saves;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return value;
}

function isFreePublicPost(postData: FirebaseFirestore.DocumentData): boolean {
  return (
    postData.isDeleted !== true &&
    typeof postData.groupId === "string" &&
    postData.groupVisibility === "public" &&
    (postData.accessModel === undefined || postData.accessModel === "free") &&
    (postData.requiresPayment === undefined || postData.requiresPayment === false) &&
    (postData.requiresSubscription === undefined || postData.requiresSubscription === false)
  );
}

async function assertUserCanSavePost(params: {
  tx: FirebaseFirestore.Transaction;
  uid: string;
  postData: FirebaseFirestore.DocumentData;
}): Promise<void> {
  const { tx, uid, postData } = params;

  if (isFreePublicPost(postData)) {
    return;
  }

  const groupId = typeof postData.groupId === "string" ? postData.groupId : null;

  if (!groupId) {
    throw new HttpsError("permission-denied", "No tienes acceso a esta publicación.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  const memberRef = groupRef.collection("members").doc(uid);

  const [groupSnap, memberSnap] = await Promise.all([
    tx.get(groupRef),
    tx.get(memberRef),
  ]);

  if (!groupSnap.exists) {
    throw new HttpsError("permission-denied", "No tienes acceso a esta publicación.");
  }

  const groupData = groupSnap.data() ?? {};
  const memberData = memberSnap.exists ? memberSnap.data() ?? {} : null;

  const ownerId = typeof groupData.ownerId === "string" ? groupData.ownerId : null;
  const groupIsActive = groupData.isActive !== false;
  const groupVisibility =
    groupData.visibility === "public" ||
    groupData.visibility === "private" ||
    groupData.visibility === "hidden"
      ? groupData.visibility
      : null;

  const memberStatus = normalizeMemberStatus(memberData?.status);
  const memberRole = normalizeMemberRole(memberData?.roleInGroup ?? memberData?.role);

  const isOwner = ownerId === uid;
  const isModerator =
    (memberRole === "mod" || memberRole === "moderator") &&
    isReadableMemberStatus(memberStatus);

  const isMember = isReadableMemberStatus(memberStatus);

  const canReadGroupContent =
    groupIsActive &&
    (groupVisibility === "public" || isMember || isOwner || isModerator);

  const isAuthor = postData.authorId === uid;

  if (!canReadGroupContent && !isAuthor) {
    throw new HttpsError("permission-denied", "No tienes acceso a esta publicación.");
  }

  if (memberStatus === "banned" || memberStatus === "removed") {
    throw new HttpsError("permission-denied", "No puedes guardar publicaciones de este grupo.");
  }
}

export const togglePostSave = onCall<TogglePostSavePayload>(async (request) => {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión para guardar publicaciones.");
  }

  const postId = normalizePostId(request.data?.postId);

  const postRef = db.collection("posts").doc(postId);
  const saveRef = postRef.collection("saves").doc(uid);
  const userSavedPostRef = db.collection("users").doc(uid).collection("savedPosts").doc(postId);

  return db.runTransaction(async (tx) => {
    const [postSnap, saveSnap] = await Promise.all([
      tx.get(postRef),
      tx.get(saveRef),
    ]);

    if (!postSnap.exists) {
      throw new HttpsError("not-found", "La publicación no existe.");
    }

    const postData = postSnap.data() ?? {};

    if (postData.isDeleted === true || postData.deletedAt) {
      throw new HttpsError("failed-precondition", "No puedes guardar una publicación eliminada.");
    }

    const now = FieldValue.serverTimestamp();
    const currentSaves = getCurrentSaveCount(postData);

    if (saveSnap.exists) {
      const nextSaves = Math.max(0, currentSaves - 1);

      tx.delete(saveRef);
      tx.delete(userSavedPostRef);

      tx.update(postRef, {
        "counts.saves": nextSaves,
        updatedAt: now,
      });

      return {
        postId,
        saved: false,
        delta: -1,
      };
    }

    await assertUserCanSavePost({
      tx,
      uid,
      postData,
    });

    const nextSaves = currentSaves + 1;

    tx.set(saveRef, {
      postId,
      userId: uid,
      createdAt: now,
      updatedAt: now,
    });

    tx.set(userSavedPostRef, {
      postId,
      userId: uid,
      groupId: typeof postData.groupId === "string" ? postData.groupId : null,
      authorId: typeof postData.authorId === "string" ? postData.authorId : null,
      savedAt: now,
      postCreatedAt: postData.createdAt ?? null,
      isVisible: true,
      isDeleted: false,
      groupVisibility: typeof postData.groupVisibility === "string" ? postData.groupVisibility : null,
      accessModel: typeof postData.accessModel === "string" ? postData.accessModel : "free",
      requiresPayment: postData.requiresPayment === true,
      requiresSubscription: postData.requiresSubscription === true,
      updatedAt: now,
      version: 1,
    });

    tx.update(postRef, {
      "counts.saves": nextSaves,
      updatedAt: now,
    });

    return {
      postId,
      saved: true,
      delta: 1,
    };
  });
});

export const onSavedPostsPostDeleted = onDocumentUpdated(
  {
    document: "posts/{postId}",
    region: "us-central1",
  },
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      return;
    }

    if (
      beforeData.isDeleted === true ||
      afterData.isDeleted !== true
    ) {
      return;
    }

    const postId = event.params.postId;

    const savedPostsSnap = await db
      .collectionGroup("savedPosts")
      .where("postId", "==", postId)
      .get();

    const writes = savedPostsSnap.docs.map((docSnap) =>
      docSnap.ref.delete()
    );

    await Promise.all(writes);
  }
);