import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Group, GroupVisibility } from "@/types/group";

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (t ?? "").toString().trim())
    .filter(Boolean)
    .slice(0, 10);
}

type CreateGroupInput = Omit<Group, "id" | "createdAt" | "updatedAt">;

export async function createGroup(input: CreateGroupInput): Promise<string> {
  // Validaciones mínimas
  if (!input.ownerId) throw new Error("ownerId requerido");
  if (!input.name?.trim()) throw new Error("Nombre requerido");
  if (!input.description?.trim()) throw new Error("Descripción requerida");

  const visibility: GroupVisibility = input.visibility;
  if (!["public", "private", "hidden"].includes(visibility)) throw new Error("Visibilidad inválida");

  // Edad (grupo)
  const ageMin = input.ageMin ?? null;
  const ageMax = input.ageMax ?? null;
  if (ageMin != null && (ageMin < 18 || ageMin > 99)) throw new Error("Edad mínima inválida (18–99).");
  if (ageMax != null && (ageMax < 18 || ageMax > 99)) throw new Error("Edad máxima inválida (18–99).");
  if (ageMin != null && ageMax != null && ageMin > ageMax) throw new Error("Edad mínima > edad máxima.");

  // Monetización: si es public, NO puede ser de paga
  const monetization = input.monetization ?? { isPaid: false, priceMonthly: null, currency: null };
  const finalIsPaid = visibility === "public" ? false : !!monetization.isPaid;

  if (finalIsPaid) {
    if (monetization.priceMonthly == null || !(monetization.priceMonthly > 0)) {
      throw new Error("Si es con suscripción, el precio mensual debe ser mayor a 0.");
    }
    if (!monetization.currency) {
      throw new Error("Si es con suscripción, selecciona moneda.");
    }
  }

  // Offerings (servicios del creador)
  const offerings = Array.isArray(input.offerings) ? input.offerings : [];
  if (offerings.length) {
    for (const o of offerings) {
      if (!["saludo", "consejo", "mensaje"].includes((o as any).type)) {
        throw new Error("Tipo de servicio inválido.");
      }
      const price = (o as any).price ?? null;
      const curr = (o as any).currency ?? null;

      if (price != null) {
        if (!(price > 0) || !Number.isFinite(price)) throw new Error("Precio inválido en servicios.");
      }
      // Si hay precio debe haber moneda y viceversa
      if ((price == null) !== (curr == null)) throw new Error("Si hay precio debe haber moneda (y viceversa).");
    }
  }

  const payload: Omit<Group, "id"> = {
    name: input.name.trim(),
    description: input.description.trim(),

    imageUrl: input.imageUrl ?? null,
    coverUrl: input.coverUrl ?? null,
    avatarUrl: input.avatarUrl ?? null,

    ownerId: input.ownerId,
    visibility,

    // discoverable: true salvo hidden, pero respetamos si viene explícito
    discoverable: typeof input.discoverable === "boolean" ? input.discoverable : visibility !== "hidden",

    category: input.category ?? "otros",
    tags: normalizeTags(input.tags),

    greetingsEnabled: !!input.greetingsEnabled,
    welcomeMessage: input.greetingsEnabled ? (input.welcomeMessage?.toString().trim() || null) : null,

    ageMin,
    ageMax,

    permissions: {
      postingMode: input.permissions?.postingMode ?? "members",
      commentsEnabled: input.permissions?.commentsEnabled ?? true,
    },

    monetization: {
      isPaid: finalIsPaid,
      priceMonthly: finalIsPaid ? monetization.priceMonthly : null,
      currency: finalIsPaid ? monetization.currency : null,
    },

    offerings,

    isActive: true,

    createdAt: serverTimestamp() as any,
    updatedAt: serverTimestamp() as any,
  };

  // 1) Crear group
  const groupRef = await addDoc(collection(db, "groups"), payload);
  const groupId = groupRef.id;

  // 2) Crear membership del owner
  await setDoc(doc(db, "groups", groupId, "members", input.ownerId), {
    userId: input.ownerId,
    roleInGroup: "owner",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return groupId;
}