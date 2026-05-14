import type {
  CanonicalGroupCategory,
  Group,
  GroupSearchIndex,
  GroupVisibility,
} from "@/types/group";
import {
  GROUP_CATEGORY_LABELS,
  normalizeGroupCategory,
} from "@/types/group";
import {
  buildSearchPrefixes,
  mergeSearchTokens,
  normalizeSearchTags,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/lib/search/normalize";

type BuildGroupSearchIndexInput = Pick<
  Group,
  | "name"
  | "description"
  | "category"
  | "tags"
  | "visibility"
  | "discoverable"
  | "isActive"
  | "updatedAt"
>;

export function buildGroupSearchIndex(
  group: BuildGroupSearchIndexInput
): GroupSearchIndex {
  const nameNormalized = normalizeSearchText(group.name);
  const descriptionNormalized = normalizeSearchText(group.description);

  const categoryNormalized = normalizeGroupCategory(group.category);
  const categoryLabelNormalized = normalizeCategoryLabel(categoryNormalized);

  const tagsNormalized = normalizeSearchTags(group.tags);

  const nameTokens = tokenizeSearchText(nameNormalized);
  const descriptionTokens = tokenizeSearchText(descriptionNormalized);
  const categoryTokens = tokenizeSearchText(
    [categoryNormalized ?? "", categoryLabelNormalized].join(" ")
  );
  const tagTokens = tokenizeSearchText(tagsNormalized.join(" "));

  const tokens = mergeSearchTokens(
    nameTokens,
    categoryTokens,
    tagTokens,
    descriptionTokens
  );

  const prefixes = buildSearchPrefixes(tokens);

  return {
    nameNormalized,
    descriptionNormalized,
    categoryNormalized,
    categoryLabelNormalized,
    tagsNormalized,
    tokens,
    prefixes,
    visibility: normalizeGroupVisibility(group.visibility),
    discoverable: group.discoverable !== false,
    isActive: group.isActive !== false,
    version: 1,
    updatedAt: group.updatedAt ?? null,
  };
}

export function buildGroupSearchIndexPatch(
  group: BuildGroupSearchIndexInput
): { search: GroupSearchIndex } {
  return {
    search: buildGroupSearchIndex(group),
  };
}

function normalizeCategoryLabel(
  category: CanonicalGroupCategory | null
): string {
  if (!category) return "";

  return normalizeSearchText(GROUP_CATEGORY_LABELS[category] ?? category);
}

function normalizeGroupVisibility(value: unknown): GroupVisibility {
  if (value === "private" || value === "hidden") {
    return value;
  }

  return "public";
}