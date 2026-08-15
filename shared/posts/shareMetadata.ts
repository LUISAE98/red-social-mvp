// Metadatos de compartir de una publicación — LÓGICA COMPARTIDA.
//
// Vive aquí, fuera de `lib/` y de `backend/src/`, porque la usan los dos lados y
// ya había empezado a duplicarse: `buildShareMetadata` en el cliente y
// `resolveIsShareable` en `backend/src/groupPostsVisibilitySync.ts` implementan
// la MISMA regla, y mantenerlas iguales dependía de que alguien se acordara. Es
// el mismo patrón que hizo que las funciones de dinero perdieran la exigencia de
// Google mientras las de moderación la tenían.
//
// Solo puede contener lógica PURA: nada de `firebase/firestore` ni de
// `firebase-admin`, porque se compila en los dos entornos.

export type ShareContextType = "group" | "profile";
export type ShareGroupVisibility = "public" | "private" | "hidden";

export type ShareMetadataInput = {
  text: string;
  authorName?: string | null;
  contextType?: ShareContextType | null;
  groupVisibility?: ShareGroupVisibility | null;
  profileRestricted?: boolean | null;
  accessModel?: string | null;
  requiresPayment?: boolean;
  requiresSubscription?: boolean;
  premiumEnabled?: boolean;
  premiumAccessMode?: string | null;
  /** Primera imagen o miniatura, si la hay. */
  previewImageUrl?: string | null;
};

export type ShareMetadata = {
  isShareable: boolean;
  publicSlug: string | null;
  shareTitle: string;
  shareDescription: string;
  shareImageUrl: string | null;
};

export function truncateForShare(value: string, max: number): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * ¿Este post se puede ver desde fuera de su comunidad o perfil?
 *
 * Gratis y en sitio público, o premium marcado como visible hacia fuera. NUNCA
 * en una comunidad oculta: ahí no se expone nada, venga como venga el dato.
 */
export function resolveIsShareable(input: ShareMetadataInput): boolean {
  const isFree =
    (input.accessModel ?? "free") === "free" &&
    input.requiresPayment !== true &&
    input.requiresSubscription !== true;

  const isPublicGroup =
    input.contextType !== "profile" && input.groupVisibility === "public";

  const isPublicProfile =
    input.contextType === "profile" && input.profileRestricted !== true;

  const isPremiumPublic =
    input.premiumEnabled === true &&
    input.premiumAccessMode === "public" &&
    input.contextType !== "profile" &&
    input.groupVisibility !== "hidden";

  return (isFree && (isPublicGroup || isPublicProfile)) || isPremiumPublic;
}

export function buildShareMetadata(input: ShareMetadataInput): ShareMetadata {
  const cleanText = input.text.trim();

  return {
    isShareable: resolveIsShareable(input),
    publicSlug: null,
    shareTitle: cleanText
      ? truncateForShare(cleanText, 80)
      : input.authorName
        ? `Publicación de ${input.authorName}`
        : "Publicación",
    shareDescription: cleanText
      ? truncateForShare(cleanText, 160)
      : "Mira esta publicación en Vibra.",
    shareImageUrl: input.previewImageUrl ?? null,
  };
}
