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

async function getMembershipStatusForGroup(
  groupId: string,
  userId: string
): Promise<MemberStatus> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) return null;

    const data = memberSnap.data() as any;
    const rawStatus = data?.status;

    if (rawStatus === "banned") return "banned";
    if (rawStatus === "muted") return "muted";
    return "active";
  } catch {
    return null;
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
      const status = await getMembershipStatusForGroup(groupId, currentUserId);
      return [groupId, status] as const;
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

      const status = await getMembershipStatusForGroup(groupId, authorId);
      return [pairKey, status] as const;
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

export default function HomePostsFeed({ currentUserId }: HomePostsFeedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
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

    setPosts(visiblePosts);
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

        if (!active) return;
        setPosts(visiblePosts);
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
        const canDeletePost = currentUserId === post.authorId;

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
            />
          </div>
        );
      })}
    </section>
  );
}