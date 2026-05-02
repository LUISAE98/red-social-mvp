"use client";

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { auth, db } from "@/lib/firebase";
import type { Comment, Post } from "@/lib/posts/types";
import {
  createImagePost,
  createPostComment,
  createTextPost,
  deletePostComment,
  fetchGroupPosts,
  fetchPostComments,
  softDeletePost,
  togglePostFlame,
} from "@/lib/posts/post-service";
import GroupPostCard from "./GroupPostCard";
import GroupPostComposer from "./GroupPostComposer";
import { buildCurrentPathWithSearch } from "@/lib/auth-redirect";
import { uploadPostImage } from "@/lib/posts/image-upload";

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

function normalizeFeedPost(post: PostWithAuthorState): PostWithAuthorState {
  return {
    ...post,
    postType: post.postType ?? "text",
    access: post.access ?? "free",
    accessModel: post.accessModel ?? "free",
    accessScope: post.accessScope ?? "group",
    requiresPayment: post.requiresPayment ?? false,
    requiresSubscription: post.requiresSubscription ?? false,
    oneTimePrice: post.oneTimePrice ?? null,
    currency: post.currency ?? null,
    purchaseType: post.purchaseType ?? null,
    media: Array.isArray(post.media) ? post.media : [],
    counts: {
      comments: post.counts?.comments ?? 0,
      likes: post.counts?.likes ?? 0,
    },
    liveData: post.liveData ?? null,
    videoData: post.videoData ?? null,
    scheduledData: post.scheduledData ?? null,
    playback: post.playback ?? null,
    processing: post.processing ?? {
      status: "none",
      provider: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: null,
    },
  };
}

function buildPostBlockedMessage(reason: InteractionBlockedReason): string {
  if (reason === "login") {
    return "Inicia sesión para publicar en esta comunidad.";
  }

  if (reason === "join") {
    return "Debes unirte a esta comunidad para publicar.";
  }

  if (reason === "restricted") {
    return "No puedes publicar en esta comunidad por la configuración actual o por tu estado dentro de la comunidad.";
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
    return "No puedes comentar en esta comunidad por la configuración actual o por tu estado dentro de la comunidad.";
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
const searchParams = useSearchParams();

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
    const nextPosts = await fetchGroupPosts(groupId, currentUid);
    const hydratedPosts = await attachAuthorMemberState(groupId, nextPosts);
    setPosts(hydratedPosts.map(normalizeFeedPost));
  }

  useEffect(() => {
    let active = true;

    async function run() {
      try {
        setLoadingInitial(true);
        setError(null);

        const nextPosts = await fetchGroupPosts(groupId, currentUid);
        const hydratedPosts = await attachAuthorMemberState(groupId, nextPosts);

        if (!active) return;
        setPosts(hydratedPosts.map(normalizeFeedPost));
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
   }, [groupId, currentUid]);

function redirectToLogin() {
  const nextPath = buildCurrentPathWithSearch(
    pathname || `/groups/${groupId}`,
    searchParams
  );

  router.push(`/login?next=${encodeURIComponent(nextPath)}`);
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

  async function handleCreatePost(payload: {
    text: string;
    imageFile?: File | null;
  }) {
    if (!guardCreatePost()) return;

    try {
      setError(null);
      setComposerError(null);

      const cleanText = payload.text.trim();

      if (payload.imageFile) {
        const uploadedImage = await uploadPostImage({
          groupId,
          file: payload.imageFile,
        });

        await createImagePost({
          groupId,
          text: cleanText,
          media: [uploadedImage],
        });
      } else {
        await createTextPost({ groupId, text: cleanText });
      }

      await loadPosts();
    } catch (e: any) {
      setComposerError(e?.message ?? "No se pudo publicar.");
    }
  }

    async function handleToggleFlame(postId: string): Promise<void> {
    try {
      setError(null);

      const result = await togglePostFlame(postId);

      setPosts((prev) =>
        prev.map((post) =>
          post.id === postId
            ? {
                ...post,
                viewerHasFlamed: result.liked,
                counts: {
                  ...post.counts,
                  likes: result.likes,
                },
              }
            : post
        )
      );
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar la flamita.");
      throw e;
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
  maxWidth: "100%",
  minWidth: 0,
  display: "grid",
  gap: 12,
  overflowX: "hidden",
  boxSizing: "border-box",
};

  const headerStyle: CSSProperties = {
    display: "grid",
    gap: 3,
    minWidth: 0,
  };

  const titleStyle: CSSProperties = {
    margin: 0,
    fontSize: "clamp(15px, 4vw, 18px)",
    fontWeight: 500,
    lineHeight: 1.08,
    letterSpacing: "-0.02em",
    color: "#fff",
    wordBreak: "break-word",
  };

  const subtitleStyle: CSSProperties = {
    margin: 0,
    fontSize: "clamp(11px, 3.2vw, 11.5px)",
    fontWeight: 300,
    color: "rgba(255,255,255,0.58)",
    lineHeight: 1.35,
    wordBreak: "break-word",
  };

  const noticeStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: "9px 10px",
    fontSize: 12,
    fontWeight: 300,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.82)",
    overflowWrap: "anywhere",
  };

  const composerErrorStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid rgba(255,90,90,0.24)",
    background: "rgba(120,18,18,0.28)",
    color: "#ffdada",
    padding: "10px 12px",
    fontSize: 12,
    lineHeight: 1.4,
    overflowWrap: "anywhere",
  };

  const interactionHintStyle: CSSProperties = {
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.025)",
    color: "rgba(255,255,255,0.82)",
    padding: "12px 14px",
    fontSize: 12.5,
    lineHeight: 1.45,
    overflowWrap: "anywhere",
  };

const cardShellStyle: CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
  overflow: "visible",
  boxSizing: "border-box",
};

const postShellStyle: CSSProperties = {
  ...cardShellStyle,
};

  return (
    <section style={shellStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Publicaciones</h2>
        <p style={subtitleStyle}>Feed de la comunidad.</p>
      </div>

      {canCreatePosts ? (
        <div style={cardShellStyle}>
          <GroupPostComposer onSubmit={handleCreatePost} />
        </div>
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
<div key={post.id} style={postShellStyle}>
  <GroupPostCard
              post={post}
              canDelete={canDeletePost}
              onDelete={canDeletePost ? handleDeletePost : undefined}
              onLoadComments={handleLoadComments}
              onCreateComment={handleCreateComment}
              onDeleteComment={handleDeleteComment}
              onToggleFlame={handleToggleFlame}
              currentUserId={currentUid}
              isOwner={isOwner}
              isModerator={isModerator}
              showGroupContext={false}
              canModerateGroupAuthor={isOwner || isModerator}
              onModerationComplete={loadPosts}
            />
          </div>
        );
      })}
    </section>
  );
}