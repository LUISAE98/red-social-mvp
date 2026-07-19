import type { CommentMention } from "@/lib/posts/types";

export type { CommentMention };

/**
 * Sugerencia mostrada en el popover de menciones al escribir "@".
 * `following` marca el bucket prioritario: perfiles que sigo o comunidades a
 * las que pertenezco se muestran primero, antes de resultados de búsqueda.
 */
export type MentionSuggestion = {
  type: "profile" | "group";
  /** uid del perfil o groupId de la comunidad. */
  id: string;
  /** Etiqueta visible: displayName del perfil o nombre de la comunidad. */
  label: string;
  /** Solo perfiles: handle estable (sin @). */
  handle?: string | null;
  avatarUrl?: string | null;
  /** true = lo sigo (perfil) o pertenezco (comunidad). Bucket prioritario. */
  following: boolean;
};

/**
 * Construye la subcadena literal insertada en el texto para una sugerencia.
 * Se etiqueta el NOMBRE visible (displayName del perfil o nombre de la
 * comunidad), SIN "@": el arroba solo dispara el popover, no queda en el texto.
 * El link se resuelve aparte con `mention.handle` / `mention.id`.
 */
export function buildMentionToken(suggestion: MentionSuggestion): string {
  return suggestion.label;
}

/** Convierte una sugerencia seleccionada en la mención persistible. */
export function suggestionToMention(suggestion: MentionSuggestion): CommentMention {
  const token = buildMentionToken(suggestion);
  if (suggestion.type === "profile") {
    return {
      type: "profile",
      id: suggestion.id,
      label: suggestion.label,
      token,
      handle: suggestion.handle ?? null,
    };
  }
  return {
    type: "group",
    id: suggestion.id,
    label: suggestion.label,
    token,
  };
}
