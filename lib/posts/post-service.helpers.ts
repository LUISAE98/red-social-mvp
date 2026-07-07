// post-service.helpers.ts
// Formateadores y normalizadores puros extraídos de post-service.ts.
// Sin estado de módulo, sin acceso a Firestore ni a caches: solo transforman
// datos de entrada. Seguros de testear y reutilizar de forma aislada.

import type { Timestamp } from "firebase/firestore";
import type { GroupVisibility } from "./types";

export type PostingMode = "members" | "owner_only";

export function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function assertValidId(value: string, label: string) {
  if (!value || !value.trim()) {
    throw new Error(`Falta ${label}.`);
  }
}

export function normalizeGroupVisibility(value: unknown): GroupVisibility | null {
  if (value === "public" || value === "private" || value === "hidden") {
    return value;
  }
  return null;
}

export function normalizePostingMode(value: unknown): PostingMode {
  return value === "owner_only" ? "owner_only" : "members";
}

export function normalizeCommentsEnabled(value: unknown): boolean {
  return value !== false;
}

export function readGroupName(data: Record<string, unknown>): string | null {
  return (
    pickString(data.name) ||
    pickString(data.title) ||
    pickString(data.groupName) ||
    pickString(data.displayName) ||
    null
  );
}

export function readGroupAvatarUrl(data: Record<string, unknown>): string | null {
  return (
    pickString(data.avatarUrl) ||
    pickString(data.photoURL) ||
    pickString(data.imageUrl) ||
    pickString(data.groupAvatarUrl) ||
    null
  );
}

export function getTimestampDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof (value as { toDate?: unknown }).toDate === "function") {
    const d = (value as { toDate: () => unknown }).toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function readTimestampMillis(value: unknown): number | null {
  if (!value) return null;

  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof (value as Timestamp).toMillis === "function"
  ) {
    const millis = (value as Timestamp).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    const millis = date.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  return null;
}

export function readProfileDisplayName(data: Record<string, unknown>): string | null {
  return (
    pickString(data.displayName) ||
    pickString(data.name) ||
    [pickString(data.firstName), pickString(data.lastName)]
      .filter(Boolean)
      .join(" ")
      .trim() ||
    pickString(data.username) ||
    pickString(data.handle) ||
    null
  );
}

export function readProfileAvatarUrl(data: Record<string, unknown>): string | null {
  return (
    pickString(data.avatarUrl) ||
    pickString(data.photoURL) ||
    pickString(data.imageUrl) ||
    null
  );
}

export function truncateForShare(value: string, maxLength = 160): string {
  const cleanValue = value.trim().replace(/\s+/g, " ");

  if (cleanValue.length <= maxLength) {
    return cleanValue;
  }

  return `${cleanValue.slice(0, maxLength - 1).trim()}…`;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
}

export function isProfileRestricted(data: Record<string, unknown>): boolean {
  return data.profileRestricted === true;
}
