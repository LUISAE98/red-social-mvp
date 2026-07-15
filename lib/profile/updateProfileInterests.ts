import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import type { CanonicalGroupCategory } from "@/types/group";

type UpdateProfileInterestsResponse = {
  ok: boolean;
  interests: CanonicalGroupCategory[];
};

/**
 * Actualiza los intereses del perfil de forma autoritativa vía Cloud Function.
 * El backend valida las categorías, las persiste en `users/{uid}.interests` y
 * reconstruye el índice de búsqueda para que el perfil aparezca en búsquedas
 * por categoría (ej: "viajes", "autos"). Devuelve la lista normalizada.
 */
export async function updateProfileInterests(
  interests: CanonicalGroupCategory[]
): Promise<CanonicalGroupCategory[]> {
  const callable = httpsCallable<
    { interests: CanonicalGroupCategory[] },
    UpdateProfileInterestsResponse
  >(functions, "updateProfileInterests");

  const result = await callable({ interests });

  return result.data.interests;
}
