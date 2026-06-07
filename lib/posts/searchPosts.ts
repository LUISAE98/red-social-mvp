// searchPosts

import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
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
const MAX_READABLE_GROUP_IDS_FOR_MVP = 30;
const MAX_FIRESTORE_DISJUNCTIONS = 30;
const MAX_IN_VALUES = 10;

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

function withCursor(
  constraints: QueryConstraint[],
  cursor?: SearchPostsCursor | null
): QueryConstraint[] {
  if (!cursor?.lastDoc) return constraints;
  return [...constraints, startAfter(cursor.lastDoc)];
}

function getDocCreatedAtMs(docSnap: QueryDocumentSnapshot<DocumentData>): number {
  const data = docSnap.data() as Record<string, any>;
  const value = data?.search?.createdAt ?? data?.createdAt;

  if (value && typeof value.toMillis === "function") {
    return value.toMillis();
  }

  if (value && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  return 0;
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

function dedupeDocs(
  docs: QueryDocumentSnapshot<DocumentData>[]
): QueryDocumentSnapshot<DocumentData>[] {
  const map = new Map<string, QueryDocumentSnapshot<DocumentData>>();

  for (const docSnap of docs) {
    map.set(docSnap.id, docSnap);
  }

  return Array.from(map.values());
}

function dedupePosts(posts: Post[]): Post[] {
  const map = new Map<string, Post>();

  for (const post of posts) {
    map.set(post.id, post);
  }

  return Array.from(map.values());
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function getGroupIdChunkSize(prefixCount: number): number {
  const safePrefixCount = Math.max(1, prefixCount);

  return Math.max(
    1,
    Math.min(MAX_IN_VALUES, Math.floor(MAX_FIRESTORE_DISJUNCTIONS / safePrefixCount))
  );
}

function mapDocToPost(docSnap: QueryDocumentSnapshot<DocumentData>): Post {
  const data = docSnap.data() as Omit<Post, "id"> & Record<string, any>;
  const search =
    data.search && typeof data.search === "object"
      ? (data.search as Record<string, any>)
      : {};

  return {
    id: docSnap.id,
    ...data,
    groupName: data.groupName ?? search.groupName ?? null,
    groupAvatarUrl: data.groupAvatarUrl ?? search.groupAvatarUrl ?? null,
    groupVisibility:
      data.groupVisibility ?? search.groupVisibility ?? search.visibility ?? null,
  } as Post;
}

async function fetchReadableGroupIds(viewerId?: string | null): Promise<string[]> {
  if (!viewerId) return [];

  const readableStatuses = new Set(["active", "subscribed", "muted"]);

  let userMembershipGroupIds: string[] = [];
  let ownedGroupIds: string[] = [];

  try {
    const userMembershipSnap = await getDocs(
      collection(db, "users", viewerId, "groupMemberships")
    );

    userMembershipGroupIds = userMembershipSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, unknown>;

        const groupId =
          typeof data.groupId === "string" && data.groupId.trim().length > 0
            ? data.groupId.trim()
            : docSnap.id;

        const status = typeof data.status === "string" ? data.status : "active";

        return readableStatuses.has(status) ? groupId : null;
      })
      .filter((groupId): groupId is string => Boolean(groupId));
  } catch {
    userMembershipGroupIds = [];
  }

  try {
    const ownedGroupsSnap = await getDocs(
      query(collection(db, "groups"), where("ownerId", "==", viewerId))
    );

    ownedGroupIds = ownedGroupsSnap.docs.map((docSnap) => docSnap.id);
  } catch {
    ownedGroupIds = [];
  }

  return Array.from(new Set([...userMembershipGroupIds, ...ownedGroupIds])).slice(
    0,
    MAX_READABLE_GROUP_IDS_FOR_MVP
  );
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

  let publicDocs: QueryDocumentSnapshot<DocumentData>[] = [];
  let profileDocs: QueryDocumentSnapshot<DocumentData>[] = [];
  let memberDocs: QueryDocumentSnapshot<DocumentData>[] = [];

  try {
    const publicSnap = await getDocs(
      query(
        collection(db, "posts"),
        ...searchConstraints,
        where("groupVisibility", "==", "public"),
        where("isShareable", "==", true),
        where("search.visibility", "==", "public"),
        ...withCursor([orderBy("search.createdAt", "desc")], params.cursor),
        limit(pageSize + 1)
      )
    );

    publicDocs = publicSnap.docs;
  } catch (error) {
    console.error("[searchPosts] public posts search failed", error);
    publicDocs = [];
  }

  try {
    const profileSnap = await getDocs(
      query(
        collection(db, "posts"),
        ...searchConstraints,
        where("contextType", "==", "profile"),
        where("profileRestricted", "==", false),
        where("search.visibility", "==", "public"),
        ...withCursor([orderBy("search.createdAt", "desc")], params.cursor),
        limit(pageSize + 1)
      )
    );

    profileDocs = profileSnap.docs;
  } catch (error) {
    console.error("[searchPosts] profile posts search failed", error);
    profileDocs = [];
  }

  const readableGroupIds = await fetchReadableGroupIds(params.viewerId);

  if (readableGroupIds.length > 0) {
    const groupIdChunkSize = getGroupIdChunkSize(prefixes.length);
    const groupIdChunks = chunkArray(readableGroupIds, groupIdChunkSize);

    const memberSnaps = await Promise.all(
      groupIdChunks.map(async (groupIds) => {
        try {
          return await getDocs(
            query(
              collection(db, "posts"),
              ...searchConstraints,
              where("groupId", "in", groupIds),
              ...withCursor([orderBy("search.createdAt", "desc")], params.cursor),
              limit(pageSize + 1)
            )
          );
        } catch (error) {
          console.error("[searchPosts] member posts search failed", error);
          return null;
        }
      })
    );

    memberDocs = memberSnaps.flatMap((snap) => (snap ? snap.docs : []));
  }

  const sortedDocs = dedupeDocs([...publicDocs, ...profileDocs, ...memberDocs]).sort(
    (a, b) => getDocCreatedAtMs(b) - getDocCreatedAtMs(a)
  );

  const pageDocs = sortedDocs.slice(0, pageSize);

  const posts = dedupePosts(pageDocs.map(mapDocToPost))
    .sort((a, b) => getPostCreatedAtMs(b) - getPostCreatedAtMs(a))
    .slice(0, pageSize);

  return {
    posts,
    cursor: pageDocs.length > 0 ? { lastDoc: pageDocs[pageDocs.length - 1] } : null,
    hasMore: sortedDocs.length > pageSize,
  };
}