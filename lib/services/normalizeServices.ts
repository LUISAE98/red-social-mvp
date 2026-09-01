import type {
  CreatorService,
  CreatorServiceType,
  ServiceSourceScope,
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
  sourceScope: ServiceSourceScope;

  durationMinutes: number | null;
};

function isValidSourceScope(value: unknown): value is ServiceSourceScope {
  return value === "group" || value === "profile" || value === "both";
}

function serviceMatchesContext(
  service: NormalizedService,
  context: ServiceSourceScope
): boolean {
  if (context === "both") return true;
  return service.sourceScope === context || service.sourceScope === "both";
}

/**
 * Convierte cualquier arreglo de servicios (group o profile)
 * en un formato limpio y seguro para UI.
 */
export function normalizeServices(
  services: CreatorService[] | null | undefined,
  fallbackSourceScope: ServiceSourceScope = "group"
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

        // ⚠️ `price` es un tercer campo heredado, y hasta ahora se descartaba.
        //
        // El backend SI lo lee (ver `getOfferingPrice`), asi que el servidor
        // conocia el precio de esos servicios y la pantalla no: el boton de
        // comprar salia sin precio y la pasarela se plantaba con "no hay
        // precio". Cliente y servidor tienen que mirar los mismos campos.
        //
        // Los especificos mandan; este solo rellena el hueco.
        memberPrice:
          typeof s.memberPrice === "number"
            ? s.memberPrice
            : typeof s.price === "number"
              ? s.price
              : null,

        publicPrice:
          typeof s.publicPrice === "number"
            ? s.publicPrice
            : typeof s.price === "number"
              ? s.price
              : null,

        currency:
          s.currency === "MXN" || s.currency === "USD"
            ? s.currency
            : null,

        requiresApproval:
          typeof s.requiresApproval === "boolean"
            ? s.requiresApproval
            : true,

        sourceScope: isValidSourceScope(s.sourceScope)
          ? s.sourceScope
          : fallbackSourceScope,

        durationMinutes:
          s.meta?.meetGreet?.durationMinutes ??
          s.meta?.customClass?.durationMinutes ??
          null,
      };
    })
    .filter((s): s is NormalizedService => !!s);
}

/**
 * Devuelve solo servicios visibles para UI.
 * Si context = "profile", acepta servicios profile o both.
 * Si context = "group", acepta servicios group o both.
 */
export function getVisibleServices(
  services: CreatorService[] | null | undefined,
  context: ServiceSourceScope = "group"
): NormalizedService[] {
  return normalizeServices(services, context).filter(
    (s) => s.enabled && s.visible && serviceMatchesContext(s, context)
  );
}

/**
 * Busca un servicio específico por tipo.
 */
export function getServiceByType(
  services: CreatorService[] | null | undefined,
  type: CreatorServiceType,
  context: ServiceSourceScope = "group"
): NormalizedService | null {
  const normalized = normalizeServices(services, context);

  return (
    normalized.find(
      (s) => s.type === type && serviceMatchesContext(s, context)
    ) ?? null
  );
}