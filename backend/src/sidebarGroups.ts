import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import * as admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore();

type MemberStatus =
  | "active"
  | "muted"
  | "banned"
  | "removed"
  | "kicked"
  | "expelled"
  | string
  | null;

function normalizeSidebarMemberStatus(raw: unknown): MemberStatus {
  if (raw === "active") return "active";
  if (raw === "muted") return "muted";
  if (raw === "banned") return "banned";
  if (raw === "removed") return "removed";
  if (raw === "kicked") return "kicked";
  if (raw === "expelled") return "expelled";
  return null;
}

function isVisibleJoinedStatus(status: MemberStatus) {
  return status === "active" || status === "muted" || status === "banned";
}

export const getMyHiddenJoinedGroups = onCall(async (request) => {
  const callerUid = request.auth?.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  }

  const membershipsSnap = await db
    .collectionGroup("members")
    .where("userId", "==", callerUid)
    .get();

  const rows = await Promise.all(
    membershipsSnap.docs.map(async (memberDoc) => {
      const memberData = memberDoc.data() as {
        userId?: string;
        roleInGroup?: string;
        status?: string;
      };

      const groupRef = memberDoc.ref.parent.parent;
      if (!groupRef) return null;

      const groupSnap = await groupRef.get();
      if (!groupSnap.exists) return null;

      const groupData = groupSnap.data() as {
        ownerId?: string;
        name?: string;
        visibility?: string;
        avatarUrl?: string | null;
        monetization?: {
          isPaid?: boolean;
          priceMonthly?: number | null;
          currency?: "MXN" | "USD" | null;
        };
        offerings?: Array<{
          type: string;
          enabled?: boolean;
          price?: number | null;
          currency?: "MXN" | "USD" | null;
        }>;
      };

      if (groupData?.ownerId === callerUid) return null;
      if (groupData?.visibility !== "hidden") return null;

      const memberStatus = normalizeSidebarMemberStatus(
        memberData?.status ?? "active"
      );

      if (!isVisibleJoinedStatus(memberStatus)) return null;

      return {
        id: groupSnap.id,
        name: groupData?.name ?? null,
        ownerId: groupData?.ownerId ?? null,
        visibility: groupData?.visibility ?? null,
        avatarUrl: groupData?.avatarUrl ?? null,
        memberStatus,
        monetization: groupData?.monetization ?? null,
        offerings: Array.isArray(groupData?.offerings)
          ? groupData.offerings
          : [],
      };
    })
  );

  return {
    success: true,
    groups: rows.filter(Boolean),
  };
});