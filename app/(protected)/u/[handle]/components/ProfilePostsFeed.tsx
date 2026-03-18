"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
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

type ProfilePostsFeedProps = {
  profileUid: string;
  viewerUid: string | null;
  isOwner: boolean;
  showPosts?: boolean;
};

export default function ProfilePostsFeed({
  profileUid,
  viewerUid,
  isOwner,
  showPosts = true,
}: ProfilePostsFeedProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);

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
          .filter((groupId): groupId is string => typeof groupId === "string" && groupId.trim().length > 0)
      )
    );

    if (uniqueGroupIds.length === 0) {
      return inputPosts;
    }

    const membershipChecks = await Promise.all(
      uniqueGroupIds.map(async (groupId) => {
        try {
          const membershipRef = doc(db, "groups", groupId, "members", currentViewerUid);
          const membershipSnap = await getDoc(membershipRef);

          if (!membershipSnap.exists()) {
            return [groupId, false] as const;
          }

          const data = membershipSnap.data() as { status?: string } | undefined;
          return [groupId, data?.status === "banned"] as const;
        } catch {
          return [groupId, false] as const;
        }
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

  async function loadPosts() {
    const nextPosts = await fetchUserProfilePosts(profileUid, viewerUid);
    const visiblePosts = await filterBannedGroupPosts(nextPosts, viewerUid);
    setPosts(visiblePosts);
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
        }
        return;
      }

      try {
        setLoadingInitial(true);
        setError(null);

        const nextPosts = await fetchUserProfilePosts(profileUid, viewerUid);
        const visiblePosts = await filterBannedGroupPosts(nextPosts, viewerUid);

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
  };

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

  if (!showPosts && !isOwner) {
    return (
      <section style={shellStyle}>
        <div style={noticeStyle}>Este usuario restringió sus publicaciones.</div>
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

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>
          Todavía no hay publicaciones visibles en este perfil.
        </div>
      )}

      {posts.map((post) => {
        const canDeletePost = isOwner && viewerUid === post.authorId;

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
              showGroupContext={true}
            />
          </div>
        );
      })}
    </section>
  );
}