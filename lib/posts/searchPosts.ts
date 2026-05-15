import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  Timestamp,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  buildSearchPrefixes,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/lib/search/normalize";
import type { Post } from "./types";

export type SearchPostsCursor = {
  lastDoc: QueryDocumentSnapshot<DocumentData> | null;
};

export type SearchPostsParams = {
  search: string;
  pageSize?: number;
  cursor?: SearchPostsCursor | null;
  fromDate?: Date | null;
  toDate?: Date | null;
  viewerId?: string | null;
};

export type SearchPostsResult = {
  posts: Post[];
  cursor: SearchPostsCursor | null;
  hasMore: boolean;
};

const MIN_POST_SEARCH_LENGTH = 2;
const MAX_POST_SEARCH_PREFIXES = 10;
const DEFAULT_POST_SEARCH_PAGE_SIZE = 20;
const MAX_POST_SEARCH_PAGE_SIZE = 30;

type GroupSummary = {
  name: string | null;
  avatarUrl: string | null;
  visibility: "public" | "private" | "hidden" | null;
};

function buildSearchQueryPrefixes(search: string): string[] {
  const normalized = normalizeSearchText(search);
  const tokens = tokenizeSearchText(normalized);

  return buildSearchPrefixes(tokens, {
    minLength: MIN_POST_SEARCH_LENGTH,
    maxLength: 20,
    maxPrefixes: MAX_POST_SEARCH_PREFIXES,
  });
}

function normalizePageSize(pageSize?: number): number {
  return Math.max(
    1,
    Math.min(pageSize ?? DEFAULT_POST_SEARCH_PAGE_SIZE, MAX_POST_SEARCH_PAGE_SIZE)
  );
}

function toTimestamp(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getPostCreatedAtMs(post: Post): number {
  const value = (post as any)?.search?.createdAt ?? (post as any)?.createdAt;

  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  return 0;
}

function dedupePosts(posts: Post[]): Post[] {
  const map = new Map<string, Post>();

  for (const post of posts) {
    map.set(post.id, post);
  }

  return Array.from(map.values());
}

async function fetchReadableGroupIds(viewerId?: string | null): Promise<string[]> {
  if (!viewerId) return [];

  const membershipSnap = await getDocs(
    query(collection(db, "users", viewerId, "groupMemberships"))
  );

  const memberGroupIds = membershipSnap.docs
    .map((docSnap) => {
      const data = docSnap.data() as Record<string, unknown>;

      const groupId =
        typeof data.groupId === "string" && data.groupId.trim().length > 0
          ? data.groupId.trim()
          : docSnap.id;

      const status = data.status;

      if (
        status !== "active" &&
        status !== "subscribed" &&
        status !== "muted"
      ) {
        return null;
      }

      return groupId;
    })
    .filter((groupId): groupId is string => Boolean(groupId));

  const ownedGroupsSnap = await getDocs(
    query(collection(db, "groups"), where("ownerId", "==", viewerId))
  );

  const ownedGroupIds = ownedGroupsSnap.docs.map((docSnap) => docSnap.id);

  return Array.from(new Set([...memberGroupIds, ...ownedGroupIds]));
}

async function fetchSearchGroupsByIds(
  groupIds: string[]
): Promise<Record<string, GroupSummary>> {
  const uniqueIds = Array.from(new Set(groupIds.filter(Boolean)));

  const entries = await Promise.all(
    uniqueIds.map(async (groupId) => {
      try {
        const snap = await getDoc(doc(db, "groups", groupId));

        if (!snap.exists()) {
          return [groupId, { name: null, avatarUrl: null, visibility: null }] as const;
        }

        const data = snap.data() as Record<string, unknown>;

        return [
          groupId,
          {
            name: pickString(data.name) || pickString(data.groupName),
            avatarUrl:
              pickString(data.avatarUrl) ||
              pickString(data.imageUrl) ||
              pickString(data.photoURL) ||
              pickString(data.groupAvatarUrl),
            visibility:
              data.visibility === "public" ||
              data.visibility === "private" ||
              data.visibility === "hidden"
                ? data.visibility
                : null,
          },
        ] as const;
      } catch {
        return [groupId, { name: null, avatarUrl: null, visibility: null }] as const;
      }
    })
  );

  return Object.fromEntries(entries);
}

function hydratePostsWithGroups(
  posts: Post[],
  groupMap: Record<string, GroupSummary>
): Post[] {
  return posts.map((post) => {
    const group = groupMap[post.groupId];

    return {
      ...post,
      groupName: group?.name ?? post.groupName ?? null,
      groupAvatarUrl: group?.avatarUrl ?? post.groupAvatarUrl ?? null,
      groupVisibility: group?.visibility ?? post.groupVisibility ?? null,
    };
  });
}

export async function searchPosts(
  params: SearchPostsParams
): Promise<SearchPostsResult> {
  const normalizedSearch = normalizeSearchText(params.search);

  if (normalizedSearch.length < MIN_POST_SEARCH_LENGTH) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  const prefixes = buildSearchQueryPrefixes(normalizedSearch);

  if (!prefixes.length) {
    return {
      posts: [],
      cursor: null,
      hasMore: false,
    };
  }

  const pageSize = normalizePageSize(params.pageSize);

  const searchConstraints: QueryConstraint[] = [
    where("isDeleted", "==", false),
    where("search.isDeleted", "==", false),
    where("search.prefixes", "array-contains-any", prefixes),
  ];

  if (params.fromDate) {
    searchConstraints.push(where("search.createdAt", ">=", toTimestamp(params.fromDate)));
  }

  if (params.toDate) {
    searchConstraints.push(where("search.createdAt", "<=", toTimestamp(params.toDate)));
  }

  const publicSnap = await getDocs(
    query(
      collection(db, "posts"),
      ...searchConstraints,
      where("groupVisibility", "==", "public"),
      where("isShareable", "==", true),
      where("accessModel", "==", "free"),
      where("requiresPayment", "==", false),
      where("requiresSubscription", "==", false),
      where("search.visibility", "==", "public"),
      orderBy("search.createdAt", "desc"),
      limit(pageSize + 1)
    )
  );

  const readableGroupIds = await fetchReadableGroupIds(params.viewerId);

  console.log("[searchPosts diagnóstico] viewerId:", params.viewerId);
  console.log("[searchPosts diagnóstico] search:", normalizedSearch);
  console.log("[searchPosts diagnóstico] prefixes:", prefixes);
  console.log("[searchPosts diagnóstico] readableGroupIds:", readableGroupIds);
  console.log("[searchPosts diagnóstico] publicDocs:", publicSnap.docs.length);

  const memberSnaps = await Promise.all(
    readableGroupIds.map(async (groupId) => {
      try {
        console.log("[searchPosts diagnóstico] buscando grupo:", groupId);

        const snap = await getDocs(
          query(
            collection(db, "posts"),
            ...searchConstraints,
            where("groupId", "==", groupId),
            orderBy("search.createdAt", "desc"),
            limit(pageSize + 1)
          )
        );

        console.log(
          "[searchPosts diagnóstico] grupo:",
          groupId,
          "docs encontrados:",
          snap.docs.length
        );

        return snap;
      } catch (error) {
        console.warn("[searchPosts diagnóstico] grupo bloqueado:", groupId, error);
        return null;
      }
    })
  );

  const allDocs = [
    ...publicSnap.docs,
    ...memberSnaps.flatMap((snap) => (snap ? snap.docs : [])),
  ];

  const rawPosts: Post[] = dedupePosts(
    allDocs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<Post, "id">),
    }))
  )
    .sort((a, b) => getPostCreatedAtMs(b) - getPostCreatedAtMs(a))
    .slice(0, pageSize);

  const groupMap = await fetchSearchGroupsByIds(
    rawPosts.map((post) => post.groupId)
  );

  const posts = hydratePostsWithGroups(rawPosts, groupMap);

  console.log("[searchPosts diagnóstico] totalDocs:", allDocs.length);
  console.log("[searchPosts diagnóstico] postsFinales:", posts.length);

  return {
    posts,
    cursor: null,
    hasMore: allDocs.length > pageSize,
  };
}