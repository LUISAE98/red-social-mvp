export type GroupVisibility = "public" | "private" | "hidden";
export type PostingMode = "members" | "owner_only";
export type Currency = "MXN" | "USD";

/**
 * Categorías oficiales del sistema.
 * - Se usan después para filtros/buscador.
 * - No cambiar strings sin migración.
 */
export type GroupCategory =
  // 🎤 Creadores / Artistas
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
  // 🎮 Gaming / Tech
  | "videojuegos"
  | "esports"
  | "tecnologia"
  | "programacion"
  | "gadgets"
  | "inteligencia_artificial"
  | "crypto_web3"
  // ⚽ Deportes
  | "futbol"
  | "box"
  | "fitness"
  | "running"
  | "deportes_general"
  // 📰 Información / Educación
  | "noticias"
  | "educacion"
  | "salud"
  | "bienestar"
  | "finanzas"
  | "politica"
  | "negocios"
  | "ciencia"
  // 🌎 Lifestyle
  | "moda"
  | "belleza"
  | "comida"
  | "viajes"
  | "autos"
  | "mascotas"
  | "hobbies"
  // 🏢 Institucional
  | "institucion"
  | "empresa"
  | "escuela"
  | "gobierno"
  | "organizacion"
  // 🎭 General
  | "entretenimiento"
  | "otros";

/**
 * Cosas que el creador puede vender dentro del grupo.
 * MVP: solo configuración + UI/CTA (sin pago real todavía).
 */
export type OfferingType = "saludo" | "consejo" | "mensaje";

export type GroupOffering = {
  type: OfferingType;
  enabled: boolean;

  /**
   * Si el creador quiere mostrar precio desde ya (recomendado).
   * Puede ser null si aún no define.
   */
  price: number | null;
  currency: Currency | null;
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

  category?: GroupCategory;
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