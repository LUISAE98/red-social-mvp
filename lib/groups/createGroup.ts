import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  Group,
  GroupVisibility,
  GroupOffering,
  Currency,
  CreatorServiceType,
  ServiceSourceScope,
  GroupDonationSettings,
  DonationMode,
  DonationSourceScope,
} from "@/types/group";

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

function isValidCurrency(value: unknown): value is Currency {
  return value === "MXN" || value === "USD";
}

function isValidServiceSourceScope(value: unknown): value is ServiceSourceScope {
  return value === "group" || value === "profile" || value === "both";
}

function isValidDonationMode(value: unknown): value is DonationMode {
  return value === "none" || value === "general" || value === "wedding";
}

function isValidDonationSourceScope(value: unknown): value is DonationSourceScope {
  return value === "group" || value === "profile";
}

function normalizeSuggestedAmounts(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  const cleaned = value
    .map((item) => Number(item))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Number(n))
    .slice(0, 12);

  return Array.from(new Set(cleaned));
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOfferings(params: {
  offerings: any[];
  groupIsPaid: boolean;
}): GroupOffering[] {
  const { offerings, groupIsPaid } = params;

  const allowedTypes = new Set<CreatorServiceType>([
    "saludo",
    "consejo",
    "meet_greet_digital",
    "mensaje",
  ]);

  return offerings.map((o) => {
    const type = (o?.type ?? "").toString() as CreatorServiceType;
    if (!allowedTypes.has(type)) {
      throw new Error("Tipo de servicio inválido.");
    }

    const enabled = !!o?.enabled;

    // Compatibilidad legacy:
    // - Antes: price + currency
    // - Ahora: memberPrice/publicPrice + currency
    const legacyPrice = o?.price ?? null;

    const memberPriceRaw = o?.memberPrice ?? legacyPrice ?? null;
    const publicPriceRaw =
      o?.publicPrice ?? (groupIsPaid ? null : memberPriceRaw) ?? null;

    const currencyRaw = o?.currency ?? null;

    const memberPrice = memberPriceRaw == null ? null : Number(memberPriceRaw);
    const publicPrice = publicPriceRaw == null ? null : Number(publicPriceRaw);
    const currency = currencyRaw == null ? null : (currencyRaw as Currency);

    // Validaciones de precio
    if (memberPrice != null && !isFinitePositiveNumber(memberPrice)) {
      throw new Error("memberPrice inválido en servicios (debe ser > 0).");
    }
    if (publicPrice != null && !isFinitePositiveNumber(publicPrice)) {
      throw new Error("publicPrice inválido en servicios (debe ser > 0).");
    }

    // Si hay precio, debe haber moneda
    const hasAnyPrice = memberPrice != null || publicPrice != null;
    if (hasAnyPrice && !currency) {
      throw new Error("Si hay precio en servicios, debes seleccionar moneda.");
    }
    if (!hasAnyPrice && currency) {
      throw new Error("Si hay moneda en servicios, debes definir al menos un precio.");
    }

    // Si el grupo no es de paga, el precio público queda igual al de miembro
    const finalPublicPrice = groupIsPaid ? publicPrice : memberPrice;

    const visible = typeof o?.visible === "boolean" ? o.visible : enabled;

    const requiresApproval =
      typeof o?.requiresApproval === "boolean" ? o.requiresApproval : true;

    const sourceScope: ServiceSourceScope = isValidServiceSourceScope(o?.sourceScope)
      ? o.sourceScope
      : "group";

    return {
      type,
      enabled,
      visible,
      memberPrice,
      publicPrice: finalPublicPrice ?? null,
      currency: currency ?? null,
      requiresApproval,
      sourceScope,
    };
  });
}

function normalizeDonation(inputDonation: unknown): GroupDonationSettings {
  const raw = (inputDonation ?? {}) as Partial<GroupDonationSettings>;

  const mode: DonationMode = isValidDonationMode(raw.mode) ? raw.mode : "none";
  const sourceScope: DonationSourceScope = isValidDonationSourceScope(raw.sourceScope)
    ? raw.sourceScope
    : "group";
  const currency: Currency = isValidCurrency(raw.currency) ? raw.currency : "MXN";

  const title = normalizeNullableText(raw.title);
  const description = normalizeNullableText(raw.description);
  const goalLabel = normalizeNullableText(raw.goalLabel);
  const suggestedAmounts = normalizeSuggestedAmounts(raw.suggestedAmounts);

  if (mode === "none") {
    return {
      mode: "none",
      enabled: false,
      visible: false,
      currency,
      sourceScope,
      title,
      description,
      suggestedAmounts,
      goalLabel: null,
    };
  }

  return {
    mode,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    visible: typeof raw.visible === "boolean" ? raw.visible : true,
    currency,
    sourceScope,
    title,
    description,
    suggestedAmounts,
    goalLabel: mode === "wedding" ? goalLabel : null,
  };
}

export async function createGroup(input: CreateGroupInput): Promise<string> {
  if (!input.ownerId) throw new Error("ownerId requerido");
  if (!input.name?.trim()) throw new Error("Nombre requerido");
  if (!input.description?.trim()) throw new Error("Descripción requerida");

  const visibility: GroupVisibility = input.visibility;
  if (!["public", "private", "hidden"].includes(visibility)) {
    throw new Error("Visibilidad inválida");
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

  const monetization = input.monetization ?? {
    isPaid: false,
    priceMonthly: null,
    currency: null,
  };

  const finalIsPaid = visibility === "public" ? false : !!monetization.isPaid;

  if (finalIsPaid) {
    if (monetization.priceMonthly == null || !(monetization.priceMonthly > 0)) {
      throw new Error("Si es con suscripción, el precio mensual debe ser mayor a 0.");
    }
    if (!monetization.currency) {
      throw new Error("Si es con suscripción, selecciona moneda.");
    }
  }

  const rawOfferings = Array.isArray(input.offerings) ? input.offerings : [];
  const offerings = rawOfferings.length
    ? normalizeOfferings({ offerings: rawOfferings, groupIsPaid: finalIsPaid })
    : [];

  const donation = normalizeDonation(input.donation);

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

    greetingsEnabled: !!input.greetingsEnabled,
    welcomeMessage: input.greetingsEnabled
      ? input.welcomeMessage?.toString().trim() || null
      : null,

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
    donation,

    isActive: true,

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