import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublicPostById } from "@/lib/posts/public-post-service";
import { buildPublicPostUrl } from "@/lib/posts/share-url";
import PublicPostPageClient, {
  type PublicPostView,
} from "./PublicPostPageClient";

type PublicPostPageProps = {
  params: {
    postId: string;
  };
};

function formatPublicDate(value: any): string | null {
  if (!value?.toDate) {
    return null;
  }

  try {
    return new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value.toDate());
  } catch {
    return null;
  }
}

function toPublicPostView(post: any): PublicPostView {
  const media = Array.isArray(post.media)
    ? post.media
        .filter((item: any) => {
          return (
            item &&
            (item.type === "image" || item.type === "video") &&
            typeof item.url === "string" &&
            item.url.trim().length > 0
          );
        })
        .map((item: any) => ({
          type: item.type,
          url: item.url,
          thumbnailUrl:
            typeof item.thumbnailUrl === "string" ? item.thumbnailUrl : null,
          altText: typeof item.altText === "string" ? item.altText : null,
        }))
    : [];

  return {
    id: post.id,
    text: typeof post.text === "string" ? post.text : "",
    authorName:
      typeof post.authorName === "string" && post.authorName.trim()
        ? post.authorName
        : "Usuario",
    authorUsername:
      typeof post.authorUsername === "string" ? post.authorUsername : null,
    authorAvatarUrl:
      typeof post.authorAvatarUrl === "string" ? post.authorAvatarUrl : null,
    groupName:
      typeof post.groupName === "string" && post.groupName.trim()
        ? post.groupName
        : "Comunidad",
    createdAtLabel: formatPublicDate(post.createdAt),
    shareTitle:
      typeof post.shareTitle === "string" && post.shareTitle.trim()
        ? post.shareTitle
        : "Publicación",
    shareDescription:
      typeof post.shareDescription === "string" ? post.shareDescription : null,
    shareImageUrl:
      typeof post.shareImageUrl === "string" && post.shareImageUrl.trim()
        ? post.shareImageUrl
        : media[0]?.thumbnailUrl || media[0]?.url || null,
    counts: {
      likes:
        typeof post.counts?.likes === "number" ? post.counts.likes : 0,
      comments:
        typeof post.counts?.comments === "number" ? post.counts.comments : 0,
    },
    media,
  };
}

export async function generateMetadata({
  params,
}: PublicPostPageProps): Promise<Metadata> {
  const post = await fetchPublicPostById(params.postId);

  if (!post) {
    return {
      title: "Publicación no disponible",
      description: "Esta publicación no existe o no está disponible públicamente.",
    };
  }

  const publicPost = toPublicPostView(post);
  const title = publicPost.shareTitle || "Publicación";
  const description =
    publicPost.shareDescription || "Mira esta publicación en Vibra.";
  const url = buildPublicPostUrl(publicPost.id);
  const imageUrl = publicPost.shareImageUrl || undefined;

  return {
    title,
    description,
    alternates: {
      canonical: url,
    },
    openGraph: {
      title,
      description,
      url,
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
  const post = await fetchPublicPostById(params.postId);

  if (!post) {
    notFound();
  }

  const publicPost = toPublicPostView(post);
  const postUrl = buildPublicPostUrl(publicPost.id);

  return <PublicPostPageClient post={publicPost} postUrl={postUrl} />;
}