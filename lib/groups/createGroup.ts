import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { buildGroupSearchIndex } from "@/lib/groups/groupSearchIndex";
import { buildNormalizedGroupCommerceState } from "@/lib/groups/groupServiceCatalog";
import type { Group, GroupVisibility } from "@/types/group";

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];

  return Array.from(
    new Set(
      tags
        .map((tag) => (tag ?? "").toString().trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 10);
}

type CreateGroupInput = Omit<Group, "id" | "createdAt" | "updatedAt" | "search">;

function normalizeNullableTrimmedText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function createGroup(input: CreateGroupInput): Promise<string> {
  if (!input.ownerId) throw new Error("ownerId requerido");
  if (!input.name?.trim()) throw new Error("Nombre requerido");
  if (!input.description?.trim()) throw new Error("Descripción requerida");

  const visibility: GroupVisibility = input.visibility;

  if (!["public", "private", "hidden"].includes(visibility)) {
    throw new Error("Visibilidad inválida.");
  }

  const ageMin = input.ageMin ?? null;
  const ageMax = input.ageMax ?? null;

  if (ageMin != null && (ageMin < 18 || ageMin > 99)) {
    throw new Error("Edad mínima inválida (18–99).");
  }

  if (ageMax != null && (ageMax < 18 || ageMax > 99)) {
    throw new Error("Edad máxima inválida (18–99).");
  }

  if (ageMin != null && ageMax != null && ageMin > ageMax) {
    throw new Error("Edad mínima > edad máxima.");
  }

  const commerce = buildNormalizedGroupCommerceState({
    offerings: Array.isArray(input.offerings) ? input.offerings : [],
    monetization: input.monetization,
    donation: input.donation,
    legacyGreetingsEnabled:
      typeof input.greetingsEnabled === "boolean"
        ? input.greetingsEnabled
        : undefined,
  });

  const now = serverTimestamp() as any;

  const baseGroup: Omit<Group, "id" | "createdAt" | "updatedAt" | "search"> = {
    name: input.name.trim(),
    description: input.description.trim(),

    imageUrl: input.imageUrl ?? null,
    coverUrl: input.coverUrl ?? null,
    avatarUrl: input.avatarUrl ?? null,

    ownerId: input.ownerId,
    visibility,

    discoverable:
      typeof input.discoverable === "boolean"
        ? input.discoverable
        : visibility !== "hidden",

    category: input.category ?? "otros",
    tags: normalizeTags(input.tags),

    greetingsEnabled: commerce.monetization.greetingsEnabled,

    welcomeMessage: commerce.monetization.greetingsEnabled
      ? normalizeNullableTrimmedText(input.welcomeMessage)
      : null,

    ageMin,
    ageMax,

    permissions: {
      postingMode: input.permissions?.postingMode ?? "members",
      commentsEnabled: input.permissions?.commentsEnabled ?? true,
    },

    monetization: commerce.monetization,
    offerings: commerce.offerings,
    donation: commerce.donation,

    isActive: typeof input.isActive === "boolean" ? input.isActive : true,
  };

  const payload: Omit<Group, "id"> = {
    ...baseGroup,
    createdAt: now,
    updatedAt: now,
    search: buildGroupSearchIndex({
      name: baseGroup.name,
      description: baseGroup.description,
      category: baseGroup.category,
      tags: baseGroup.tags,
      visibility: baseGroup.visibility,
      discoverable: baseGroup.discoverable,
      isActive: baseGroup.isActive,
      updatedAt: now,
    }),
  };

  const groupRef = doc(collection(db, "groups"));
  const groupId = groupRef.id;

  const memberRef = doc(db, "groups", groupId, "members", input.ownerId);
  const userMembershipRef = doc(
    db,
    "users",
    input.ownerId,
    "groupMemberships",
    groupId
  );

  const batch = writeBatch(db);

  batch.set(groupRef, payload);

  batch.set(memberRef, {
    userId: input.ownerId,
    roleInGroup: "owner",
    status: "active",

    accessType: "standard",
    requiresSubscription: false,
    subscriptionActive: false,

    createdAt: serverTimestamp(),
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  await setDoc(userMembershipRef, {
    groupId,
    userId: input.ownerId,

    roleInGroup: "owner",
    status: "active",
    accessType: "standard",
    requiresSubscription: false,
    subscriptionActive: false,

    groupName: baseGroup.name,
    groupDescription: baseGroup.description,
    groupImageUrl: baseGroup.imageUrl ?? null,
    groupAvatarUrl: baseGroup.avatarUrl ?? null,
    groupCoverUrl: baseGroup.coverUrl ?? null,
    groupOwnerId: baseGroup.ownerId,
    groupVisibility: baseGroup.visibility,
    groupDiscoverable: baseGroup.discoverable,
    groupIsActive: baseGroup.isActive,
    groupCategory: baseGroup.category ?? null,

    createdAt: serverTimestamp(),
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return groupId;
}