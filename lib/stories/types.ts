import type { Timestamp } from "firebase/firestore";
import type { CanonicalGroupCategory } from "@/types/group";

export type StoryType = "saludo" | "consejo";
export type StoryGroupKey = "saludo_sent" | "saludo_received" | "consejo_sent" | "consejo_received";

export type StoryDoc = {
  id: string;
  creatorId: string;
  /** UID of the creator who made the greeting (A). May differ from creatorId when the buyer (B) shared it. */
  greetingCreatorId?: string;
  /** Context/instructions written by the buyer when ordering the greeting. */
  instructions?: string;
  type: StoryType;
  muxPlaybackId: string | null;
  thumbnailUrl: string | null;
  videoDuration: number | null;
  greetingRequestId: string;
  source: "profile" | "group";
  groupId: string | null;
  createdAt: Timestamp | null;
  /** Nombre del creador que grabó el saludo/consejo (denormalizado para búsqueda y display). */
  creatorName?: string;
  /**
   * Legible por cualquiera. Perfil siempre; comunidad solo si es pública.
   *
   * Ya no gobierna solo la búsqueda: las reglas de Firestore lo usan como camino
   * rápido de LECTURA para que el descubrimiento del reel no gaste un `get()`
   * por documento. Lo valida el `create` y lo resincroniza un disparador cuando
   * la comunidad cambia de visibilidad; el cliente nunca lo escribe a mano.
   */
  searchable?: boolean;
  /**
   * La publicó el creador que grabó el video, no el comprador que lo recibió.
   * El reel solo muestra las del creador, para no repetir el mismo video con dos
   * caras distintas. Se congela al crear porque Firestore no compara dos campos
   * entre sí dentro de una consulta.
   */
  byCreator?: boolean;
  /** Retirada del reel por quien la publicó. Sigue viva en sus círculos. */
  hiddenFromReel?: boolean;
  /** Prefijos de búsqueda (instructions + nombre del creador + tipo). */
  searchPrefixes?: string[];
  /**
   * Categorías canónicas denormalizadas para recomendar por afinidad:
   * perfil → intereses del creador; grupo → categoría de la comunidad.
   */
  categories?: CanonicalGroupCategory[];
  /** Vistas únicas acumuladas (lo incrementa un trigger backend). Popularidad. */
  viewsCount?: number;
};

export type StoryViewDoc = {
  storyId: string;
  viewedAt: Timestamp | null;
};
