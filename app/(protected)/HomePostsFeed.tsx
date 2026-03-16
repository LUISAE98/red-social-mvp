"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

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
    setPosts(nextPosts);
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

        if (!active) return;
        setPosts(nextPosts);
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
