export type GroupVisibility = "public" | "private" | "hidden";
export type PostingMode = "members" | "owner_only";
export type Currency = "MXN" | "USD";

/**
 * Categorías NUEVAS canónicas del sistema.
 * Estas son las que conviene usar hacia adelante en UI, filtros y buscador.
 */
export type CanonicalGroupCategory =
  | "entretenimiento"
  | "musica"
  | "creadores"
  | "gaming"
  | "tecnologia"
  | "deportes"
  | "fitness_bienestar"
  | "educacion"
  | "negocios_finanzas"
  | "noticias_politica"
  | "ciencia"
  | "moda_belleza"
  | "comida"
  | "viajes"
  | "autos"
  | "mascotas"
  | "hobbies"
  | "familia_comunidad"
  | "instituciones"
  | "otros";

/**
 * Categorías LEGACY.
 * Se mantienen para no romper grupos ya guardados en Firestore
 * ni referencias viejas en código.
 */
export type LegacyGroupCategory =
  | "cantante"
  | "musico"
  | "banda"
  | "comediante"
  | "actor"
  | "influencer"
  | "streamer"
  | "youtuber"
  | "podcaster"
  | "escritor"
  | "fotografo"
  | "artista_visual"
  | "videojuegos"
  | "esports"
  | "tecnologia"
  | "programacion"
  | "gadgets"
  | "inteligencia_artificial"
  | "crypto_web3"
  | "futbol"
  | "box"
  | "fitness"
  | "running"
  | "deportes_general"
  | "noticias"
  | "educacion"
  | "salud"
  | "bienestar"
  | "finanzas"
  | "politica"
  | "negocios"
  | "ciencia"
  | "moda"
  | "belleza"
  | "comida"
  | "viajes"
  | "autos"
  | "mascotas"
  | "hobbies"
  | "institucion"
  | "empresa"
  | "escuela"
  | "gobierno"
  | "organizacion"
  | "entretenimiento"
  | "otros";

/**
 * Tipo actual de categoría soportado por el sistema.
 * Acepta nuevas + legacy para mantener compatibilidad.
 */
export type GroupCategory = CanonicalGroupCategory | LegacyGroupCategory;

/**
 * Opciones oficiales NUEVAS para mostrar en UI.
 * Usa estas opciones en selects, filtros y formularios hacia adelante.
 */
export const GROUP_CATEGORY_OPTIONS: ReadonlyArray<{
  value: CanonicalGroupCategory;
  label: string;
}> = [
  { value: "entretenimiento", label: "Entretenimiento" },
  { value: "musica", label: "Música" },
  { value: "creadores", label: "Creadores" },
  { value: "gaming", label: "Gaming" },
  { value: "tecnologia", label: "Tecnología" },
  { value: "deportes", label: "Deportes" },
  { value: "fitness_bienestar", label: "Fitness y bienestar" },
  { value: "educacion", label: "Educación" },
  { value: "negocios_finanzas", label: "Negocios y finanzas" },
  { value: "noticias_politica", label: "Noticias y política" },
  { value: "ciencia", label: "Ciencia" },
  { value: "moda_belleza", label: "Moda y belleza" },
  { value: "comida", label: "Comida" },
  { value: "viajes", label: "Viajes" },
  { value: "autos", label: "Autos" },
  { value: "mascotas", label: "Mascotas" },
  { value: "hobbies", label: "Hobbies" },
  { value: "familia_comunidad", label: "Familia y comunidad" },
  { value: "instituciones", label: "Instituciones" },
  { value: "otros", label: "Otros" },
] as const;

/**
 * Labels rápidos por valor.
 */
export const GROUP_CATEGORY_LABELS: Record<CanonicalGroupCategory, string> = {
  entretenimiento: "Entretenimiento",
  musica: "Música",
  creadores: "Creadores",
  gaming: "Gaming",
  tecnologia: "Tecnología",
  deportes: "Deportes",
  fitness_bienestar: "Fitness y bienestar",
  educacion: "Educación",
  negocios_finanzas: "Negocios y finanzas",
  noticias_politica: "Noticias y política",
  ciencia: "Ciencia",
  moda_belleza: "Moda y belleza",
  comida: "Comida",
  viajes: "Viajes",
  autos: "Autos",
  mascotas: "Mascotas",
  hobbies: "Hobbies",
  familia_comunidad: "Familia y comunidad",
  instituciones: "Instituciones",
  otros: "Otros",
};

/**
 * Mapa de conversión de categorías viejas hacia categorías nuevas.
 */
export const LEGACY_TO_CANONICAL_GROUP_CATEGORY: Record<
  LegacyGroupCategory,
  CanonicalGroupCategory
> = {
  cantante: "musica",
  musico: "musica",
  banda: "musica",
  comediante: "entretenimiento",
  actor: "entretenimiento",
  influencer: "creadores",
  streamer: "creadores",
  youtuber: "creadores",
  podcaster: "creadores",
  escritor: "creadores",
  fotografo: "creadores",
  artista_visual: "creadores",

  videojuegos: "gaming",
  esports: "gaming",

  tecnologia: "tecnologia",
  programacion: "tecnologia",
  gadgets: "tecnologia",
  inteligencia_artificial: "tecnologia",
  crypto_web3: "tecnologia",

  futbol: "deportes",
  box: "deportes",
  fitness: "fitness_bienestar",
  running: "fitness_bienestar",
  deportes_general: "deportes",

  noticias: "noticias_politica",
  educacion: "educacion",
  salud: "fitness_bienestar",
  bienestar: "fitness_bienestar",
  finanzas: "negocios_finanzas",
  politica: "noticias_politica",
  negocios: "negocios_finanzas",
  ciencia: "ciencia",

  moda: "moda_belleza",
  belleza: "moda_belleza",
  comida: "comida",
  viajes: "viajes",
  autos: "autos",
  mascotas: "mascotas",
  hobbies: "hobbies",

  institucion: "instituciones",
  empresa: "instituciones",
  escuela: "instituciones",
  gobierno: "instituciones",
  organizacion: "instituciones",

  entretenimiento: "entretenimiento",
  otros: "otros",
};

export function isCanonicalGroupCategory(
  value: unknown
): value is CanonicalGroupCategory {
  return (
    typeof value === "string" &&
    GROUP_CATEGORY_OPTIONS.some((option) => option.value === value)
  );
}

export function normalizeGroupCategory(
  value: unknown
): CanonicalGroupCategory | null {
  if (typeof value !== "string" || !value.trim()) return null;

  const raw = value.trim() as GroupCategory;

  if (isCanonicalGroupCategory(raw)) {
    return raw;
  }

  return LEGACY_TO_CANONICAL_GROUP_CATEGORY[raw as LegacyGroupCategory] ?? null;
}

export function normalizeGroupTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  const normalized = tags
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

export function buildGroupSearchText(
  group: Pick<Group, "name" | "description" | "category" | "tags">
): string {
  const canonicalCategory = normalizeGroupCategory(group.category);
  const categoryLabel = canonicalCategory
    ? GROUP_CATEGORY_LABELS[canonicalCategory].toLowerCase()
    : "";

  const tags = normalizeGroupTags(group.tags).join(" ");

  return [
    group.name ?? "",
    group.description ?? "",
    canonicalCategory ?? "",
    categoryLabel,
    tags,
  ]
    .join(" ")
    .trim()
    .toLowerCase();
}

/**
 * Flags estructurales de monetización del grupo.
 * Suscripción es estructural, NO un servicio visible normal.
 */
export type GroupMonetizationFlags = {
  subscriptionsEnabled: boolean;
  paidPostsEnabled: boolean;
  paidLivesEnabled: boolean;
  paidVodEnabled: boolean;
  paidLiveCommentsEnabled: boolean;
  greetingsEnabled: boolean;
  adviceEnabled: boolean;
  customClassEnabled: boolean;
  digitalMeetGreetEnabled: boolean;
};

/**
 * Políticas al cambiar GRATIS -> SUSCRIPCION
 */
export type FreeToSubscriptionPolicy =
  | "legacy_free"
  | "require_subscription";

/**
 * Políticas al cambiar SUSCRIPCION -> GRATIS
 */
export type SubscriptionToFreePolicy =
  | "keep_members_free"
  | "remove_all_members";

  export type SubscriptionPriceIncreasePolicy =
  | "keep_legacy_price"
  | "require_resubscribe_new_price";
/**
 * Estado de acceso de un miembro frente a un grupo con suscripción.
 * Se usa para alinear UI, membership y sidebar.
 */
export type GroupMembershipAccessType =
  | "standard"
  | "subscription"
  | "legacy_free"
  | "requires_subscription";

/**
 * Snapshot de transición de suscripción a nivel grupo.
 * Deja lista la lógica aunque el pago real llegue después.
 */
export type GroupSubscriptionTransitionSettings = {
  freeToSubscriptionPolicy: FreeToSubscriptionPolicy | null;
  subscriptionToFreePolicy: SubscriptionToFreePolicy | null;
  subscriptionPriceIncreasePolicy?: SubscriptionPriceIncreasePolicy | null;
  previousSubscriptionPriceMonthly?: number | null;
  nextSubscriptionPriceMonthly?: number | null;
  subscriptionPriceChangeCurrency?: Currency | null;

  /**
   * Marca informativa de que el grupo cambió recientemente su esquema.
   * Útil para UI/sidebar/avisos.
   */
  lastMonetizationChangeAt?: any;

  /**
   * Para soporte futuro/auditoría mínima.
   */
  lastMonetizationChangeBy?: string | null;

  /**
   * Última transición aplicada realmente a miembros.
   * Sirve para evitar duplicados y para mantener estado al recargar.
   */
  lastAppliedTransitionKey?: string | null;
  lastAppliedTransitionAt?: any;
  lastAppliedTransitionBy?: string | null;
};
/**
 * Tipos formales del catálogo visible de servicios del grupo/perfil.
 *
 * NOTA IMPORTANTE:
 * - "suscripcion" YA NO entra aquí.
 * - La suscripción vive en monetization como capa estructural del grupo.
 * - "mensaje" se conserva solo como legacy temporal.
 */
export type CreatorServiceType =
  | "saludo"
  | "consejo"
  | "meet_greet_digital"
  | "clase_personalizada"
  | "mensaje";

export type ServiceSourceScope = "group" | "profile" | "both";
export type ServiceVisibility = "hidden" | "members" | "public";

export type MeetGreetServiceMeta = {
  durationMinutes: number | null;
};

export type CustomClassServiceMeta = {
  durationMinutes?: number | null;
};

export type CreatorServiceMeta = {
  meetGreet?: MeetGreetServiceMeta | null;
  customClass?: CustomClassServiceMeta | null;
};

export type CreatorService = {
  type: CreatorServiceType;
  enabled: boolean;
  visible: boolean;

  /**
   * Controla el orden del mini menú de servicios.
   * Menor número = más arriba / más a la izquierda.
   */
  displayOrder: number;

  /**
   * Nivel formal de visibilidad del servicio.
   * hidden  = no se muestra
   * members = visible solo en contexto privado / miembros
   * public  = visible públicamente
   */
  visibility: ServiceVisibility;

  /**
   * Precio para miembros o dentro del contexto grupo.
   */
  memberPrice: number | null;

  /**
   * Precio público o fuera del contexto grupo.
   */
  publicPrice: number | null;

  currency: Currency | null;

  /**
   * Sirve para servicios que puedan requerir aprobación manual
   * antes de aceptarse o agendarse.
   */
  requiresApproval: boolean;

  /**
   * Define si el servicio pertenece al grupo, al perfil o a ambos.
   */
  sourceScope: ServiceSourceScope;

  meta?: CreatorServiceMeta | null;

  /**
   * Compatibilidad legacy.
   */
  price?: number | null;
};

export type DonationMode = "none" | "general" | "wedding";
export type DonationSourceScope = "group" | "profile";

export type GroupDonationSettings = {
  mode: DonationMode;
  enabled: boolean;
  visible: boolean;
  currency: Currency | null;
  sourceScope: DonationSourceScope;
  title?: string | null;
  description?: string | null;
  suggestedAmounts?: number[];
  goalLabel?: string | null;
};

/**
 * Alias temporales para no romper imports existentes.
 */
export type GroupOffering = CreatorService;
export type OfferingType = CreatorServiceType;
export type GroupServiceCatalog = CreatorService[];

export type GroupMonetizationSettings = {
  /**
   * Compatibilidad legacy:
   * muchas pantallas viejas leen esto para saber si el grupo "es pagado".
   */
  isPaid: boolean;

  /**
   * Compatibilidad legacy:
   * mantener mientras se migra todo a subscriptionPriceMonthly.
   */
  priceMonthly: number | null;
  currency: Currency | null;

  /**
   * Modelo formal nuevo de suscripción.
   */
  subscriptionsEnabled: boolean;
  subscriptionPriceMonthly: number | null;
  subscriptionCurrency: Currency | null;

  /**
   * Flags estructurales base del grupo.
   */
  paidPostsEnabled: boolean;
  paidLivesEnabled: boolean;
  paidVodEnabled: boolean;
  paidLiveCommentsEnabled: boolean;
  greetingsEnabled: boolean;
  adviceEnabled: boolean;
  customClassEnabled: boolean;
  digitalMeetGreetEnabled: boolean;

  /**
   * Políticas de transición entre gratis y suscripción.
   */
  transitions?: GroupSubscriptionTransitionSettings | null;
};

export interface Group {
  id?: string;

  name: string;
  description: string;

  imageUrl: string | null;
  coverUrl?: string | null;
  avatarUrl?: string | null;

  ownerId: string;
  visibility: GroupVisibility;

  /**
   * Si aparece en búsquedas/listados.
   * hidden normalmente lo pondrá en false.
   */
  discoverable?: boolean;

  /**
   * Puede venir legacy o canónica.
   * Hacia adelante conviene guardar solo la canónica.
   */
  category?: GroupCategory;

  /**
   * Etiquetas libres para afinidad/búsqueda.
   */
  tags?: string[];

  /**
   * Legacy temporal.
   * Se conserva para no romper lecturas viejas mientras migramos
   * a monetization.greetingsEnabled.
   */
  greetingsEnabled?: boolean;

  welcomeMessage?: string | null;

  ageMin?: number | null;
  ageMax?: number | null;

  permissions: {
    postingMode: PostingMode;
    commentsEnabled: boolean;
  };

  monetization: GroupMonetizationSettings;

  /**
   * Servicios visibles del grupo.
   * IMPORTANTE: suscripción NO debe entrar aquí.
   */
  offerings?: GroupServiceCatalog;

  donation?: GroupDonationSettings;

  isActive: boolean;

  createdAt: any;
  updatedAt: any;
}

/**
 * Helpers de suscripción / compatibilidad
 */
export function groupHasSubscription(group: Pick<Group, "monetization">): boolean {
  return (
    group.monetization?.subscriptionsEnabled === true ||
    group.monetization?.isPaid === true
  );
}

export function getGroupSubscriptionPrice(
  group: Pick<Group, "monetization">
): number | null {
  if (typeof group.monetization?.subscriptionPriceMonthly === "number") {
    return group.monetization.subscriptionPriceMonthly;
  }

  if (typeof group.monetization?.priceMonthly === "number") {
    return group.monetization.priceMonthly;
  }

  return null;
}

export function getGroupSubscriptionCurrency(
  group: Pick<Group, "monetization">
): Currency {
  return (
    group.monetization?.subscriptionCurrency ||
    group.monetization?.currency ||
    "MXN"
  );
}

export function groupSupportsVisibleService(
  group: Pick<Group, "offerings">,
  serviceType: CreatorServiceType
): boolean {
  return !!group.offerings?.some(
    (service) => service.type === serviceType && service.enabled && service.visible
  );
}