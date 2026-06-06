import type { FieldValue, Timestamp } from "firebase/firestore";
import {
  buildSearchPrefixes,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/lib/search/normalize";
import type {
  GroupVisibility,
  PostAccessScope,
  PostPremiumAccessMode,
  PostPremiumFreeFor,
} from "./types";

export const POST_SEARCH_INDEX_VERSION = 2;

export type PostSearchTimestamp = Timestamp | FieldValue | null | undefined;

export type BuildPostSearchIndexInput = {
  text?: string | null;

  groupId: string;
  authorId: string;

  groupVisibility: GroupVisibility;
  groupName?: string | null;
  groupAvatarUrl?: string | null;

  accessScope?: PostAccessScope | null;
  isDeleted?: boolean;

  premiumEnabled?: boolean;
  premiumAccessMode?: PostPremiumAccessMode | null;
  premiumFreeFor?: PostPremiumFreeFor | null;

  createdAt?: PostSearchTimestamp;
  updatedAt?: PostSearchTimestamp;
};

function pickSearchString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function buildPostSearchIndex(input: BuildPostSearchIndexInput) {
  const textNormalized = normalizeSearchText(input.text ?? "");
  const tokens = tokenizeSearchText(textNormalized);

  const prefixes = buildSearchPrefixes(tokens, {
    minLength: 2,
    maxLength: 20,
    maxPrefixes: 120,
  });

  const groupName = pickSearchString(input.groupName);
  const groupAvatarUrl = pickSearchString(input.groupAvatarUrl);

  return {
    textNormalized,
    tokens,
    prefixes,

    groupId: input.groupId,
    authorId: input.authorId,

    visibility: input.groupVisibility,
    groupVisibility: input.groupVisibility,
    groupName,
    groupAvatarUrl,

    accessScope: input.accessScope ?? "group",

    premiumEnabled: input.premiumEnabled === true,
    premiumAccessMode: input.premiumAccessMode ?? null,
    premiumFreeFor: input.premiumFreeFor ?? null,

    isDeleted: input.isDeleted === true,

    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,

    version: POST_SEARCH_INDEX_VERSION,
  };
}