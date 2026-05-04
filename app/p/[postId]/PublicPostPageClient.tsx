"use client";

import Image from "next/image";
import Link from "next/link";

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

  if (!cleanName) {
    return "U";
  }

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
  const authorName = post.authorName || "Usuario";
  const groupName = post.groupName || "Comunidad";
  const firstImage = post.media.find((item) => item.type === "image" && item.url);

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
            href="/login"
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            Entrar
          </Link>
        </div>

        <article className="overflow-hidden rounded-3xl border border-white/10 bg-neutral-900 shadow-2xl">
          <div className="flex items-start gap-3 p-4 sm:p-5">
            <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full bg-neutral-800">
              {post.authorAvatarUrl ? (
                <Image
                  src={post.authorAvatarUrl}
                  alt={authorName}
                  fill
                  sizes="44px"
                  className="object-cover"
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
            <div className="px-4 pb-4 text-[15px] leading-relaxed text-neutral-100 sm:px-5">
              <p className="whitespace-pre-wrap break-words">{post.text}</p>
            </div>
          ) : null}

          {firstImage ? (
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-neutral-800 sm:aspect-video">
              <Image
                src={firstImage.url}
                alt={firstImage.altText || post.shareTitle || "Imagen del post"}
                fill
                sizes="(max-width: 768px) 100vw, 672px"
                className="object-cover"
                priority
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-sm text-neutral-400 sm:px-5">
            <div className="flex items-center gap-4">
              <span>🔥 {post.counts.likes}</span>
              <span>💬 {post.counts.comments}</span>
            </div>

            <button
              type="button"
              onClick={handleShare}
              className="grid h-8 w-8 place-items-center rounded-full text-lg transition hover:bg-white/10"
              aria-label="Compartir publicación"
              title="Compartir publicación"
            >
              📤
            </button>
          </div>
        </article>

        <div className="rounded-3xl border border-white/10 bg-neutral-900 p-4 text-center sm:p-5">
          <p className="text-sm text-neutral-300">
            Para comentar, reaccionar o ver más contenido, entra a Vibra.
          </p>

          <Link
            href="/login"
            className="mt-4 inline-flex rounded-full bg-white px-5 py-2 text-sm font-bold text-neutral-950 transition hover:bg-neutral-200"
          >
            Entrar a Vibra
          </Link>
        </div>
      </section>
    </main>
  );
}