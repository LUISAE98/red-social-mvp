const DEFAULT_AUTH_FALLBACK_PATH = "/";

type SearchParamsLike =
  | URLSearchParams
  | {
      toString: () => string;
      get?: (key: string) => string | null;
    }
  | string
  | null
  | undefined;

function normalizeSearchParams(searchParams?: SearchParamsLike): string {
  if (!searchParams) return "";

  if (typeof searchParams === "string") {
    return searchParams.startsWith("?")
      ? searchParams.slice(1)
      : searchParams;
  }

  return searchParams.toString();
}

export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const path = value.trim();

  if (!path) return false;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("\\")) return false;
  if (/[\u0000-\u001F\u007F]/.test(path)) return false;

  try {
    const url = new URL(path, "https://vibra.local");
    return url.origin === "https://vibra.local";
  } catch {
    return false;
  }
}

export function getSafeNextPath(
  next: unknown,
  fallback = DEFAULT_AUTH_FALLBACK_PATH
): string {
  if (isSafeInternalPath(next)) return next;

  if (isSafeInternalPath(fallback)) return fallback;

  return DEFAULT_AUTH_FALLBACK_PATH;
}

export function buildCurrentPathWithSearch(
  pathname: string,
  searchParams?: SearchParamsLike
): string {
  const safePathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const search = normalizeSearchParams(searchParams);

  return search ? `${safePathname}?${search}` : safePathname;
}

export function buildAuthHref(
  authPath: "/login" | "/register",
  pathname: string,
  searchParams?: SearchParamsLike
): string {
  const next = buildCurrentPathWithSearch(pathname, searchParams);
  return `${authPath}?next=${encodeURIComponent(next)}`;
}

export function buildLoginHref(
  pathname: string,
  searchParams?: SearchParamsLike
): string {
  return buildAuthHref("/login", pathname, searchParams);
}

export function buildRegisterHref(
  pathname: string,
  searchParams?: SearchParamsLike
): string {
  return buildAuthHref("/register", pathname, searchParams);
}

export function getNextFromSearchParams(
  searchParams: SearchParamsLike,
  fallback = DEFAULT_AUTH_FALLBACK_PATH
): string {
  if (!searchParams || typeof searchParams === "string") {
    return fallback;
  }

  if (typeof searchParams.get !== "function") {
    return fallback;
  }

  return getSafeNextPath(searchParams.get("next"), fallback);
}

export function appendSafeNextParam(
  authPath: "/login" | "/register",
  next: unknown
): string {
  const safeNext = getSafeNextPath(next);
  return `${authPath}?next=${encodeURIComponent(safeNext)}`;
}