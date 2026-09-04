"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { useTranslations } from "next-intl";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import GroupPostCard from "@/app/groups/[groupId]/components/posts/GroupPostCard";
import {
  fetchPostByIdForViewer,
  fetchPostComments,
  createPostComment,
  deletePostComment,
  fetchCommentReplies,
  createPostCommentReply,
  deletePostCommentReply,
  togglePostFlame,
  togglePostSave,
  toggleGroupPostPin,
  toggleProfilePostPin,
  softDeletePost,
} from "@/lib/posts/post-service";
import type { Post, Comment, CommentImage, CommentMention } from "@/lib/posts/types";
import { useUnlockedPostIds } from "@/lib/posts/useUnlockedPostIds";
import PostSkeleton from "@/app/components/PostSkeleton/PostSkeleton";
import { useScreenReady } from "@/lib/useScreenReady";

interface ViewerContext {
  isProfilePost: boolean;
  isOwner: boolean;
  isModerator: boolean;
  viewerIsMember: boolean;
}

const MEMBER_STATUSES = new Set(["active", "subscribed", "muted"]);

/** Resuelve el rol/membresía del viewer respecto al post (grupo o perfil). */
async function resolveViewerContext(post: Post, viewerUid: string): Promise<ViewerContext> {
  const isProfilePost = post.contextType === "profile" || !post.groupId;
  if (isProfilePost) {
    return {
      isProfilePost: true,
      isOwner: viewerUid === post.authorId,
      isModerator: false,
      viewerIsMember: false,
    };
  }

  const groupId = post.groupId as string;
  try {
    const [groupSnap, memberSnap] = await Promise.all([
      getDoc(doc(db, "groups", groupId)),
      getDoc(doc(db, "groups", groupId, "members", viewerUid)),
    ]);
    const ownerId = groupSnap.exists() ? (groupSnap.get("ownerId") as string | undefined) : undefined;
    const member = memberSnap.exists()
      ? (memberSnap.data() as { status?: string; role?: string; roleInGroup?: string })
      : null;
    const status = member?.status ?? null;
    const role = member?.roleInGroup ?? member?.role ?? null;
    const isOwner = !!ownerId && ownerId === viewerUid;
    const isMember = status !== null && MEMBER_STATUSES.has(status);
    return {
      isProfilePost: false,
      isOwner,
      isModerator: !isOwner && role === "mod" && status !== "banned" && status !== "removed",
      viewerIsMember: isOwner || isMember,
    };
  } catch {
    return { isProfilePost: false, isOwner: false, isModerator: false, viewerIsMember: false };
  }
}

export default function SinglePostPage() {
  const t = useTranslations("posts");
  const tCommon = useTranslations("common");
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  // Desbloqueo premium persistente del viewer (cualquier dispositivo).
  const unlockedPostIds = useUnlockedPostIds(user?.uid ?? null);

  const postId = Array.isArray(params?.postId) ? params.postId[0] : (params?.postId as string);
  const focusCommentId = search.get("c");

  const [post, setPost] = useState<Post | null>(null);
  const [ctx, setCtx] = useState<ViewerContext | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");

  // También cuando la publicación no existe: ahí ya hay algo que enseñar, y
  // dejar el splash puesto sería tapar el mensaje de "no está".
  useScreenReady(state !== "loading");

  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    (async () => {
      setState("loading");
      const p = await fetchPostByIdForViewer(postId, user?.uid ?? null);
      if (!alive) return;
      if (!p) {
        setState("notfound");
        return;
      }
      const viewerCtx = user?.uid
        ? await resolveViewerContext(p, user.uid)
        : { isProfilePost: p.contextType === "profile" || !p.groupId, isOwner: false, isModerator: false, viewerIsMember: false };
      if (!alive) return;
      setPost(p);
      setCtx(viewerCtx);
      setState("ready");
    })();
    return () => {
      alive = false;
    };
  }, [postId, user?.uid, authLoading]);

  // ── Recuento de comentarios tras crear/borrar ────────────────────────────
  const reloadComments = useCallback(async (pid: string): Promise<Comment[]> => {
    const comments = await fetchPostComments(pid);
    const total = comments.reduce((sum, c) => sum + 1 + (c.counts?.replies ?? 0), 0);
    setPost((prev) =>
      prev && prev.id === pid ? { ...prev, counts: { ...prev.counts, comments: total } } : prev
    );
    return comments;
  }, []);

  // ── Callbacks interactivos (mismas funciones de post-service que los feeds) ─
  const handleLoadComments = useCallback((pid: string) => fetchPostComments(pid), []);

  const handleCreateComment = useCallback(
    async (pid: string, text: string, mentions?: CommentMention[], image?: CommentImage | null) => {
      await createPostComment({ postId: pid, text, mentions, image });
      return reloadComments(pid);
    },
    [reloadComments]
  );

  const handleDeleteComment = useCallback(
    async (pid: string, commentId: string) => {
      await deletePostComment({ postId: pid, commentId });
      return reloadComments(pid);
    },
    [reloadComments]
  );

  const handleLoadReplies = useCallback(
    (pid: string, commentId: string) => fetchCommentReplies({ postId: pid, commentId }),
    []
  );

  const handleCreateReply = useCallback(
    async (pid: string, commentId: string, text: string, mentions?: CommentMention[], image?: CommentImage | null) => {
      await createPostCommentReply({ postId: pid, commentId, text, mentions, image });
      await reloadComments(pid);
      return fetchCommentReplies({ postId: pid, commentId });
    },
    [reloadComments]
  );

  const handleDeleteReply = useCallback(
    async (pid: string, commentId: string, replyId: string) => {
      await deletePostCommentReply({ postId: pid, commentId, replyId });
      await reloadComments(pid);
      return fetchCommentReplies({ postId: pid, commentId });
    },
    [reloadComments]
  );

  const handleToggleFlame = useCallback(async (pid: string) => {
    const r = await togglePostFlame(pid);
    setPost((prev) =>
      prev && prev.id === pid
        ? { ...prev, viewerHasFlamed: r.liked, counts: { ...prev.counts, likes: r.likes } }
        : prev
    );
  }, []);

  const handleToggleSave = useCallback(async (pid: string) => {
    const r = await togglePostSave(pid);
    setPost((prev) => {
      if (!prev || prev.id !== pid) return prev;
      const nextSaves = Math.max(0, (prev.counts?.saves ?? 0) + r.delta);
      return { ...prev, viewerHasSaved: r.saved, counts: { ...prev.counts, saves: nextSaves } };
    });
  }, []);

  const handleToggleProfilePin = useCallback(async (pid: string) => {
    const r = await toggleProfilePostPin(pid);
    setPost((prev) =>
      prev && prev.id === pid ? { ...prev, isPinnedOnProfile: r.isPinnedOnProfile } : prev
    );
  }, []);

  const handleToggleGroupPin = useCallback(async (pid: string) => {
    const r = await toggleGroupPostPin(pid);
    setPost((prev) =>
      prev && prev.id === pid ? { ...prev, isPinnedInGroup: r.isPinnedInGroup } : prev
    );
  }, []);

  const handleDeletePost = useCallback(
    async (pid: string) => {
      await softDeletePost(pid);
      router.back();
    },
    [router]
  );

  const reloadPost = useCallback(async () => {
    const p = await fetchPostByIdForViewer(postId, user?.uid ?? null);
    if (p) setPost(p);
  }, [postId, user?.uid]);

  const canDelete =
    !!post &&
    !!ctx &&
    (ctx.isOwner || ctx.isModerator || (!!user?.uid && user.uid === post.authorId));

  return (
    <div className="postPage">
      <button type="button" className="postBack" onClick={() => router.back()}>
        {tCommon("back")}
      </button>

      {state === "loading" ? (
        <PostSkeleton />
      ) : state === "notfound" || !post || !ctx ? (
        <div className="postState">{t("postUnavailable")}</div>
      ) : (
        <GroupPostCard
          post={post}
          groupId={post.groupId ?? undefined}
          canDelete={canDelete}
          onDelete={canDelete ? handleDeletePost : undefined}
          onLoadComments={handleLoadComments}
          onCreateComment={handleCreateComment}
          onDeleteComment={handleDeleteComment}
          onLoadReplies={handleLoadReplies}
          onCreateReply={handleCreateReply}
          onDeleteReply={handleDeleteReply}
          onToggleFlame={handleToggleFlame}
          onToggleSave={handleToggleSave}
          onToggleProfilePin={
            ctx.isProfilePost && ctx.isOwner ? handleToggleProfilePin : undefined
          }
          onToggleGroupPin={
            !ctx.isProfilePost && (ctx.isOwner || ctx.isModerator) ? handleToggleGroupPin : undefined
          }
          currentUserId={user?.uid ?? null}
          forceUnlocked={unlockedPostIds.has(post.id)}
          isOwner={ctx.isOwner}
          isModerator={ctx.isModerator}
          viewerIsMember={ctx.isProfilePost ? undefined : ctx.viewerIsMember}
          showGroupContext={true}
          canModerateGroupAuthor={ctx.isProfilePost ? false : ctx.isOwner || ctx.isModerator}
          canCommentOnPosts={ctx.isProfilePost ? true : ctx.isOwner || ctx.viewerIsMember}
          onModerationComplete={reloadPost}
          autoOpenComments={!!focusCommentId}
          focusCommentId={focusCommentId}
        />
      )}

      <style jsx>{`
        .postPage {
          max-width: 640px;
          margin: 0 auto;
          padding: 8px 0 96px;
        }
        .postBack {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin: 4px 16px 12px;
          padding: 6px 4px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.75);
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
        }
        .postBack:hover {
          color: #fff;
        }
        .postState {
          padding: 64px 16px;
          text-align: center;
          color: rgba(255, 255, 255, 0.5);
          font-size: 15px;
        }
      `}</style>
    </div>
  );
}
