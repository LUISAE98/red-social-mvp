import type {
  CreatorService,
  CreatorServiceType,
} from "@/types/group";

/**
 * Estructura normalizada para UI (menú, botones, etc.)
 */
export type NormalizedService = {
  type: CreatorServiceType;
  enabled: boolean;
  visible: boolean;

  memberPrice: number | null;
  publicPrice: number | null;
  currency: "MXN" | "USD" | null;

  requiresApproval: boolean;
  sourceScope: "group" | "profile" | "both";
};

/**
 * Convierte cualquier arreglo de servicios (group o profile)
 * en un formato limpio y seguro para UI.
 */
export function normalizeServices(
  services: CreatorService[] | null | undefined
): NormalizedService[] {
  if (!Array.isArray(services)) return [];

  return services
    .map((s): NormalizedService | null => {
      if (!s?.type) return null;

      return {
        type: s.type,

        enabled: !!s.enabled,
        visible:
          typeof s.visible === "boolean" ? s.visible : !!s.enabled,

        memberPrice:
          typeof s.memberPrice === "number" ? s.memberPrice : null,

        publicPrice:
          typeof s.publicPrice === "number" ? s.publicPrice : null,

        currency:
          s.currency === "MXN" || s.currency === "USD"
            ? s.currency
            : null,

        requiresApproval:
          typeof s.requiresApproval === "boolean"
            ? s.requiresApproval
            : true,

        sourceScope:
          s.sourceScope === "group" ||
          s.sourceScope === "profile" ||
          s.sourceScope === "both"
            ? s.sourceScope
            : "group",
      };
    })
    .filter((s): s is NormalizedService => !!s);
}

/**
 * Devuelve solo servicios visibles para UI
 */
export function getVisibleServices(
  services: CreatorService[] | null | undefined
): NormalizedService[] {
  return normalizeServices(services).filter(
    (s) => s.enabled && s.visible
  );
}

/**
 * Busca un servicio específico por tipo
 */
export function getServiceByType(
  services: CreatorService[] | null | undefined,
  type: CreatorServiceType
): NormalizedService | null {
  const normalized = normalizeServices(services);
  return normalized.find((s) => s.type === type) ?? null;
}