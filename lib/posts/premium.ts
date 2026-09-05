import type {
  GroupVisibility,
  Post,
  PostContextType,
  PostPremium,
} from "./types";
import { PREMIUM_MIN_PRICE_USD, SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";

export const MAX_VIDEO_DURATION_FREE_SECONDS = 30 * 60;       // 30 min
export const MAX_VIDEO_DURATION_PREMIUM_SECONDS = 3 * 60 * 60; // 3 horas

export type PremiumPostContextInput = {
  contextType: PostContextType;
  groupVisibility?: GroupVisibility | null;
  viewerIsOwner?: boolean;
};

export type PremiumConfigurationInput = {
  premium?: PostPremium | null;
  hasVideos: boolean;
  context: PremiumPostContextInput;
  allowedAccessModesOverride?: PostPremium["accessMode"][];
  allowedFreeForOptionsOverride?: PostPremium["freeFor"][];
};

export type PremiumValidationError = {
  code: string;
  message: string;
};

export type PremiumValidationResult = {
  valid: boolean;
  errors: PremiumValidationError[];
};

export type PremiumCapabilities = {
  canEnablePremium: boolean;
  allowedAccessModes: PostPremium["accessMode"][];
  allowedFreeForOptions: PostPremium["freeFor"][];
  disabledReason: string | null;
};

export type PremiumAccessFields = Pick<
  Post,
  | "premium"
  | "access"
  | "accessModel"
  | "requiresPayment"
  | "requiresSubscription"
  | "oneTimePrice"
  | "currency"
  | "purchaseType"
>;

export function buildFreeAccessFields(): PremiumAccessFields {
  return {
    premium: null,
    access: "free",
    accessModel: "free",
    requiresPayment: false,
    requiresSubscription: false,
    oneTimePrice: null,
    currency: null,
    purchaseType: null,
  };
}

export function canPostBePremium(params: {
  postType?: Post["postType"] | null;
  media?: Post["media"];
}): boolean {
  return (
    params.postType === "video" ||
    (Array.isArray(params.media) &&
      params.media.some((item) => item?.type === "video"))
  );
}

export function getAllowedAccessModes(
  context: PremiumPostContextInput
): PostPremium["accessMode"][] {
  if (context.contextType === "profile") {
    return ["public"];
  }

  if (context.contextType === "group") {
    if (context.groupVisibility === "hidden") {
      return ["members_only"];
    }

    if (context.groupVisibility === "private") {
      return ["members_only", "public"];
    }

    if (context.groupVisibility === "public") {
      return ["public"];
    }
  }

  return [];
}

export function getAllowedFreeForOptions(
  context: PremiumPostContextInput
): PostPremium["freeFor"][] {
if (context.contextType === "profile") {
  return ["none"];
}
  if (context.contextType === "group") {
if (context.groupVisibility === "hidden") {
  return ["none"];
}

    if (context.groupVisibility === "private") {
      return ["members_and_subscribers", "none"];
    }

    if (context.groupVisibility === "public") {
      return ["members_and_subscribers", "none"];
    }
  }

  return [];
}

export function getPremiumCapabilities(params: {
  hasVideos: boolean;
  context: PremiumPostContextInput;
}): PremiumCapabilities {
  if (params.context.contextType === "group" && !params.context.viewerIsOwner) {
    return {
      canEnablePremium: false,
      allowedAccessModes: [],
      allowedFreeForOptions: [],
      disabledReason: "Solo el creador de la comunidad puede crear publicaciones premium.",
    };
  }

  // 🚨 SIN VIDEO NO HAY NADA QUE MONETIZAR.
  //
  // Premium es poner precio a un VIDEO (`DEFAULT_KIND`), así que el botón de
  // monetizar no tiene sentido mientras no haya uno. `hasVideos` llegaba a esta
  // función desde el principio y no se usaba: la puerta estaba pensada y sin
  // poner, y el botón aparecía en un compositor vacío.
  //
  // Cerrarla AQUÍ y no en el JSX es lo que además cierra la trampa: al quitar
  // el último video, `canEnablePremium` cae y el efecto de `useComposerPremium`
  // apaga premium solo. Si la puerta viviera en el render, el botón
  // desaparecería dejando premium encendido y sin forma de apagarlo.
  //
  // Editar un post que YA era premium no pasa por aquí: `useComposerPremium`
  // fuerza el permiso en ese caso.
  if (!params.hasVideos) {
    return {
      canEnablePremium: false,
      allowedAccessModes: [],
      allowedFreeForOptions: [],
      disabledReason: "Sube un video para poder monetizarlo.",
    };
  }

  const allowedAccessModes = getAllowedAccessModes(params.context);
  const allowedFreeForOptions = getAllowedFreeForOptions(params.context);

  if (allowedAccessModes.length === 0 || allowedFreeForOptions.length === 0) {
    return {
      canEnablePremium: false,
      allowedAccessModes,
      allowedFreeForOptions,
      disabledReason: "No se pudo resolver el contexto premium del post.",
    };
  }

  return {
    canEnablePremium: true,
    allowedAccessModes,
    allowedFreeForOptions,
    disabledReason: null,
  };
}

export function validatePremiumConfiguration(
  params: PremiumConfigurationInput
): PremiumValidationResult {
  const premium = params.premium ?? null;
  const errors: PremiumValidationError[] = [];

  if (!premium || premium.enabled !== true) {
    return {
      valid: true,
      errors: [],
    };
  }

  if (!params.hasVideos) {
    errors.push({
      code: "premium_requires_video",
      message: "Agrega un video para publicar este post premium.",
    });
  }

  if (premium.kind !== "video") {
    errors.push({
      code: "premium_kind_must_be_video",
      message: "El contenido premium de publicaciones solo puede ser video.",
    });
  }

  if (premium.purchaseType !== "one_time") {
    errors.push({
      code: "premium_purchase_type_must_be_one_time",
      message: "El acceso premium a publicaciones debe ser de compra única.",
    });
  }

  if (premium.currency && premium.currency !== "MXN") {
    errors.push({
      code: "premium_currency_must_be_mxn",
      message: "La moneda permitida para publicaciones premium es MXN.",
    });
  }

  const allowedAccessModes = params.allowedAccessModesOverride ?? getAllowedAccessModes(params.context);
  const allowedFreeForOptions = params.allowedFreeForOptionsOverride ?? getAllowedFreeForOptions(params.context);

  if (!allowedAccessModes.includes(premium.accessMode)) {
    errors.push({
      code: "premium_access_mode_not_allowed",
      message: getAccessModeErrorMessage(params.context),
    });
  }

  if (!allowedFreeForOptions.includes(premium.freeFor)) {
    errors.push({
      code: "premium_free_for_not_allowed",
      message: getFreeForErrorMessage(params.context),
    });
  }

if (
  params.context.contextType === "profile" &&
  premium.freeFor !== "none"
) {
  errors.push({
    code: "profile_premium_requires_paid_access",
    message: "Los posts premium de perfil deben ser de pago único.",
  });
}

if (
  params.context.contextType === "profile" &&
  premium.accessMode !== "public"
) {
  errors.push({
    code: "profile_premium_requires_public_access",
    message: "Los posts premium de perfil deben tener acceso público.",
  });
}

if (
  params.context.contextType === "group" &&
  premium.accessMode === "members_only" &&
  premium.freeFor !== "none"
) {
  errors.push({
    code: "members_only_premium_requires_paid_members_access",
    message:
      "Cuando el acceso premium es solo para miembros, debe cobrarse a quienes puedan verlo.",
  });
}

  if (
    params.context.contextType === "group" &&
    !params.context.groupVisibility
  ) {
    errors.push({
      code: "premium_group_visibility_missing",
      message: "No se pudo resolver la visibilidad del grupo.",
    });
  }

  const price =
    typeof premium.price === "number" && Number.isFinite(premium.price)
      ? premium.price
      : null;

  if (!price || price <= 0) {
    errors.push({
      code: "premium_price_required",
      message: "Agrega un precio válido para el post premium.",
    });
  } else if (price < PREMIUM_MIN_PRICE_USD) {
    errors.push({
      code: "premium_price_below_min",
      message: `El precio mínimo del post premium es $${PREMIUM_MIN_PRICE_USD} MXN.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function buildPremiumAccessFields(
  params: PremiumConfigurationInput
): PremiumAccessFields {
  const premium = params.premium ?? null;

  if (!premium || premium.enabled !== true) {
    return buildFreeAccessFields();
  }

  const validation = validatePremiumConfiguration(params);

  if (!validation.valid) {
    throw new Error(validation.errors[0]?.message ?? "Configuración premium inválida.");
  }

  const price =
    typeof premium.price === "number" && Number.isFinite(premium.price)
      ? premium.price
      : null;

  const requiresPayment = true;

const normalizedPremium: PostPremium = {
  enabled: true,
  kind: "video",
  accessMode:
    params.context.contextType === "profile"
      ? "public"
      : premium.accessMode,
  freeFor:
    params.context.contextType === "profile"
      ? "none"
      : premium.freeFor,
    price: requiresPayment ? price : price ?? null,
    currency: SETTLEMENT_CURRENCY,
    purchaseType: "one_time",
  };

  return {
    premium: normalizedPremium,
    access: requiresPayment ? "paid" : "free",
    accessModel: requiresPayment ? "one_time_purchase" : "free",
    requiresPayment,
    requiresSubscription: false,
    oneTimePrice: requiresPayment ? price : null,
    currency: requiresPayment ? SETTLEMENT_CURRENCY : null,
    purchaseType: "video",
  };
}

function getAccessModeErrorMessage(context: PremiumPostContextInput): string {
  if (context.contextType === "profile") {
    return "Los posts premium de perfil deben tener acceso público.";
  }

  if (context.contextType === "group") {
    if (context.groupVisibility === "hidden") {
      return "Los grupos ocultos no permiten acceso público.";
    }

    if (context.groupVisibility === "private") {
      return "Un grupo privado solo permite premium para miembros o público.";
    }

    if (context.groupVisibility === "public") {
      return "Un grupo público debe usar acceso premium público.";
    }
  }

  return "El modo de acceso premium no está permitido.";
}

function getFreeForErrorMessage(context: PremiumPostContextInput): string {
  if (context.contextType === "profile") {
    return "Los posts premium de perfil deben ser de pago único.";
  }

  if (context.contextType === "group") {
    if (context.groupVisibility === "hidden") {
     return "Un grupo oculto solo permite premium pagado para miembros.";
    }

    if (context.groupVisibility === "private") {
      return "La opción gratuita seleccionada no está permitida para grupos privados.";
    }

    if (context.groupVisibility === "public") {
      return "La opción gratuita seleccionada no está permitida para grupos públicos.";
    }
  }

  return "La configuración gratuita premium no está permitida.";
}