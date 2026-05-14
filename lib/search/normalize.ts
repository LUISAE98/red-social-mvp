const MULTIPLE_SPACES_REGEX = /\s+/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const NON_SEARCH_CHARS_REGEX = /[^a-z0-9ñ\s_-]/g;

export function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .toLowerCase()
    .replace(NON_SEARCH_CHARS_REGEX, " ")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(MULTIPLE_SPACES_REGEX, " ")
    .trim();
}

export function tokenizeSearchText(value: unknown): string[] {
  const normalized = normalizeSearchText(value);

  if (!normalized) return [];

  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  return Array.from(new Set(tokens)).slice(0, 30);
}

export function buildSearchPrefixes(
  tokens: string[],
  options?: {
    minLength?: number;
    maxLength?: number;
    maxPrefixes?: number;
  }
): string[] {
  const minLength = options?.minLength ?? 2;
  const maxLength = options?.maxLength ?? 12;
  const maxPrefixes = options?.maxPrefixes ?? 80;

  const prefixes = new Set<string>();

  for (const rawToken of tokens) {
    const token = normalizeSearchText(rawToken);

    if (token.length < minLength) continue;

    const upperLimit = Math.min(token.length, maxLength);

    for (let length = minLength; length <= upperLimit; length += 1) {
      prefixes.add(token.slice(0, length));

      if (prefixes.size >= maxPrefixes) {
        return Array.from(prefixes);
      }
    }
  }

  return Array.from(prefixes);
}

export function normalizeSearchTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const tags = value
    .map((item) => normalizeSearchText(item))
    .filter((tag) => tag.length >= 2);

  return Array.from(new Set(tags)).slice(0, 20);
}

export function mergeSearchTokens(...groups: Array<string[] | undefined | null>): string[] {
  const tokens = new Set<string>();

  for (const group of groups) {
    if (!Array.isArray(group)) continue;

    for (const token of group) {
      const normalized = normalizeSearchText(token);

      if (normalized.length >= 2) {
        tokens.add(normalized);
      }

      if (tokens.size >= 40) {
        return Array.from(tokens);
      }
    }
  }

  return Array.from(tokens);
}