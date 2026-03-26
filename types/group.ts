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
 * Esto será clave para:
 * - buscador
 * - filtros
 * - futura migración de datos
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

/**
 * Devuelve true si la categoría ya es canónica.
 */
export function isCanonicalGroupCategory(
  value: unknown
): value is CanonicalGroupCategory {
  return (
    typeof value === "string" &&
    GROUP_CATEGORY_OPTIONS.some((option) => option.value === value)
  );
}

/**
 * Normaliza una categoría vieja o nueva a categoría canónica.
 * Si no se reconoce, devuelve null.
 */
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

/**
 * Normaliza tags:
 * - trim
 * - minúsculas
 * - sin vacíos
 * - sin duplicados
 */
export function normalizeGroupTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];

  const normalized = tags
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean);

  return Array.from(new Set(normalized));
}

/**
 * Helper para construir texto útil para búsqueda.
 * Ya incluye name, description, category normalizada y tags.
 */
export function buildGroupSearchText(group: Pick<Group, "name" | "description" | "category" | "tags">): string {
  const canonicalCategory = normalizeGroupCategory(group.category);
  const categoryLabel = canonicalCategory
    ? GROUP_CATEGORY_LABELS[canonicalCategory].toLowerCase()
    : "";

  const tags = normalizeGroupTags(group.tags).join(" ");

  return [group.name ?? "", group.description ?? "", canonicalCategory ?? "", categoryLabel, tags]
    .join(" ")
    .trim()
    .toLowerCase();
}

/**
 * Cosas que el creador puede vender.
 */
export type OfferingType = "saludo" | "consejo" | "mensaje";

export type GroupOffering = {
  type: OfferingType;
  enabled: boolean;

  /**
   * Precio para miembros/suscriptores (cuando compran dentro del grupo).
   * Puede ser null si todavía no define precio.
   */
  memberPrice: number | null;

  /**
   * Precio público (cuando NO son miembros; típicamente desde perfil).
   * En grupos gratis, debe ser igual a memberPrice.
   */
  publicPrice: number | null;

  currency: Currency | null;

  /**
   * Compatibilidad (legacy): antes usábamos "price".
   * Ya no se usa para guardar, pero si existe, se normaliza a memberPrice/publicPrice.
   */
  price?: number | null;
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
   * Ej:
   * ["futbol", "pumas", "liga mx", "cdmx"]
   */
  tags?: string[];

  greetingsEnabled?: boolean;
  welcomeMessage?: string | null;

  ageMin?: number | null;
  ageMax?: number | null;

  permissions: {
    postingMode: PostingMode;
    commentsEnabled: boolean;
  };

  monetization: {
    isPaid: boolean;
    priceMonthly: number | null;
    currency: Currency | null;
  };

  /**
   * Servicios vendibles del creador (saludo, consejo, mensaje).
   */
  offerings?: GroupOffering[];

  isActive: boolean;

  createdAt: any;
  updatedAt: any;
}