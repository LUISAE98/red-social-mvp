import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  GroupOffering,
  CreatorServiceType,
  ServiceSourceScope,
  Currency,
  GroupDonationSettings,
  DonationMode,
  DonationSourceScope,
} from "@/types/group";

function isValidServiceType(value: unknown): value is CreatorServiceType {
  return (
    value === "saludo" ||
    value === "consejo" ||
    value === "meet_greet_digital" ||
    value === "mensaje"
  );
}

function isValidSourceScope(value: unknown): value is ServiceSourceScope {
  return value === "group" || value === "profile" || value === "both";
}

function isValidDonationMode(value: unknown): value is DonationMode {
  return value === "none" || value === "general" || value === "wedding";
}

function isValidDonationSourceScope(
  value: unknown
): value is DonationSourceScope {
  return value === "group" || value === "profile";
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeNullableCurrency(value: unknown): Currency | null {
  if (value === "MXN" || value === "USD") return value;
  return null;
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeSuggestedAmounts(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  const cleaned = value
    .map((item) => Number(item))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 12);

  return Array.from(new Set(cleaned));
}

function normalizeDonation(
  donation?: Partial<GroupDonationSettings> | null
): GroupDonationSettings {
  const raw = (donation ?? {}) as Partial<GroupDonationSettings>;

  const mode: DonationMode = isValidDonationMode(raw.mode) ? raw.mode : "none";

  const sourceScope: DonationSourceScope = isValidDonationSourceScope(
    raw.sourceScope
  )
    ? raw.sourceScope
    : "group";

  const currency: Currency = normalizeNullableCurrency(raw.currency) ?? "MXN";

  const suggestedAmounts = normalizeSuggestedAmounts(raw.suggestedAmounts);
  const goalLabel = normalizeNullableText(raw.goalLabel);

  if (mode === "none") {
    return {
      mode: "none",
      enabled: false,
      visible: false,
      currency: "MXN",
      sourceScope,
      suggestedAmounts: [],
      goalLabel: null,
    };
  }

  if (suggestedAmounts.length === 0) {
    throw new Error(
      "La donación activa requiere al menos un monto mínimo válido."
    );
  }

  return {
    mode,
    enabled: true,
    visible: true,
    currency,
    sourceScope,
    suggestedAmounts,
    goalLabel: mode === "wedding" ? goalLabel : null,
  };
}

export async function updateOfferings(
  groupId: string,
  offerings: GroupOffering[],
  donation?: Partial<GroupDonationSettings> | null
) {
  if (!groupId?.trim()) {
    throw new Error("groupId requerido.");
  }

  const gref = doc(db, "groups", groupId);

  const cleaned: GroupOffering[] = (Array.isArray(offerings) ? offerings : []).map(
    (o) => {
      const rawType = o?.type;

      if (!isValidServiceType(rawType)) {
        throw new Error("Tipo de servicio inválido.");
      }

      const enabled = !!o?.enabled;
      const visible = typeof o?.visible === "boolean" ? o.visible : enabled;

      const memberPrice = normalizeNullableNumber(
        o?.memberPrice ?? o?.price ?? null
      );
      const publicPrice = normalizeNullableNumber(
        o?.publicPrice ?? o?.price ?? null
      );
      const currency = normalizeNullableCurrency(o?.currency);

      const hasAnyPrice = memberPrice != null || publicPrice != null;

      if (hasAnyPrice && !currency) {
        throw new Error("Si un servicio tiene precio, debe tener moneda.");
      }

      if (!hasAnyPrice && currency) {
        throw new Error(
          "Si un servicio tiene moneda, debe tener al menos un precio."
        );
      }

      if (memberPrice != null && memberPrice <= 0) {
        throw new Error("memberPrice inválido en servicios.");
      }

      if (publicPrice != null && publicPrice <= 0) {
        throw new Error("publicPrice inválido en servicios.");
      }

      const requiresApproval =
        typeof o?.requiresApproval === "boolean" ? o.requiresApproval : true;

      const sourceScope: ServiceSourceScope = isValidSourceScope(o?.sourceScope)
        ? o.sourceScope
        : "group";

      return {
        type: rawType,
        enabled,
        visible,
        memberPrice,
        publicPrice,
        currency,
        requiresApproval,
        sourceScope,
      };
    }
  );

  const payload: Record<string, unknown> = {
    offerings: cleaned,
    updatedAt: serverTimestamp(),
  };

  if (typeof donation !== "undefined") {
    payload.donation = normalizeDonation(donation);
  }

  await updateDoc(gref, payload);
}