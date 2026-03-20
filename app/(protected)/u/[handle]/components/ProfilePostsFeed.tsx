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

  const ownershipEntries = await Promise.all(
    uniqueGroupIds.map(async (groupId) => {
      try {
        const groupSnap = await getDoc(doc(db, "groups", groupId));
        if (!groupSnap.exists()) return [groupId, false] as const;

        const data = groupSnap.data() as any;
        return [groupId, data?.ownerId === currentViewerUid] as const;
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

export default function ProfilePostsFeed({
  profileUid,
  viewerUid,
  isOwner,
  showPosts = true,
}: ProfilePostsFeedProps) {
  const [posts, setPosts] = useState<PostWithFlags[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);

  async function loadPosts() {
    console.log("[ProfilePostsFeed] loadPosts start", {
      profileUid,
      viewerUid,
      isOwner,
      showPosts,
    });

    const nextPosts = await fetchUserProfilePosts(profileUid, viewerUid);
    console.log("[ProfilePostsFeed] fetchUserProfilePosts ok", {
      count: nextPosts.length,
    });

    const visiblePosts = await filterBannedGroupPosts(nextPosts, viewerUid);
    console.log("[ProfilePostsFeed] filterBannedGroupPosts ok", {
      count: visiblePosts.length,
    });

    const hydratedPosts = await attachModerationFlags(visiblePosts, viewerUid);
    console.log("[ProfilePostsFeed] attachModerationFlags ok", {
      count: hydratedPosts.length,
    });

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
        }
        return;
      }

      try {
        setLoadingInitial(true);
        setError(null);

        console.log("[ProfilePostsFeed] initial run start", {
          profileUid,
          viewerUid,
          isOwner,
          showPosts,
        });

        const nextPosts = await fetchUserProfilePosts(profileUid, viewerUid);
        console.log("[ProfilePostsFeed] fetchUserProfilePosts ok", {
          count: nextPosts.length,
        });

        const visiblePosts = await filterBannedGroupPosts(nextPosts, viewerUid);
        console.log("[ProfilePostsFeed] filterBannedGroupPosts ok", {
          count: visiblePosts.length,
        });

        const hydratedPosts = await attachModerationFlags(visiblePosts, viewerUid);
        console.log("[ProfilePostsFeed] attachModerationFlags ok", {
          count: hydratedPosts.length,
        });

        if (!active) return;
        setPosts(hydratedPosts);
      } catch (e: any) {
        console.error("[ProfilePostsFeed] load error", e);
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
        const canDeletePost =
          viewerUid === post.authorId || post.canModerateGroupAuthor === true;

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
              canModerateGroupAuthor={post.canModerateGroupAuthor === true}
              onModerationComplete={loadPosts}
            />
          </div>
        );
      })}
    </section>
  );
}