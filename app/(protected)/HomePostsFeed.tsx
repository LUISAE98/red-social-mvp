"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
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

type MemberStatus = "active" | "muted" | "banned" | null;

type PostWithFlags = Post & {
  canModerateGroupAuthor?: boolean;
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: any;
};

async function getMembershipStatusForGroup(
  groupId: string,
  userId: string
): Promise<{ status: MemberStatus; mutedUntil: any | null }> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) return { status: null, mutedUntil: null };

    const data = memberSnap.data() as any;
    const rawStatus = data?.status;

    return {
      status:
        rawStatus === "banned"
          ? "banned"
          : rawStatus === "muted"
          ? "muted"
          : "active",
      mutedUntil: data?.mutedUntil ?? null,
    };
  } catch {
    return { status: null, mutedUntil: null };
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
      const meta = await getMembershipStatusForGroup(groupId, currentUserId);
      return [groupId, meta.status] as const;
    })
  );

  const viewerMembershipMap = new Map<string, MemberStatus>(
    viewerMembershipEntries
  );

  const authorGroupPairs = Array.from(
    new Set(
      posts
        .filter(
          (post) =>
            !!post.groupId &&
            typeof post.authorId === "string" &&
            post.authorId.trim().length > 0
        )
        .map((post) => `${post.groupId}__${post.authorId}`)
    )
  );

  const authorMembershipEntries = await Promise.all(
    authorGroupPairs.map(async (pairKey) => {
      const separatorIndex = pairKey.indexOf("__");
      const groupId = pairKey.slice(0, separatorIndex);
      const authorId = pairKey.slice(separatorIndex + 2);

      const meta = await getMembershipStatusForGroup(groupId, authorId);
      return [pairKey, meta.status] as const;
    })
  );

  const authorMembershipMap = new Map<string, MemberStatus>(
    authorMembershipEntries
  );

  return posts.filter((post) => {
    const groupId = post.groupId;
    if (!groupId) return true;

    const viewerStatus = viewerMembershipMap.get(groupId) ?? null;
    if (viewerStatus === "banned") {
      return false;
    }

    const authorId =
      typeof post.authorId === "string" ? post.authorId.trim() : "";
    if (!authorId) return true;

    const authorStatus =
      authorMembershipMap.get(`${groupId}__${authorId}`) ?? null;

    if (authorStatus === "banned") {
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

  const ownershipEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      try {
        const groupSnap = await getDoc(doc(db, "groups", groupId));
        if (!groupSnap.exists()) return [groupId, false] as const;

        const data = groupSnap.data() as any;
        return [groupId, data?.ownerId === currentUserId] as const;
      } catch {
        return [groupId, false] as const;
      }
    })
  );

  const ownershipMap = new Map<string, boolean>(ownershipEntries);

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
      const meta = await getMembershipStatusForGroup(groupId, authorId);
      return [pairKey, meta] as const;
    })
  );

  const authorMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: any | null }
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
      canModerateGroupAuthor: !!groupId && ownershipMap.get(groupId) === true,
      authorMemberStatus: authorMeta?.status ?? null,
      authorMutedUntil: authorMeta?.mutedUntil ?? null,
    };
  });
}

export default function HomePostsFeed({ currentUserId }: HomePostsFeedProps) {
  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);

  async function loadPosts() {
    if (!currentUserId) {
      setPosts([]);
      return;
    }

    const nextPosts = await fetchHomePosts(currentUserId);
    const visiblePosts = await filterOutHiddenHomePosts(
      nextPosts,
      currentUserId
    );
    const hydratedPosts = await attachModerationFlags(
      visiblePosts,
      currentUserId
    );

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

  const headerStyle: CSSProperties = {
    display: "grid",
    gap: 4,
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
  };

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
          Inicia sesión para ver publicaciones de tus grupos.
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
          Publicaciones recientes de grupos donde ya estás dentro o eres owner.
        </p>
      </div>

      {error && <div style={noticeStyle}>{error}</div>}

      {loadingInitial && (
        <div style={noticeStyle}>Cargando publicaciones de tus grupos...</div>
      )}

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>
          Aún no hay publicaciones en tus grupos.
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