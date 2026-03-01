import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Group, GroupVisibility, GroupOffering, Currency } from "@/types/group";

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (t ?? "").toString().trim())
    .filter(Boolean)
    .slice(0, 10);
}

type CreateGroupInput = Omit<Group, "id" | "createdAt" | "updatedAt">;

function isFinitePositiveNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function normalizeOfferings(params: {
  offerings: any[];
  groupIsPaid: boolean;
}): GroupOffering[] {
  const { offerings, groupIsPaid } = params;

  const allowedTypes = new Set(["saludo", "consejo", "mensaje"]);

  return offerings.map((o) => {
    const type = (o?.type ?? "").toString();
    if (!allowedTypes.has(type)) throw new Error("Tipo de servicio inválido.");

    const enabled = !!o?.enabled;

    // Compatibilidad legacy:
    // - Antes: price + currency
    // - Ahora: memberPrice/publicPrice + currency
    const legacyPrice = o?.price ?? null;

    const memberPriceRaw = o?.memberPrice ?? legacyPrice ?? null;
    const publicPriceRaw = o?.publicPrice ?? (groupIsPaid ? null : memberPriceRaw) ?? null;

    const currencyRaw = o?.currency ?? null;

    const memberPrice = memberPriceRaw == null ? null : Number(memberPriceRaw);
    const publicPrice = publicPriceRaw == null ? null : Number(publicPriceRaw);
    const currency = currencyRaw == null ? null : (currencyRaw as Currency);

    // Validaciones:
    // 1) Si hay precio(s), deben ser > 0
    if (memberPrice != null && !isFinitePositiveNumber(memberPrice)) {
      throw new Error("memberPrice inválido en servicios (debe ser > 0).");
    }
    if (publicPrice != null && !isFinitePositiveNumber(publicPrice)) {
      throw new Error("publicPrice inválido en servicios (debe ser > 0).");
    }

    // 2) Si existe cualquier precio, debe existir moneda
    const hasAnyPrice = memberPrice != null || publicPrice != null;
    if (hasAnyPrice && !currency) {
      throw new Error("Si hay precio en servicios, debes seleccionar moneda.");
    }
    if (!hasAnyPrice && currency) {
      throw new Error("Si hay moneda en servicios, debes definir al menos un precio.");
    }

    // 3) Si el grupo NO es de paga, publicPrice debe ser igual a memberPrice (o null)
    //    Para simplificar el MVP: si viene distinto, lo forzamos a memberPrice.
    const finalPublicPrice = groupIsPaid ? publicPrice : memberPrice;

    return {
      type: type as GroupOffering["type"],
      enabled,
      memberPrice,
      publicPrice: finalPublicPrice ?? null,
      currency: currency ?? null,
    };
  });
}

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
  const rawOfferings = Array.isArray(input.offerings) ? input.offerings : [];
  const offerings = rawOfferings.length
    ? normalizeOfferings({ offerings: rawOfferings, groupIsPaid: finalIsPaid })
    : [];

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