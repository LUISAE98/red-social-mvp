// Índice de búsqueda de una publicación — LÓGICA COMPARTIDA.
//
// La usan el cliente (al construir el post) y el backend (al construirlo desde
// el callable `createPost`). Tiene que ser idéntica en los dos: si divergen, un
// post creado por un lado no sale en las búsquedas del otro.
//
// Solo lógica PURA: nada de `firebase/firestore` ni de `firebase-admin`. El tipo
// del timestamp se deja abierto a propósito, porque cada lado trae el suyo
// (`Timestamp`/`FieldValue` del cliente, `Timestamp`/`FieldValue` del Admin SDK).

import {
  buildSearchPrefixes,
  normalizeSearchText,
  tokenizeSearchText,
} from "./searchNormalize";

export const POST_SEARCH_INDEX_VERSION = 2;

/** Lo que cada entorno considere una marca de tiempo. */
export type AnyTimestamp = unknown;

export type BuildPostSearchIndexInput = {
  text?: string | null;

  groupId: string;
  authorId: string;

  groupVisibility: string;
  groupName?: string | null;
  groupAvatarUrl?: string | null;

  accessScope?: string | null;
  isDeleted?: boolean;

  premiumEnabled?: boolean;
  premiumAccessMode?: string | null;
  premiumFreeFor?: string | null;

  createdAt?: AnyTimestamp;
  updatedAt?: AnyTimestamp;
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
