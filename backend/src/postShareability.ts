// Regla PURA de "¿este post se ve fuera de la comunidad?" (`isShareable`).
//
// Vive en su propio módulo SIN dependencias a propósito: la usa el trigger
// `groupPostsVisibilitySync` (Cloud Function, con Admin SDK) y también un test
// del frontend que comprueba que no diverja de `buildShareMetadata`, el que
// escribe el mismo campo al crear el post. Si esta lógica viviera junto al
// trigger, ese test arrastraría `firebase-admin`/`firebase-functions` al
// programa del frontend — que no los tiene instalados — y reventaría el CI y el
// build de Vercel.

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

/**
 * ¿Este post debe ser visible FUERA de la comunidad? Mismas reglas que al crear:
 *
 *  - Comunidad oculta      → nunca.
 *  - Premium con alcance público → sí (es justo lo que se vende afuera).
 *  - Live/VOD              → según el alcance que eligió el creador.
 *  - Post normal gratis    → solo si la comunidad es pública.
 *  - Post de pago sin premium ni live → no.
 */
export function resolveIsShareable(post: AnyRecord, groupVisibility: string | null): boolean {
  if (groupVisibility === "hidden") return false;

  const premium = asRecord(post.premium);
  if (premium?.enabled === true) {
    return premium.accessMode === "public";
  }

  const liveData = asRecord(post.liveData);
  if (liveData) {
    if (liveData.vodHidden === true) return false;
    return liveData.visibilityMode !== "members_only";
  }

  const isFree =
    (post.accessModel ?? "free") === "free" &&
    post.requiresPayment !== true &&
    post.requiresSubscription !== true;

  return isFree && groupVisibility === "public";
}
