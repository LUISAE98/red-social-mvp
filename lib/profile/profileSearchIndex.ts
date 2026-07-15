import {
  buildSearchPrefixes,
  mergeSearchTokens,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/lib/search/normalize";

export const PROFILE_SEARCH_INDEX_VERSION = 1;

const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 20;
const MAX_PROFILE_SEARCH_PREFIXES = 120;

export type ProfileSearchIndex = {
  nameNormalized: string;
  displayNameNormalized: string;
  firstNameNormalized: string;
  lastNameNormalized: string;
  handleNormalized: string;
  tokens: string[];
  prefixes: string[];
  isActive: boolean;
  profileSearchable: boolean;
  updatedAt: unknown | null;
  version: typeof PROFILE_SEARCH_INDEX_VERSION;
};

export type BuildProfileSearchIndexInput = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  handle?: string | null;
  username?: string | null;
  /**
   * Intereses del perfil (categorías canónicas). Se tokenizan e incluyen en
   * el índice para que una búsqueda como "viajes" o "autos" también devuelva
   * perfiles que seleccionaron esa categoría como interés.
   */
  interests?: string[] | null;
  isActive?: boolean | null;
  profileSearchable?: boolean | null;
  updatedAt?: unknown | null;
};

/**
 * Convierte los intereses canónicos en tokens de búsqueda.
 * Ej: "moda_belleza" -> ["moda", "belleza"], "viajes" -> ["viajes"].
 */
function buildInterestSearchTokens(interests?: string[] | null): string[] {
  if (!Array.isArray(interests) || interests.length === 0) return [];
  const text = interests
    .filter((value): value is string => typeof value === "string" && !!value)
    .map((value) => value.replace(/_/g, " "))
    .join(" ");
  return tokenizeSearchText(text);
}

export function buildProfileSearchIndex(
  profile: BuildProfileSearchIndexInput
): ProfileSearchIndex {
  const handleNormalized = normalizeHandleForSearch(
    profile.handle ?? profile.username
  );

  const firstNameNormalized = normalizeSearchText(profile.firstName);
  const lastNameNormalized = normalizeSearchText(profile.lastName);

  const fallbackDisplayName = [profile.firstName, profile.lastName]
    .filter(Boolean)
    .join(" ");

  const displayNameNormalized = normalizeSearchText(
    profile.displayName || fallbackDisplayName
  );

  const nameNormalized = normalizeSearchText(
    [
      displayNameNormalized,
      firstNameNormalized,
      lastNameNormalized,
      handleNormalized,
    ].join(" ")
  );

  const displayNameTokens = tokenizeSearchText(displayNameNormalized);
  const firstNameTokens = tokenizeSearchText(firstNameNormalized);
  const lastNameTokens = tokenizeSearchText(lastNameNormalized);
  const nameTokens = tokenizeSearchText(nameNormalized);

  const handleTokens = buildHandleSearchTokens(handleNormalized);
  const interestTokens = buildInterestSearchTokens(profile.interests);

  const tokens = mergeSearchTokens(
    handleTokens,
    displayNameTokens,
    firstNameTokens,
    lastNameTokens,
    nameTokens,
    interestTokens
  );

  const textPrefixes = buildSearchPrefixes(tokens, {
    minLength: MIN_PREFIX_LENGTH,
    maxLength: 15,
    maxPrefixes: 80,
  });

  const handlePrefixes = buildHandlePrefixes(handleNormalized);

  const prefixes = uniqueLimited(
    [...handlePrefixes, ...textPrefixes],
    MAX_PROFILE_SEARCH_PREFIXES
  );

  return {
    nameNormalized,
    displayNameNormalized,
    firstNameNormalized,
    lastNameNormalized,
    handleNormalized,
    tokens,
    prefixes,
    isActive: profile.isActive !== false,
    profileSearchable: profile.profileSearchable !== false,
    updatedAt: profile.updatedAt ?? null,
    version: PROFILE_SEARCH_INDEX_VERSION,
  };
}

export function buildProfileSearchIndexPatch(
  profile: BuildProfileSearchIndexInput
): { search: ProfileSearchIndex } {
  return {
    search: buildProfileSearchIndex(profile),
  };
}

export function normalizeHandleForSearch(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX_PREFIX_LENGTH);
}

function buildHandleSearchTokens(handleNormalized: string): string[] {
  if (!handleNormalized) return [];

  const collapsedHandle = handleNormalized.replace(/_/g, "");
  const splitHandleTokens = handleNormalized
    .split("_")
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_PREFIX_LENGTH);

  return uniqueLimited(
    [handleNormalized, collapsedHandle, ...splitHandleTokens],
    10
  );
}

function buildHandlePrefixes(handleNormalized: string): string[] {
  if (handleNormalized.length < MIN_PREFIX_LENGTH) return [];

  const prefixes = new Set<string>();
  const maxLength = Math.min(handleNormalized.length, MAX_PREFIX_LENGTH);

  for (let length = MIN_PREFIX_LENGTH; length <= maxLength; length += 1) {
    prefixes.add(handleNormalized.slice(0, length));
  }

  const collapsedHandle = handleNormalized.replace(/_/g, "");

  if (collapsedHandle.length >= MIN_PREFIX_LENGTH) {
    const collapsedMaxLength = Math.min(
      collapsedHandle.length,
      MAX_PREFIX_LENGTH
    );

    for (
      let length = MIN_PREFIX_LENGTH;
      length <= collapsedMaxLength;
      length += 1
    ) {
      prefixes.add(collapsedHandle.slice(0, length));
    }
  }

  return Array.from(prefixes);
}

function uniqueLimited(values: string[], limit: number): string[] {
  const result = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();

    if (normalized.length < MIN_PREFIX_LENGTH) continue;

    result.add(normalized);

    if (result.size >= limit) break;
  }

  return Array.from(result);
}