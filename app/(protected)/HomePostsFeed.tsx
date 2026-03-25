"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

import type { Comment, Post } from "@/lib/posts/types";
import {
  createPostComment,
  deletePostComment,
  fetchHomePosts,
  fetchPostComments,
  softDeletePost,
} from "@/lib/posts/post-service";

import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";

type HomePostsFeedProps = {
  currentUserId: string | null;
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
  currentUserId: string
): Promise<boolean> {
  try {
    const groupSnap = await getDoc(doc(db, "groups", groupId));
    if (!groupSnap.exists()) return false;

    const groupData = groupSnap.data() as any;
    if (groupData?.ownerId === currentUserId) {
      return true;
    }

    const viewerMeta = await getMembershipMetaForGroup(groupId, currentUserId);
    return (
      viewerMeta.role === "mod" &&
      viewerMeta.status !== "banned" &&
      viewerMeta.status !== "removed"
    );
  } catch {
    return false;
  }
}

async function filterOutHiddenHomePosts(
  posts: Post[],
  currentUserId: string
): Promise<Post[]> {
  if (!posts.length) return posts;

  const uniqueViewerGroupIds = Array.from(
    new Set(
      posts
        .map((post) => post.groupId)
        .filter((groupId): groupId is string => !!groupId)
    )
  );

  const viewerMembershipEntries = await Promise.all(
    uniqueViewerGroupIds.map(async (groupId) => {
      const meta = await getMembershipMetaForGroup(groupId, currentUserId);
      return [groupId, meta.status] as const;
    })
  );

  const viewerMembershipMap = new Map<string, MemberStatus>(
    viewerMembershipEntries
  );

  return posts.filter((post) => {
    const groupId = post.groupId;
    if (!groupId) return true;

    const viewerStatus = viewerMembershipMap.get(groupId) ?? null;
    if (viewerStatus === "banned") {
      return false;
    }

    return true;
  });
}

async function attachModerationFlags(
  posts: Post[],
  currentUserId: string
): Promise<PostWithFlags[]> {
  if (!posts.length) return posts as PostWithFlags[];

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

  const moderationEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      const canModerate = await getViewerCanModerateGroup(groupId, currentUserId);
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

export default function HomePostsFeed({ currentUserId }: HomePostsFeedProps) {
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
    if (!currentUserId) {
      setPosts([]);
      return;
    }

    const nextPosts = await fetchHomePosts(currentUserId);
    const visiblePosts = await filterOutHiddenHomePosts(nextPosts, currentUserId);
    const hydratedPosts = await attachModerationFlags(visiblePosts, currentUserId);

    setPosts(hydratedPosts);
  }

  useEffect(() => {
    let active = true;

    async function run() {
      if (!currentUserId) {
        if (active) {
          setPosts([]);
          setLoadingInitial(false);
        }
        return;
      }

      try {
        setLoadingInitial(true);
        setError(null);

        const nextPosts = await fetchHomePosts(currentUserId);
        const visiblePosts = await filterOutHiddenHomePosts(
          nextPosts,
          currentUserId
        );
        const hydratedPosts = await attachModerationFlags(
          visiblePosts,
          currentUserId
        );

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
  }, [currentUserId]);

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
    marginBottom: 18,
    overflowX: "hidden",
  };

  const headerStyle: CSSProperties = useMemo(
    () => ({
      display: "grid",
      gap: 4,
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      paddingLeft: isMobile ? 14 : 0,
      paddingRight: isMobile ? 14 : 0,
      boxSizing: "border-box",
    }),
    [isMobile]
  );

  const noticeStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.45,
    color: "rgba(255,255,255,0.82)",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };

  const postItemStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflowX: "hidden",
  };

  if (!currentUserId) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>
          Inicia sesión para ver publicaciones de tus comunidades.
        </div>
      </section>
    );
  }

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <h2
          style={{
            margin: 0,
            maxWidth: "100%",
            minWidth: 0,
            fontSize: "clamp(18px, 2.2vw, 20px)",
            fontWeight: 600,
            lineHeight: 1.1,
            color: "#fff",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          Inicio
        </h2>

        <p
          style={{
            margin: 0,
            maxWidth: "100%",
            minWidth: 0,
            fontSize: 12,
            color: "rgba(255,255,255,0.60)",
            lineHeight: 1.45,
            overflowWrap: "anywhere",
            wordBreak: "break-word",
          }}
        >
          Publicaciones recientes de comunidades donde ya estás dentro o eres owner.
        </p>
      </div>

      {error && <div style={noticeStyle}>{error}</div>}

      {loadingInitial && (
        <div style={noticeStyle}>Cargando publicaciones de tus comunidades...</div>
      )}

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>
          Aún no hay publicaciones en tus comunidades.
        </div>
      )}

      {posts.map((post) => {
        const canDeletePost =
          currentUserId === post.authorId ||
          post.canModerateGroupAuthor === true;

        return (
          <div key={post.id} style={postItemStyle}>
            <GroupPostCard
              post={post}
              canDelete={canDeletePost}
              onDelete={canDeletePost ? handleDeletePost : undefined}
              onLoadComments={handleLoadComments}
              onCreateComment={handleCreateComment}
              onDeleteComment={handleDeleteComment}
              currentUserId={currentUserId}
              isOwner={false}
              isModerator={post.canModerateGroupAuthor === true}
              showGroupContext={true}
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={loadPosts}
            />
          </div>
        );
      })}
    </section>
  );
}