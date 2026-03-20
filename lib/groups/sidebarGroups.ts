import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type HiddenJoinedGroup = {
  id: string;
  name?: string | null;
  ownerId?: string | null;
  visibility?: "hidden" | string | null;
  avatarUrl?: string | null;
  memberStatus?: "active" | "muted" | "banned" | "removed" | null;
  monetization?: {
    isPaid?: boolean;
    priceMonthly?: number | null;
    currency?: "MXN" | "USD" | null;
  } | null;
  offerings?: Array<{
    type: string;
    enabled?: boolean;
    price?: number | null;
    currency?: "MXN" | "USD" | null;
  }>;
};

type GetMyHiddenJoinedGroupsResult = {
  success: boolean;
  groups: HiddenJoinedGroup[];
};

export async function getMyHiddenJoinedGroups(): Promise<HiddenJoinedGroup[]> {
  const fn = httpsCallable<any, GetMyHiddenJoinedGroupsResult>(
    functions,
    "getMyHiddenJoinedGroups"
  );

  const res = await fn({});
  return Array.isArray(res.data?.groups) ? res.data.groups : [];
}