import type { Timestamp } from "firebase/firestore";

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
  /** Si la historia aparece en la búsqueda global: perfil siempre; grupo solo si es público. */
  searchable?: boolean;
  /** Prefijos de búsqueda (instructions + nombre del creador + tipo). */
  searchPrefixes?: string[];
};

export type StoryViewDoc = {
  storyId: string;
  viewedAt: Timestamp | null;
};
