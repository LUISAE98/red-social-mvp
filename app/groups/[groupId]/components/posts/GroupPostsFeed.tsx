"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { Comment, Post } from "@/lib/posts/types";
import {
  createPostComment,
  createTextPost,
  deletePostComment,
  fetchGroupPosts,
  fetchPostComments,
  softDeletePost,
} from "@/lib/posts/post-service";
import GroupPostCard from "./GroupPostCard";
import GroupPostComposer from "./GroupPostComposer";

type GroupPostsFeedProps = {
  groupId: string;
  isOwner?: boolean;
};

type MemberStatus = "active" | "muted" | "banned" | null;
type PostWithAuthorMemberStatus = Post & {
  authorMemberStatus?: MemberStatus;
};

async function getGroupMemberStatus(
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

async function attachAuthorMemberStatus(
  groupId: string,
  posts: Post[]
): Promise<PostWithAuthorMemberStatus[]> {
  if (!posts.length) return posts as PostWithAuthorMemberStatus[];

  const uniqueAuthorIds = Array.from(
    new Set(
      posts
        .map((post) => post.authorId)
        .filter(
          (authorId): authorId is string =>
            typeof authorId === "string" && authorId.trim().length > 0
        )
    )
  );

  const authorStatusEntries = await Promise.all(
    uniqueAuthorIds.map(async (authorId) => {
      const status = await getGroupMemberStatus(groupId, authorId);
      return [authorId, status] as const;
    })
  );

  const authorStatusMap = new Map<string, MemberStatus>(authorStatusEntries);

  return posts.map((post) => ({
    ...post,
    authorMemberStatus: authorStatusMap.get(post.authorId) ?? null,
  }));
}

export default function GroupPostsFeed({
  groupId,
  isOwner = false,
}: GroupPostsFeedProps) {
  const [posts, setPosts] = useState<PostWithAuthorMemberStatus[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [currentUid, setCurrentUid] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUid(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

  async function loadPosts() {
    const nextPosts = await fetchGroupPosts(groupId);
    const hydratedPosts = await attachAuthorMemberStatus(groupId, nextPosts);
    setPosts(hydratedPosts);
  }

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        setLoadingInitial(true);
        setError(null);

        const nextPosts = await fetchGroupPosts(groupId);
        const hydratedPosts = await attachAuthorMemberStatus(groupId, nextPosts);

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
  }, [groupId]);

  async function handleCreatePost(text: string) {
    try {
      setError(null);
      await createTextPost({ groupId, text });
      await loadPosts();
    } catch (e: any) {
      setError(e?.message ?? "Error desconocido");
      throw e;
    }
  }

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
    display: "grid",
    gap: 12,
  };

  const headerStyle: CSSProperties = {
    display: "grid",
    gap: 3,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: "clamp(16px, 2vw, 18px)",
    fontWeight: 500,
    lineHeight: 1.08,
    letterSpacing: "-0.02em",
    color: "#fff",
  };

  const subtitleStyle: CSSProperties = {
    margin: 0,
    fontSize: 11.5,
    fontWeight: 300,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.35,
  };

  const noticeStyle: CSSProperties = {
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: "9px 10px",
    fontSize: 12,
    fontWeight: 300,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.82)",
  };

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Publicaciones</h2>
        <p style={subtitleStyle}>Feed del grupo.</p>
      </div>

      <GroupPostComposer onSubmit={handleCreatePost} />

      {error && <div style={noticeStyle}>{error}</div>}

      {loadingInitial && (
        <div style={noticeStyle}>Cargando publicaciones...</div>
      )}

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>
          Todavía no hay publicaciones en este grupo.
        </div>
      )}

      {posts.map((post) => {
        const canDeletePost = isOwner || currentUid === post.authorId;

        return (
          <GroupPostCard
            key={post.id}
            post={post}
            canDelete={canDeletePost}
            onDelete={canDeletePost ? handleDeletePost : undefined}
            onLoadComments={handleLoadComments}
            onCreateComment={handleCreateComment}
            onDeleteComment={handleDeleteComment}
            currentUserId={currentUid}
            isOwner={isOwner}
            showGroupContext={false}
          />
        );
      })}
    </section>
  );
}