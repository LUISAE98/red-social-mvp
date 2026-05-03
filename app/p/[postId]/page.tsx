import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublicPostById } from "@/lib/posts/public-post-service";
import { buildPublicPostUrl } from "@/lib/posts/share-url";
import PublicPostPageClient from "./PublicPostPageClient";

type PublicPostPageProps = {
  params: {
    postId: string;
  };
};

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

  const title = post.shareTitle || "Publicación";
  const description =
    post.shareDescription || "Mira esta publicación en Vibra.";
  const url = buildPublicPostUrl(post.id);
  const imageUrl = post.shareImageUrl || undefined;

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

  return <PublicPostPageClient post={post} />;
}