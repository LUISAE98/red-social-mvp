import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  buildNormalizedGroupCommerceState,
} from "@/lib/groups/groupServiceCatalog";
import type {
  Group,
  GroupVisibility,
} from "@/types/group";

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(
    new Set(
      tags
        .map((t) => (t ?? "").toString().trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 10);
}

type CreateGroupInput = Omit<Group, "id" | "createdAt" | "updatedAt">;

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
      typeof input.greetingsEnabled === "boolean" ? input.greetingsEnabled : undefined,
  });

  const payload: Omit<Group, "id"> = {
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

    // Legacy temporal controlado
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

    createdAt: serverTimestamp() as any,
    updatedAt: serverTimestamp() as any,
  };

  const groupRef = await addDoc(collection(db, "groups"), payload);
  const groupId = groupRef.id;

  await setDoc(doc(db, "groups", groupId, "members", input.ownerId), {
    userId: input.ownerId,
    roleInGroup: "owner",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return groupId;
}