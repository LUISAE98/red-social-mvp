"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";

import type { Comment, Post } from "@/lib/posts/types";
import {
  createPostComment,
  deletePostComment,
  fetchPostComments,
  fetchUserProfilePosts,
  softDeletePost,
} from "@/lib/posts/post-service";

import { db } from "@/lib/firebase";
import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import GroupRecommendationsRail from "@/app/components/GroupRecommendations/GroupRecommendationsRail";
import { buildRandomRecommendationSlots } from "@/app/components/GroupRecommendations/recommendation-engine";

type ProfilePostsFeedProps = {
  profileUid: string;
  viewerUid: string | null;
  isOwner: boolean;
  showPosts?: boolean;
};

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;
type GroupRole = "owner" | "mod" | "member" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: any;
};

function normalizeRole(raw: unknown): GroupRole {
  if (raw === "owner") return "owner";
  if (raw === "mod") return "mod";
  if (raw === "moderator") return "mod";
  if (raw === "member") return "member";
  return null;
}

function normalizeStatus(raw: unknown): MemberStatus {
  if (raw === "banned") return "banned";
  if (raw === "muted") return "muted";
  if (raw === "removed" || raw === "kicked" || raw === "expelled") {
    return "removed";
  }
  if (raw === "active") return "active";
  return "active";
}

async function getMembershipMetaForGroup(
  groupId: string,
  userId: string
): Promise<{
  status: MemberStatus;
  mutedUntil: any | null;
  role: GroupRole;
}> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      return { status: null, mutedUntil: null, role: null };
    }

    const data = memberSnap.data() as any;

    return {
      status: normalizeStatus(data?.status),
      mutedUntil: data?.mutedUntil ?? null,
      role: normalizeRole(data?.roleInGroup ?? data?.role),
    };
  } catch {
    return { status: null, mutedUntil: null, role: null };
  }
}

async function getViewerCanModerateGroup(
  groupId: string,
  viewerUid: string
): Promise<boolean> {
  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    if (!groupSnap.exists()) return false;

    const groupData = groupSnap.data() as any;
    if (groupData?.ownerId === viewerUid) {
      return true;
    }

    const viewerMeta = await getMembershipMetaForGroup(groupId, viewerUid);
    return (
      viewerMeta.role === "mod" &&
      viewerMeta.status !== "banned" &&
      viewerMeta.status !== "removed"
    );
  } catch {
    return false;
  }
}

async function filterBannedGroupPosts(
  inputPosts: Post[],
  currentViewerUid: string | null
): Promise<Post[]> {
  if (!currentViewerUid || inputPosts.length === 0) {
    return inputPosts;
  }

  const uniqueGroupIds = Array.from(
    new Set(
      inputPosts
        .map((post) => post.groupId)
        .filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && groupId.trim().length > 0
        )
    )
  );

  if (uniqueGroupIds.length === 0) {
    return inputPosts;
  }

  const membershipChecks = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const meta = await getMembershipMetaForGroup(groupId, currentViewerUid);
      return [groupId, meta.status === "banned"] as const;
    })
  );

  const bannedByGroupId = new Map<string, boolean>(membershipChecks);

  return inputPosts.filter((post) => {
    const groupId =
      typeof post.groupId === "string" && post.groupId.trim().length > 0
        ? post.groupId
        : null;

    if (!groupId) return true;
    return bannedByGroupId.get(groupId) !== true;
  });
}

async function attachModerationFlags(
  posts: Post[],
  currentViewerUid: string | null
): Promise<PostWithFlags[]> {
  if (!currentViewerUid || posts.length === 0) {
    return posts as PostWithFlags[];
  }

  const uniqueGroupIds = Array.from(
    new Set(
      posts
        .map((post) => post.groupId)
        .filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && groupId.trim().length > 0
        )
    )
  );

  if (uniqueGroupIds.length === 0) {
    return posts as PostWithFlags[];
  }

  const moderationEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const canModerate = await getViewerCanModerateGroup(groupId, currentViewerUid);
      return [groupId, canModerate] as const;
    })
  );

  const moderationMap = new Map<string, boolean>(moderationEntries);

  const authorPairs = Array.from(
    new Set(
      posts
        .filter(
          (post) =>
            typeof post.groupId === "string" &&
            post.groupId.trim().length > 0 &&
            typeof post.authorId === "string" &&
            post.authorId.trim().length > 0
        )
        .map((post) => `${post.groupId}__${post.authorId}`)
    )
  );

  const authorEntries = await Promise.all(
    authorPairs.map(async (pairKey) => {
      const separatorIndex = pairKey.indexOf("__");
      const groupId = pairKey.slice(0, separatorIndex);
      const authorId = pairKey.slice(separatorIndex + 2);
      const meta = await getMembershipMetaForGroup(groupId, authorId);
      return [pairKey, meta] as const;
    })
  );

  const authorMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: any | null; role: GroupRole }
  >(authorEntries);

  return posts.map((post) => {
    const groupId =
      typeof post.groupId === "string" && post.groupId.trim().length > 0
        ? post.groupId
        : null;

    const authorId =
      typeof post.authorId === "string" && post.authorId.trim().length > 0
        ? post.authorId
        : null;

    const authorMeta =
      groupId && authorId ? authorMap.get(`${groupId}__${authorId}`) : null;

    return {
      ...post,
      canModerateGroupAuthor: !!groupId && moderationMap.get(groupId) === true,
      authorMemberStatus: authorMeta?.status ?? null,
      authorMutedUntil: authorMeta?.mutedUntil ?? null,
    };
  });
}

function buildStableFeedSeed(
  baseId: string,
  posts: Array<{ id?: string; createdAt?: any }>
): number {
  const raw = [
    baseId,
    ...posts.map((post, index) => {
      const createdAtValue =
        typeof post?.createdAt?.toMillis === "function"
          ? String(post.createdAt.toMillis())
          : typeof post?.createdAt === "number"
          ? String(post.createdAt)
          : typeof post?.createdAt === "string"
          ? post.createdAt
          : String(index);

      return `${post.id ?? index}-${createdAtValue}`;
    }),
  ].join("|");

  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }

  return hash || 1;
}

export default function ProfilePostsFeed({
  profileUid,
  viewerUid,
  isOwner,
  showPosts = true,
}: ProfilePostsFeedProps) {
  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 900px)");

    const sync = () => setIsMobile(mediaQuery.matches);
    sync();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", sync);
      return () => mediaQuery.removeEventListener("change", sync);
    }

    mediaQuery.addListener(sync);
    return () => mediaQuery.removeListener(sync);
  }, []);

  async function loadPosts() {
    const nextPosts = await fetchUserProfilePosts(profileUid, viewerUid);
    const visiblePosts = await filterBannedGroupPosts(nextPosts, viewerUid);
    const hydratedPosts = await attachModerationFlags(visiblePosts, viewerUid);
    setPosts(hydratedPosts);
  }

  useEffect(() => {
    let active = true;

    async function run() {
      if (!profileUid) {
        if (active) {
          setPosts([]);
          setLoadingInitial(false);
        }
        return;
      }

      if (!showPosts && !isOwner) {
        if (active) {
          setPosts([]);
          setLoadingInitial(false);
          setError(null);
        }
        return;
      }

      try {
        setLoadingInitial(true);
        setError(null);

        const nextPosts = await fetchUserProfilePosts(profileUid, viewerUid);
        const visiblePosts = await filterBannedGroupPosts(nextPosts, viewerUid);
        const hydratedPosts = await attachModerationFlags(visiblePosts, viewerUid);

        if (!active) return;
        setPosts(hydratedPosts);
      } catch (e: any) {
        if (!active) return;
        setError(e?.message ?? "Error desconocido");
      } finally {
        if (active) setLoadingInitial(false);
      }
    }

    run();

    return () => {
      active = false;
    };
  }, [profileUid, viewerUid, showPosts, isOwner]);

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);
      await loadPosts();
    } catch (e: any) {
      setError(e?.message ?? "Error desconocido");
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: any) {
      setError(e?.message ?? "Error desconocido");
      throw e;
    }
  }

  async function handleCreateComment(
    postId: string,
    text: string
  ): Promise<Comment[]> {
    try {
      setError(null);
      await createPostComment({ postId, text });
      return await fetchPostComments(postId);
    } catch (e: any) {
      setError(e?.message ?? "Error desconocido");
      throw e;
    }
  }

  async function handleDeleteComment(
    postId: string,
    commentId: string
  ): Promise<Comment[]> {
    try {
      setError(null);
      await deletePostComment({ postId, commentId });
      return await fetchPostComments(postId);
    } catch (e: any) {
      setError(e?.message ?? "Error desconocido");
      throw e;
    }
  }

  const shellStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    display: "grid",
    gap: 12,
    marginTop: 16,
    overflowX: "hidden",
  };

  const headerStyle: CSSProperties = useMemo(
    () => ({
      display: "grid",
      gap: 4,
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      paddingLeft: isMobile ? 8 : 0,
      paddingRight: isMobile ? 8 : 0,
      boxSizing: "border-box",
    }),
    [isMobile]
  );

  const noticeStyle: CSSProperties = useMemo(
    () => ({
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      boxSizing: "border-box",
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.10)",
      background: "rgba(255,255,255,0.03)",
      padding: "12px 14px",
      fontSize: 13,
      fontWeight: 300,
      lineHeight: 1.45,
      color: "rgba(255,255,255,0.82)",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      marginLeft: 0,
      marginRight: 0,
    }),
    []
  );

  const reservedStyle: CSSProperties = useMemo(
    () => ({
      ...noticeStyle,
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(255,255,255,0.05)",
      padding: "18px 16px",
      textAlign: "center",
      fontSize: 14,
      fontWeight: 500,
      color: "#fff",
    }),
    [noticeStyle]
  );

  const titleStyle: CSSProperties = {
    margin: 0,
    maxWidth: "100%",
    minWidth: 0,
    fontSize: "clamp(16px, 2vw, 18px)",
    fontWeight: 600,
    lineHeight: 1.1,
    color: "#fff",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const subtitleStyle: CSSProperties = {
    margin: 0,
    maxWidth: "100%",
    minWidth: 0,
    fontSize: 12,
    color: "rgba(255,255,255,0.60)",
    lineHeight: 1.4,
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const postItemStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  const recommendationWrapperStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  const recommendationSlots = useMemo(() => {
    if (!viewerUid || posts.length === 0) {
      return new Set<number>();
    }

    const seed = buildStableFeedSeed(`${profileUid}:${viewerUid}`, posts);
    return buildRandomRecommendationSlots(posts.length, seed);
  }, [profileUid, viewerUid, posts]);

  const hasInlineRecommendation = useMemo(() => {
    return recommendationSlots.size > 0;
  }, [recommendationSlots]);

  if (!showPosts && !isOwner) {
    return (
      <section style={shellStyle}>
        <div style={reservedStyle}>Perfil reservado</div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Publicaciones</h2>
        <p style={subtitleStyle}>
          Feed del perfil ordenado por antigüedad inversa.
        </p>
      </div>

      {error && <div style={noticeStyle}>{error}</div>}

      {loadingInitial && <div style={noticeStyle}>Cargando publicaciones...</div>}

      {!loadingInitial && posts.length === 0 && viewerUid && (
        <div style={recommendationWrapperStyle}>
          <GroupRecommendationsRail
            currentUserId={viewerUid}
            context="profile"
          />
        </div>
      )}

      {!loadingInitial && posts.length === 0 && !viewerUid && (
        <div style={noticeStyle}>
          Todavía no hay publicaciones visibles en este perfil.
        </div>
      )}

      {posts.map((post, index) => {
        const canDeletePost =
          viewerUid === post.authorId || post.canModerateGroupAuthor === true;

        const shouldRenderRecommendations = recommendationSlots.has(index + 1);

        return (
          <div key={post.id} style={postItemStyle}>
            <GroupPostCard
              post={post}
              canDelete={canDeletePost}
              onDelete={canDeletePost ? handleDeletePost : undefined}
              onLoadComments={handleLoadComments}
              onCreateComment={handleCreateComment}
              onDeleteComment={handleDeleteComment}
              currentUserId={viewerUid}
              isOwner={false}
              isModerator={post.canModerateGroupAuthor === true}
              showGroupContext={true}
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={loadPosts}
            />

            {shouldRenderRecommendations && viewerUid && (
              <div style={recommendationWrapperStyle}>
                <GroupRecommendationsRail
                  currentUserId={viewerUid}
                  context="profile"
                />
              </div>
            )}
          </div>
        );
      })}

      {!loadingInitial && posts.length > 0 && !hasInlineRecommendation && viewerUid && (
        <div style={recommendationWrapperStyle}>
          <GroupRecommendationsRail
            currentUserId={viewerUid}
            context="profile"
          />
        </div>
      )}
    </section>
  );
}