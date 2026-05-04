"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";

export type PublicPostView = {
  id: string;
  text: string;
  authorName: string;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
  groupName: string;
  createdAtLabel: string | null;
  shareTitle: string | null;
  shareDescription: string | null;
  shareImageUrl: string | null;
  counts: {
    likes: number;
    comments: number;
  };
  media: Array<{
    type: "image" | "video";
    url: string;
    thumbnailUrl?: string | null;
    altText?: string | null;
  }>;
};

type PublicPostPageClientProps = {
  post: PublicPostView;
  postUrl: string;
};

function getInitials(name?: string | null): string {
  const cleanName = name?.trim();

  if (!cleanName) return "U";

  return cleanName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default function PublicPostPageClient({
  post,
  postUrl,
}: PublicPostPageClientProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(
    auth.currentUser?.uid ?? null
  );

  useEffect(() => {
    const unsub = auth.onAuthStateChanged((user) => {
      setCurrentUserId(user?.uid ?? null);
    });

    return () => unsub();
  }, []);

  const entryHref = currentUserId ? "/" : "/login";
  const authorName = post.authorName || "Usuario";
  const groupName = post.groupName || "Comunidad";

  const imageMedia = useMemo(
    () => post.media.filter((item) => item.type === "image" && item.url),
    [post.media]
  );

  async function handleShare() {
    const shareTitle = post.shareTitle || "Publicación";
    const shareText =
      post.shareDescription || post.text || "Mira esta publicación.";

    if (navigator.share) {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: postUrl,
      });
      return;
    }

    await navigator.clipboard.writeText(postUrl);
    window.alert("Link copiado.");
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-6 text-white sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="text-sm font-semibold text-neutral-300 transition hover:text-white"
          >
            Vibra
          </Link>

          <Link
            href={entryHref}
            className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Login
          </Link>
        </div>

        <article className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900 shadow-xl">
          <div className="flex items-start gap-3 p-4">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-neutral-800">
              {post.authorAvatarUrl ? (
                <img
                  src={post.authorAvatarUrl}
                  alt={authorName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-neutral-200">
                  {getInitials(authorName)}
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="truncate font-semibold text-white">{authorName}</p>

                {post.authorUsername ? (
                  <p className="truncate text-sm text-neutral-400">
                    @{post.authorUsername}
                  </p>
                ) : null}
              </div>

              <p className="text-sm text-neutral-400">
                {groupName}
                {post.createdAtLabel ? ` · ${post.createdAtLabel}` : ""}
              </p>
            </div>
          </div>

          {post.text ? (
            <div className="px-4 pb-4 text-[15px] leading-relaxed text-neutral-100">
              <p className="whitespace-pre-wrap break-words">{post.text}</p>
            </div>
          ) : null}

          {imageMedia.length > 0 ? (
            <div
              className={
                imageMedia.length === 1
                  ? "grid w-full grid-cols-1 gap-0 bg-black"
                  : "grid w-full grid-cols-2 gap-0.5 bg-black"
              }
            >
              {imageMedia.map((item, index) => (
                <div
                  key={`${item.url}-${index}`}
                  className={
                    imageMedia.length === 1
                      ? "aspect-video w-full overflow-hidden bg-neutral-800"
                      : "aspect-square w-full overflow-hidden bg-neutral-800"
                  }
                >
                  <img
                    src={item.url}
                    alt={
                      item.altText ||
                      post.shareTitle ||
                      `Imagen ${index + 1} del post`
                    }
                    className="h-full w-full object-cover"
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-sm text-neutral-400">
            <div className="flex items-center gap-4">
              <span>🔥 {post.counts.likes}</span>
              <span>💬 {post.counts.comments}</span>
            </div>

            <button
              type="button"
              onClick={handleShare}
              className="grid h-8 w-8 place-items-center rounded-lg text-lg transition hover:bg-white/10"
              aria-label="Compartir publicación"
              title="Compartir publicación"
            >
              📤
            </button>
          </div>
        </article>

        <div className="rounded-2xl border border-white/10 bg-neutral-900 p-4 text-center">
          <p className="text-sm text-neutral-300">
            Para comentar, reaccionar o ver más contenido, entra a Vibra.
          </p>

          <Link
            href={entryHref}
            className="mt-4 inline-flex rounded-xl bg-white px-5 py-2 text-sm font-bold text-neutral-950 transition hover:bg-neutral-200"
          >
            Entrar a Vibra
          </Link>
        </div>
      </section>
    </main>
  );
}