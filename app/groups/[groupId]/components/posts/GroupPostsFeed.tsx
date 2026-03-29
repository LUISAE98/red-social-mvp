"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { usePathname, useRouter } from "next/navigation";
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

type InteractionBlockedReason = "login" | "join" | "restricted" | null;

type GroupPostsFeedProps = {
  groupId: string;
  isOwner?: boolean;
  isModerator?: boolean;
  canCreatePosts?: boolean;
  canCommentOnPosts?: boolean;
  postBlockedReason?: InteractionBlockedReason;
  commentBlockedReason?: InteractionBlockedReason;
};

type MemberStatus = "active" | "muted" | "banned" | "removed" | null;

type PostWithAuthorState = Post & {
  authorMemberStatus?: MemberStatus;
  authorMutedUntil?: any;
  forcedGroupId?: string | null;
};

async function getGroupMemberMeta(
  groupId: string,
  userId: string
): Promise<{ status: MemberStatus; mutedUntil: any | null }> {
  try {
    const memberRef = doc(db, "groups", groupId, "members", userId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      return { status: null, mutedUntil: null };
    }

    const data = memberSnap.data() as any;
    const rawStatus = data?.status;

    let status: MemberStatus = "active";

    if (rawStatus === "banned") {
      status = "banned";
    } else if (rawStatus === "muted") {
      status = "muted";
    } else if (
      rawStatus === "removed" ||
      rawStatus === "kicked" ||
      rawStatus === "expelled"
    ) {
      status = "removed";
    }

    return {
      status,
      mutedUntil: data?.mutedUntil ?? null,
    };
  } catch {
    return { status: null, mutedUntil: null };
  }
}

async function attachAuthorMemberState(
  groupId: string,
  posts: Post[]
): Promise<PostWithAuthorState[]> {
  if (!posts.length) return posts as PostWithAuthorState[];

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
      const meta = await getGroupMemberMeta(groupId, authorId);
      return [authorId, meta] as const;
    })
  );

  const authorStatusMap = new Map<
    string,
    { status: MemberStatus; mutedUntil: any | null }
  >(authorStatusEntries);

  return posts.map((post) => {
    const authorMeta = authorStatusMap.get(post.authorId) ?? {
      status: null,
      mutedUntil: null,
    };

    return {
      ...post,
      forcedGroupId: groupId,
      authorMemberStatus: authorMeta.status,
      authorMutedUntil: authorMeta.mutedUntil,
    };
  });
}

function buildPostBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para publicar en esta comunidad.";
  }

  if (reason === "join") {
    return "Debes unirte a esta comunidad para publicar.";
  }

  if (reason === "restricted") {
    return "No puedes publicar en esta comunidad por la configuración actual o por tu estado dentro del grupo.";
  }

  return "No puedes publicar en esta comunidad en este momento.";
}

function buildCommentBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para comentar en esta comunidad.";
  }

  if (reason === "join") {
    return "Debes unirte a esta comunidad para comentar.";
  }

  if (reason === "restricted") {
    return "No puedes comentar en esta comunidad por la configuración actual o por tu estado dentro del grupo.";
  }

  return "No puedes comentar en esta comunidad en este momento.";
}

export default function GroupPostsFeed({
  groupId,
  isOwner = false,
  isModerator = false,
  canCreatePosts = false,
  canCommentOnPosts = false,
  postBlockedReason = null,
  commentBlockedReason = null,
}: GroupPostsFeedProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [posts, setPosts] = useState<PostWithAuthorState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!composerError) return;

    const timer = window.setTimeout(() => {
      setComposerError(null);
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [composerError]);

  async function loadPosts() {
    const nextPosts = await fetchGroupPosts(groupId);
    const hydratedPosts = await attachAuthorMemberState(groupId, nextPosts);
    setPosts(hydratedPosts);
  }

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        setLoadingInitial(true);
        setError(null);

        const nextPosts = await fetchGroupPosts(groupId);
        const hydratedPosts = await attachAuthorMemberState(groupId, nextPosts);

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

  function redirectToLogin() {
    router.push(
      `/login?next=${encodeURIComponent(pathname || `/groups/${groupId}`)}`
    );
  }

  function guardCreatePost(): boolean {
    if (canCreatePosts) {
      return true;
    }

    const message = buildPostBlockedMessage(postBlockedReason);

    if (postBlockedReason === "login") {
      setComposerError(message);
      redirectToLogin();
      return false;
    }

    setComposerError(message);
    return false;
  }

  function guardCreateComment(): boolean {
    if (canCommentOnPosts) {
      return true;
    }

    const message = buildCommentBlockedMessage(commentBlockedReason);

    if (commentBlockedReason === "login") {
      setError(message);
      redirectToLogin();
      return false;
    }

    setError(message);
    return false;
  }

  async function handleCreatePost(text: string) {
    if (!guardCreatePost()) return;

    try {
      setError(null);
      setComposerError(null);
      await createTextPost({ groupId, text });
      await loadPosts();
    } catch (e: any) {
      setComposerError(e?.message ?? "No se pudo publicar.");
    }
  }

  async function handleDeletePost(postId: string) {
    try {
      setError(null);
      await softDeletePost(postId);
      await loadPosts();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar la publicación.");
      throw e;
    }
  }

  async function handleLoadComments(postId: string): Promise<Comment[]> {
    try {
      setError(null);
      return await fetchPostComments(postId);
    } catch (e: any) {
      setError(e?.message ?? "No se pudieron cargar los comentarios.");
      throw e;
    }
  }

  async function handleCreateComment(
    postId: string,
    text: string
  ): Promise<Comment[]> {
    if (!guardCreateComment()) {
      throw new Error(buildCommentBlockedMessage(commentBlockedReason));
    }

    try {
      setError(null);
      await createPostComment({ postId, text });
      return await fetchPostComments(postId);
    } catch (e: any) {
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
      setError(e?.message ?? "No se pudo eliminar el comentario.");
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

  const composerErrorStyle: CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,90,90,0.24)",
    background: "rgba(120,18,18,0.28)",
    color: "#ffdada",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.4,
  };

  const interactionHintStyle: CSSProperties = {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.025)",
    color: "rgba(255,255,255,0.82)",
    padding: "12px 14px",
    fontSize: 12.5,
    lineHeight: 1.45,
  };

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Publicaciones</h2>
        <p style={subtitleStyle}>Feed de la comunidad.</p>
      </div>

      {canCreatePosts ? (
        <GroupPostComposer onSubmit={handleCreatePost} />
      ) : (
        <div style={interactionHintStyle}>
          {buildPostBlockedMessage(postBlockedReason)}
        </div>
      )}

      {!canCommentOnPosts && (
        <div style={interactionHintStyle}>
          {buildCommentBlockedMessage(commentBlockedReason)}
        </div>
      )}

      {composerError && <div style={composerErrorStyle}>{composerError}</div>}

      {error && <div style={noticeStyle}>{error}</div>}

      {loadingInitial && (
        <div style={noticeStyle}>Cargando publicaciones...</div>
      )}

      {!loadingInitial && posts.length === 0 && (
        <div style={noticeStyle}>
          Todavía no hay publicaciones en esta comunidad.
        </div>
      )}

      {posts.map((post) => {
        const canDeletePost =
          isOwner || isModerator || currentUid === post.authorId;

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
            isModerator={isModerator}
            showGroupContext={false}
            canModerateGroupAuthor={isOwner || isModerator}
            onModerationComplete={loadPosts}
          />
        );
      })}
    </section>
  );
}