import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export type SharedCommunity = {
  id: string;
  name: string;
  avatarUrl: string | null;
  imageUrl: string | null;
  coverUrl: string | null;
  visibility: string | null;
  ownerId: string | null;
  viewerRole: string | null;
  profileRole: string | null;
};

type GetSharedCommunitiesResponse = {
  communities: SharedCommunity[];
  total: number;
};

const getSharedCommunitiesWithProfileCallable = httpsCallable<
  { profileUid: string },
  GetSharedCommunitiesResponse
>(functions, "getSharedCommunitiesWithProfile");

export async function getSharedCommunitiesWithProfile(
  profileUid: string
): Promise<GetSharedCommunitiesResponse> {
  const normalizedProfileUid = profileUid.trim();

  if (!normalizedProfileUid) {
    return {
      communities: [],
      total: 0,
    };
  }

  const result = await getSharedCommunitiesWithProfileCallable({
    profileUid: normalizedProfileUid,
  });

  return {
    communities: Array.isArray(result.data.communities)
      ? result.data.communities
      : [],
    total:
      typeof result.data.total === "number"
        ? result.data.total
        : Array.isArray(result.data.communities)
          ? result.data.communities.length
          : 0,
  };
}