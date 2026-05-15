import type { FieldValue, Timestamp } from "firebase/firestore";
import {
  buildSearchPrefixes,
  normalizeSearchText,
  tokenizeSearchText,
} from "@/lib/search/normalize";
import type { GroupVisibility, PostAccessScope } from "./types";

export const POST_SEARCH_INDEX_VERSION = 1;

export type PostSearchTimestamp = Timestamp | FieldValue | null | undefined;

export type BuildPostSearchIndexInput = {
  text?: string | null;
  groupId: string;
  authorId: string;
  groupVisibility: GroupVisibility;
  accessScope?: PostAccessScope | null;
  isDeleted?: boolean;
  createdAt?: PostSearchTimestamp;
  updatedAt?: PostSearchTimestamp;
};

export function buildPostSearchIndex(input: BuildPostSearchIndexInput) {
  const textNormalized = normalizeSearchText(input.text ?? "");
  const tokens = tokenizeSearchText(textNormalized);

  const prefixes = buildSearchPrefixes(tokens, {
    minLength: 2,
    maxLength: 20,
    maxPrefixes: 120,
  });

  return {
    textNormalized,
    tokens,
    prefixes,
    groupId: input.groupId,
    authorId: input.authorId,
    visibility: input.groupVisibility,
    accessScope: input.accessScope ?? "group",
    isDeleted: input.isDeleted === true,
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
    version: POST_SEARCH_INDEX_VERSION,
  };
}