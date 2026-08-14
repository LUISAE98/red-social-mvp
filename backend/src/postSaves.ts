import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { requirePlatformOwner } from "./authz";

const db = getFirestore();

type TogglePostSavePayload = {
  postId?: unknown;
};

type MemberStatus =
  | "active"
  | "subscribed"
  | "muted"
  | "banned"
  | "removed"
  | null;

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
  if (value === "removed" || value === "kicked" || value === "expelled") {
    return "removed";
  }

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

function isPostDeleted(postData: FirebaseFirestore.DocumentData): boolean {
  const searchData =
    postData.search && typeof postData.search === "object"
      ? postData.search
      : {};

  return (
    postData.isDeleted === true ||
    searchData.isDeleted === true ||
    Boolean(postData.deletedAt)
  );
}

function isProfilePost(postData: FirebaseFirestore.DocumentData): boolean {
  return (
    postData.contextType === "profile" &&
    typeof postData.profileId === "string" &&
    postData.profileId.trim().length > 0 &&
    postData.authorId === postData.profileId
  );
}

async function userHasBlockedUser(
  tx: FirebaseFirestore.Transaction,
  blockerUid: string,
  blockedUid: string
): Promise<boolean> {
  if (!blockerUid.trim() || !blockedUid.trim()) {
    return false;
  }

  const snap = await tx.get(
    db.collection("users").doc(blockerUid).collection("blockedUsers").doc(blockedUid)
  );

  return snap.exists;
}

async function usersHaveBlockBetween(
  tx: FirebaseFirestore.Transaction,
  userA: string,
  userB: string
): Promise<boolean> {
  const [aBlockedB, bBlockedA] = await Promise.all([
    userHasBlockedUser(tx, userA, userB),
    userHasBlockedUser(tx, userB, userA),
  ]);

  return aBlockedB || bBlockedA;
}

async function assertUserCanSaveProfilePost(params: {
  tx: FirebaseFirestore.Transaction;
  uid: string;
  postData: FirebaseFirestore.DocumentData;
}): Promise<void> {
  const { tx, uid, postData } = params;

  const profileId =
    typeof postData.profileId === "string" ? postData.profileId.trim() : "";

  if (!profileId) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
  }

  if (postData.authorId === uid || profileId === uid) {
    return;
  }

  const profileRef = db.collection("users").doc(profileId);
  const profileSnap = await tx.get(profileRef);

  if (!profileSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
  }

  const profileData = profileSnap.data() ?? {};
  const showPosts = profileData.showPosts !== false;
  const profileRestricted = profileData.profileRestricted === true;

  if (!showPosts || profileRestricted) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
  }

  const blocked = await usersHaveBlockBetween(tx, uid, profileId);

  if (blocked) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
  }

  const accessModel =
    typeof postData.accessModel === "string" ? postData.accessModel : "free";

  if (
    accessModel !== "free" ||
    postData.requiresPayment === true ||
    postData.requiresSubscription === true
  ) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
  }
}

function isFreePublicGroupPost(postData: FirebaseFirestore.DocumentData): boolean {
  return (
    !isPostDeleted(postData) &&
    typeof postData.groupId === "string" &&
    postData.groupVisibility === "public" &&
    (postData.accessModel === undefined || postData.accessModel === "free") &&
    (postData.requiresPayment === undefined ||
      postData.requiresPayment === false) &&
    (postData.requiresSubscription === undefined ||
      postData.requiresSubscription === false)
  );
}

async function assertUserCanSavePost(params: {
  tx: FirebaseFirestore.Transaction;
  uid: string;
  postData: FirebaseFirestore.DocumentData;
}): Promise<void> {
  const { tx, uid, postData } = params;

  if (isProfilePost(postData)) {
    await assertUserCanSaveProfilePost({
      tx,
      uid,
      postData,
    });

    return;
  }

  if (isFreePublicGroupPost(postData)) {
    return;
  }

  const groupId = typeof postData.groupId === "string" ? postData.groupId : null;

  if (!groupId) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
  }

  const groupRef = db.collection("groups").doc(groupId);
  const memberRef = groupRef.collection("members").doc(uid);

  const [groupSnap, memberSnap] = await Promise.all([
    tx.get(groupRef),
    tx.get(memberRef),
  ]);

  if (!groupSnap.exists) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
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
  const memberRole = normalizeMemberRole(
    memberData?.roleInGroup ?? memberData?.role
  );

  const isOwner = ownerId === uid;
  const isModerator =
    (memberRole === "mod" || memberRole === "moderator") &&
    isReadableMemberStatus(memberStatus);

  const isMember = isReadableMemberStatus(memberStatus);
  const isAuthor = postData.authorId === uid;

  const canReadGroupContent =
    groupIsActive &&
    (groupVisibility === "public" || isMember || isOwner || isModerator);

  if (!canReadGroupContent && !isAuthor) {
    throw new HttpsError(
      "permission-denied",
      "No tienes acceso a esta publicación."
    );
  }

  if (memberStatus === "banned" || memberStatus === "removed") {
    throw new HttpsError(
      "permission-denied",
      "No puedes guardar publicaciones de este grupo."
    );
  }
}

export const togglePostSave = onCall<TogglePostSavePayload>(
  {
    region: "us-central1",
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para guardar publicaciones."
      );
    }

    const postId = normalizePostId(request.data?.postId);

    const postRef = db.collection("posts").doc(postId);
    const saveRef = postRef.collection("saves").doc(uid);
    const userSavedPostRef = db
      .collection("users")
      .doc(uid)
      .collection("savedPosts")
      .doc(postId);

    return db.runTransaction(async (tx) => {
      const [postSnap, saveSnap, userSavedPostSnap] = await Promise.all([
        tx.get(postRef),
        tx.get(saveRef),
        tx.get(userSavedPostRef),
      ]);

      if (!postSnap.exists) {
        throw new HttpsError("not-found", "La publicación no existe.");
      }

      const postData = postSnap.data() ?? {};

      if (isPostDeleted(postData)) {
        throw new HttpsError(
          "failed-precondition",
          "No puedes guardar una publicación eliminada."
        );
      }

      const now = FieldValue.serverTimestamp();
      const currentSaves = getCurrentSaveCount(postData);
      const alreadySaved = saveSnap.exists || userSavedPostSnap.exists;

      if (alreadySaved) {
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

      tx.set(
        saveRef,
        {
          postId,
          userId: uid,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

tx.set(
  userSavedPostRef,
  {
    postId,
    userId: uid,
    contextType:
      postData.contextType === "profile" ? "profile" : "group",
    groupId: typeof postData.groupId === "string" ? postData.groupId : null,
    profileId:
      typeof postData.profileId === "string" ? postData.profileId : null,
    authorId:
      typeof postData.authorId === "string" ? postData.authorId : null,
    savedAt: now,
    postCreatedAt: postData.createdAt ?? null,
    isVisible: true,
    isDeleted: false,
    groupVisibility:
      typeof postData.groupVisibility === "string"
        ? postData.groupVisibility
        : null,
    profileRestricted: postData.profileRestricted === true,
    accessModel:
      typeof postData.accessModel === "string"
        ? postData.accessModel
        : "free",
    requiresPayment: postData.requiresPayment === true,
    requiresSubscription: postData.requiresSubscription === true,
    updatedAt: now,
    version: 1,
  },
  { merge: true }
);

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
  }
);

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

    const beforeDeleted = isPostDeleted(beforeData);
    const afterDeleted = isPostDeleted(afterData);

    if (beforeDeleted || !afterDeleted) {
      return;
    }

    const postId = event.params.postId;

    const savedPostsSnap = await db
      .collectionGroup("savedPosts")
      .where("postId", "==", postId)
      .get();

    const batches = [];

    for (let i = 0; i < savedPostsSnap.docs.length; i += 450) {
      const batch = db.batch();

      savedPostsSnap.docs.slice(i, i + 450).forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      batches.push(batch.commit());
    }

    await Promise.all(batches);
  }
);

/**
 * Backfill: sincroniza users/{uid}/savedPosts/{postId} a partir de
 * posts/{postId}/saves/{uid}. Solo puede llamarlo el admin autenticado.
 *
 * Casos que repara:
 * 1. El doc users/{uid}/savedPosts/{postId} no existe (save viejo).
 * 2. El doc existe pero le falta el campo savedAt (orderBy lo excluye).
 */
export const backfillSavedPosts = onCall(
  { region: "us-central1", timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    // Claim de moderador + sesión de Google + correo del dueño. Antes bastaba
    // el correo: quien lograra registrar esa dirección en Firebase Auth heredaba
    // el permiso, sin rol ni segundo factor.
    requirePlatformOwner(request);

    const savesSnap = await db.collectionGroup("saves").get();

    let created = 0;
    let patched = 0;
    let skipped = 0;
    let errors = 0;

    for (const saveDoc of savesSnap.docs) {
      try {
        // path: posts/{postId}/saves/{uid}
        const parts = saveDoc.ref.path.split("/");
        if (parts.length < 4 || parts[0] !== "posts" || parts[2] !== "saves") {
          skipped++;
          continue;
        }

        const postId = parts[1];
        const uid = parts[3];

        if (!postId || !uid) {
          skipped++;
          continue;
        }

        const userSavedRef = db
          .collection("users")
          .doc(uid)
          .collection("savedPosts")
          .doc(postId);

        const userSavedSnap = await userSavedRef.get();

        // Already has savedAt — nothing to do
        if (userSavedSnap.exists) {
          const data = userSavedSnap.data() ?? {};
          if (data.savedAt instanceof Timestamp) {
            skipped++;
            continue;
          }
        }

        // Need post data to populate the savedPosts doc
        const postSnap = await db.collection("posts").doc(postId).get();
        if (!postSnap.exists) {
          skipped++;
          continue;
        }

        const postData = postSnap.data() ?? {};

        // Skip soft-deleted posts
        if (
          postData.isDeleted === true ||
          postData.deletedAt != null ||
          postData.search?.isDeleted === true
        ) {
          skipped++;
          continue;
        }

        const saveData = saveDoc.data();
        const savedAt =
          saveData.createdAt instanceof Timestamp
            ? saveData.createdAt
            : FieldValue.serverTimestamp();

        const payload: Record<string, unknown> = {
          postId,
          userId: uid,
          contextType:
            postData.contextType === "profile" ? "profile" : "group",
          groupId:
            typeof postData.groupId === "string" ? postData.groupId : null,
          profileId:
            typeof postData.profileId === "string"
              ? postData.profileId
              : null,
          authorId:
            typeof postData.authorId === "string" ? postData.authorId : null,
          postCreatedAt: postData.createdAt ?? null,
          isVisible: true,
          isDeleted: false,
          groupVisibility:
            typeof postData.groupVisibility === "string"
              ? postData.groupVisibility
              : null,
          profileRestricted: postData.profileRestricted === true,
          accessModel:
            typeof postData.accessModel === "string"
              ? postData.accessModel
              : "free",
          requiresPayment: postData.requiresPayment === true,
          requiresSubscription: postData.requiresSubscription === true,
          updatedAt: FieldValue.serverTimestamp(),
          version: 1,
        };

        if (!userSavedSnap.exists) {
          // Doc missing entirely — set all fields including savedAt
          await userSavedRef.set({ ...payload, savedAt }, { merge: true });
          created++;
        } else {
          // Doc exists but savedAt is missing/wrong — patch only savedAt
          await userSavedRef.update({ savedAt, updatedAt: FieldValue.serverTimestamp() });
          patched++;
        }
      } catch (err) {
        console.error("[backfillSavedPosts] error on doc", saveDoc.ref.path, err);
        errors++;
      }
    }

    const summary = {
      total: savesSnap.size,
      created,
      patched,
      skipped,
      errors,
    };

    console.log("[backfillSavedPosts] done", summary);
    return summary;
  }
);