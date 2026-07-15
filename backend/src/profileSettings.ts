import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp();
}

const db = getFirestore();

const DISPLAY_NAME_COOLDOWN_DAYS = 60;
const DISPLAY_NAME_COOLDOWN_MS =
  DISPLAY_NAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

const PROFILE_SEARCH_INDEX_VERSION = 1;
const MIN_PREFIX_LENGTH = 2;
const MAX_PREFIX_LENGTH = 20;
const MAX_PROFILE_SEARCH_PREFIXES = 120;

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s_-]/g, " ")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value: unknown): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];

  return Array.from(
    new Set(
      normalized
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= MIN_PREFIX_LENGTH)
    )
  ).slice(0, 30);
}

function normalizeHandleForSearch(value: unknown): string {
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

function buildSearchPrefixes(
  tokens: string[],
  options?: {
    minLength?: number;
    maxLength?: number;
    maxPrefixes?: number;
  }
): string[] {
  const minLength = options?.minLength ?? MIN_PREFIX_LENGTH;
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

function mergeSearchTokens(...groups: Array<string[] | undefined | null>): string[] {
  const tokens = new Set<string>();

  for (const group of groups) {
    if (!Array.isArray(group)) continue;

    for (const token of group) {
      const normalized = normalizeSearchText(token);

      if (normalized.length >= MIN_PREFIX_LENGTH) {
        tokens.add(normalized);
      }

      if (tokens.size >= 40) {
        return Array.from(tokens);
      }
    }
  }

  return Array.from(tokens);
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

function buildInterestSearchTokens(interests?: unknown): string[] {
  if (!Array.isArray(interests) || interests.length === 0) return [];
  const text = interests
    .filter((value): value is string => typeof value === "string" && !!value)
    .map((value) => value.replace(/_/g, " "))
    .join(" ");
  return tokenizeSearchText(text);
}

function buildProfileSearchIndex({
  displayName,
  firstName,
  lastName,
  handle,
  interests,
  isActive,
  profileSearchable,
  updatedAt,
}: {
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  handle?: unknown;
  interests?: unknown;
  isActive?: unknown;
  profileSearchable?: unknown;
  updatedAt: Timestamp;
}) {
  const handleNormalized = normalizeHandleForSearch(handle);
  const firstNameNormalized = normalizeSearchText(firstName);
  const lastNameNormalized = normalizeSearchText(lastName);

  const fallbackDisplayName = [firstName, lastName]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ");

  const displayNameNormalized = normalizeSearchText(
    typeof displayName === "string" && displayName.trim()
      ? displayName
      : fallbackDisplayName
  );

  const nameNormalized = normalizeSearchText(
    [
      displayNameNormalized,
      firstNameNormalized,
      lastNameNormalized,
      handleNormalized,
    ].join(" ")
  );

  const tokens = mergeSearchTokens(
    buildHandleSearchTokens(handleNormalized),
    tokenizeSearchText(displayNameNormalized),
    tokenizeSearchText(firstNameNormalized),
    tokenizeSearchText(lastNameNormalized),
    tokenizeSearchText(nameNormalized),
    buildInterestSearchTokens(interests)
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
    isActive: isActive !== false,
    profileSearchable: profileSearchable !== false,
    updatedAt,
    version: PROFILE_SEARCH_INDEX_VERSION,
  };
}

function getDateFromUnknown(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate();
  }

  return null;
}

export const updateProfileDisplayName = onCall(
  {
    region: "us-central1",
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para cambiar tu nombre."
      );
    }

    const nextDisplayName = normalizeDisplayName(request.data?.displayName);

    if (nextDisplayName.length < 3) {
      throw new HttpsError(
        "invalid-argument",
        "El nombre debe tener al menos 3 caracteres."
      );
    }

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Perfil no encontrado.");
    }

    const userData = userSnap.data() ?? {};
    const lastChangedAt = getDateFromUnknown(
      userData.displayNameLastChangedAt
    );

    if (lastChangedAt) {
      const nextAllowedAt =
        lastChangedAt.getTime() + DISPLAY_NAME_COOLDOWN_MS;

      if (Date.now() < nextAllowedAt) {
        const remainingMs = nextAllowedAt - Date.now();
        const remainingDays = Math.ceil(
          remainingMs / (24 * 60 * 60 * 1000)
        );

        throw new HttpsError(
          "failed-precondition",
          `Podrás cambiar tu nombre nuevamente en ${remainingDays} día(s).`
        );
      }
    }

    const now = Timestamp.now();

    await userRef.update({
      displayName: nextDisplayName,
      displayNameLastChangedAt: now,
      updatedAt: now,
      search: buildProfileSearchIndex({
        displayName: nextDisplayName,
        firstName: userData.firstName,
        lastName: userData.lastName,
        handle: userData.handle,
        interests: userData.interests,
        isActive: userData.isActive,
        profileSearchable: userData.profileSearchable,
        updatedAt: now,
      }),
    });

    await getAuth().updateUser(uid, {
      displayName: nextDisplayName,
    });

    return {
      ok: true,
      displayName: nextDisplayName,
      displayNameLastChangedAt: now.toDate().toISOString(),
    };
  }
);

// Categorías canónicas válidas para intereses de perfil.
// Debe mantenerse en sincronía con GROUP_CATEGORY_OPTIONS de types/group.ts.
const CANONICAL_INTEREST_CATEGORIES = new Set<string>([
  "entretenimiento",
  "musica",
  "creadores",
  "gaming",
  "tecnologia",
  "deportes",
  "fitness_bienestar",
  "educacion",
  "negocios_finanzas",
  "noticias_politica",
  "ciencia",
  "moda_belleza",
  "comida",
  "viajes",
  "autos",
  "mascotas",
  "hobbies",
  "familia_comunidad",
  "instituciones",
  "cine",
  "arte",
  "salud",
  "libros",
  "historia",
  // "otros" se mantiene aceptado por compatibilidad (ya no es seleccionable en UI).
  "otros",
]);

const MAX_PROFILE_INTERESTS = 20;

function normalizeInterestsInput(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const candidate = raw.trim();
    if (!CANONICAL_INTEREST_CATEGORIES.has(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= MAX_PROFILE_INTERESTS) break;
  }

  return result;
}

/**
 * Actualiza los intereses del perfil y reconstruye el índice de búsqueda
 * (incluyendo los tokens de intereses) de forma autoritativa en el servidor,
 * leyendo los campos de nombre/handle existentes para no perder tokens.
 */
export const updateProfileInterests = onCall(
  {
    region: "us-central1",
  },
  async (request) => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Debes iniciar sesión para actualizar tus intereses."
      );
    }

    const interests = normalizeInterestsInput(request.data?.interests);

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Perfil no encontrado.");
    }

    const userData = userSnap.data() ?? {};
    const now = Timestamp.now();

    await userRef.update({
      interests,
      updatedAt: now,
      search: buildProfileSearchIndex({
        displayName: userData.displayName,
        firstName: userData.firstName,
        lastName: userData.lastName,
        handle: userData.handle,
        interests,
        isActive: userData.isActive,
        profileSearchable: userData.profileSearchable,
        updatedAt: now,
      }),
    });

    return {
      ok: true,
      interests,
    };
  }
);