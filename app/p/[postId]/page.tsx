import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublicPostById } from "@/lib/posts/public-post-service";
import { buildPublicPostUrl } from "@/lib/posts/share-url";
import PublicPostPageClient, {
  type PublicPostView,
} from "./PublicPostPageClient";

type PublicPostPageProps = {
  params: Promise<{
    postId: string;
  }>;
};

function getDateFromTimestamp(value: any): Date | null {
  if (!value?.toDate) return null;

  try {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

function formatExactDate(date: Date | null): string | null {
  if (!date) return null;

  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return null;
  }
}

function buildPreviewText(
  value: string | null | undefined,
  maxLength = 90
): string {
  const cleanText = (value || "").trim().replace(/\s+/g, " ");

  if (!cleanText) {
    return "Publicación en Vibra";
  }

  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  const sliced = cleanText.slice(0, maxLength).trim();
  const lastSpace = sliced.lastIndexOf(" ");
  const safeText =
    lastSpace > 20 ? sliced.slice(0, lastSpace).trim() : sliced;

  return `${safeText}...`;
}

function toAbsoluteUrl(value: string | null | undefined): string | undefined {
  const cleanValue = (value || "").trim();

  if (!cleanValue) {
    return undefined;
  }

  if (cleanValue.startsWith("http://") || cleanValue.startsWith("https://")) {
    return cleanValue;
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";

  const cleanBaseUrl = baseUrl
    ? baseUrl.startsWith("http://") || baseUrl.startsWith("https://")
      ? baseUrl.replace(/\/$/, "")
      : `https://${baseUrl.replace(/\/$/, "")}`
    : "";

  if (!cleanBaseUrl) {
    return undefined;
  }

  return `${cleanBaseUrl}${cleanValue.startsWith("/") ? "" : "/"}${cleanValue}`;
}

function toPublicPostView(post: any): PublicPostView {
  const createdAtDate = getDateFromTimestamp(post.createdAt);

  const media = Array.isArray(post.media)
    ? post.media
        .filter((item: any) => {
          if (!item || (item.type !== "image" && item.type !== "video")) {
            return false;
          }

          if (item.type === "image") {
            return typeof item.url === "string" && item.url.trim().length > 0;
          }

          return (
            (typeof item.url === "string" && item.url.trim().length > 0) ||
            (typeof item.hlsUrl === "string" && item.hlsUrl.trim().length > 0) ||
            (typeof item.thumbnailUrl === "string" &&
              item.thumbnailUrl.trim().length > 0) ||
            (typeof item.status === "string" && item.status.trim().length > 0)
          );
        })
        .map((item: any) => ({
          type: item.type,
          url: typeof item.url === "string" ? item.url.trim() : "",
          thumbnailUrl:
            typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim()
              ? item.thumbnailUrl.trim()
              : null,
          thumbnailPath:
            typeof item.thumbnailPath === "string" && item.thumbnailPath.trim()
              ? item.thumbnailPath.trim()
              : null,
          altText:
            typeof item.altText === "string" && item.altText.trim()
              ? item.altText.trim()
              : null,

          id: typeof item.id === "string" ? item.id : undefined,
          index: typeof item.index === "number" ? item.index : undefined,
          provider: typeof item.provider === "string" ? item.provider : null,
          status: typeof item.status === "string" ? item.status : null,
          uploadId: typeof item.uploadId === "string" ? item.uploadId : null,
          assetId: typeof item.assetId === "string" ? item.assetId : null,
          playbackId:
            typeof item.playbackId === "string" ? item.playbackId : null,
          hlsUrl:
            typeof item.hlsUrl === "string" && item.hlsUrl.trim()
              ? item.hlsUrl.trim()
              : null,
          duration: typeof item.duration === "number" ? item.duration : null,
        }))
    : [];

  return {
    id: post.id,
    text: typeof post.text === "string" ? post.text : "",

    contextType: post.contextType === "profile" ? "profile" : "group",

    profileId: typeof post.profileId === "string" ? post.profileId : null,
    profileName:
      typeof post.profileName === "string" && post.profileName.trim()
        ? post.profileName
        : null,
    profileUsername:
      typeof post.profileUsername === "string" ? post.profileUsername : null,
    profileAvatarUrl:
      typeof post.profileAvatarUrl === "string" ? post.profileAvatarUrl : null,
    profileRestricted:
      typeof post.profileRestricted === "boolean"
        ? post.profileRestricted
        : null,

    authorId: typeof post.authorId === "string" ? post.authorId : null,
    authorName:
      typeof post.authorName === "string" && post.authorName.trim()
        ? post.authorName
        : "Usuario",
    authorUsername:
      typeof post.authorUsername === "string" ? post.authorUsername : null,
    authorAvatarUrl:
      typeof post.authorAvatarUrl === "string" ? post.authorAvatarUrl : null,

    groupId: typeof post.groupId === "string" ? post.groupId : null,
    groupName:
      typeof post.groupName === "string" && post.groupName.trim()
        ? post.groupName
        : "Comunidad",
    groupAvatarUrl:
      typeof post.groupAvatarUrl === "string" ? post.groupAvatarUrl : null,

    createdAtMs: createdAtDate ? createdAtDate.getTime() : null,
    createdAtExactLabel: formatExactDate(createdAtDate),

    shareTitle:
      typeof post.shareTitle === "string" && post.shareTitle.trim()
        ? post.shareTitle
        : "Publicación en Vibra",
    shareDescription:
      typeof post.shareDescription === "string" ? post.shareDescription : null,
    shareImageUrl:
      typeof post.shareImageUrl === "string" && post.shareImageUrl.trim()
        ? post.shareImageUrl.trim()
        : media[0]?.thumbnailUrl || media[0]?.url || null,

    counts: {
      likes: typeof post.counts?.likes === "number" ? post.counts.likes : 0,
      comments:
        typeof post.counts?.comments === "number" ? post.counts.comments : 0,
      saves: typeof post.counts?.saves === "number" ? post.counts.saves : 0,
    },

    postType: typeof post.postType === "string" ? post.postType : "text",
    videoData: post.videoData ?? null,
    playback: post.playback ?? null,
    processing: post.processing ?? null,

    media,
  };
}

export async function generateMetadata({
  params,
}: PublicPostPageProps): Promise<Metadata> {
  const { postId } = await params;
  const post = await fetchPublicPostById(postId);

  if (!post) {
    return {
      title: "Publicación no disponible",
      description: "Esta publicación no existe o no está disponible públicamente.",
      openGraph: {
        title: "Publicación no disponible",
        description: "Esta publicación no existe o no está disponible públicamente.",
        siteName: "Vibra",
        type: "website",
      },
    };
  }

  const publicPost = toPublicPostView(post);

  const title = buildPreviewText(
    publicPost.shareTitle || publicPost.text || "Publicación en Vibra",
    90
  );

  const description = buildPreviewText(
    publicPost.shareDescription ||
      publicPost.text ||
      `Publicación de ${publicPost.authorName || "Vibra"}`,
    160
  );

  const url = toAbsoluteUrl(buildPublicPostUrl(publicPost.id));
  const imageUrl = toAbsoluteUrl(publicPost.shareImageUrl);

  return {
    title,
    description,
    alternates: url
      ? {
          canonical: url,
        }
      : undefined,
    openGraph: {
      title,
      description,
      url,
      siteName: "Vibra",
      type: "article",
      images: imageUrl
        ? [
            {
              url: imageUrl,
              width: 1200,
              height: 630,
              alt: title,
            },
          ]
        : undefined,
    },
    twitter: {
      card: imageUrl ? "summary_large_image" : "summary",
      title,
      description,
      images: imageUrl ? [imageUrl] : undefined,
    },
  };
}

export default async function PublicPostPage({ params }: PublicPostPageProps) {
  const { postId } = await params;
  const post = await fetchPublicPostById(postId);

  if (!post) {
    notFound();
  }

  const publicPost = toPublicPostView(post);
  const postUrl = buildPublicPostUrl(publicPost.id);

  return <PublicPostPageClient post={publicPost} postUrl={postUrl} />;
}