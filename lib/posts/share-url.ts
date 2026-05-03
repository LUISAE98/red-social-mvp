export function getBaseAppUrl(): string {
  const rawBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "";

  const cleanBaseUrl = rawBaseUrl.trim().replace(/\/+$/, "");

  if (cleanBaseUrl) {
    return cleanBaseUrl;
  }

  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }

  return "http://localhost:3000";
}

export function buildPublicPostPath(postId: string): string {
  const cleanPostId = postId.trim();

  if (!cleanPostId) {
    return "/";
  }

  return `/p/${encodeURIComponent(cleanPostId)}`;
}

export function buildPublicPostUrl(postId: string): string {
  return `${getBaseAppUrl()}${buildPublicPostPath(postId)}`;
}