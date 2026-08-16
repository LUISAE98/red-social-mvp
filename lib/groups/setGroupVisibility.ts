import {
  doc,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Group, GroupVisibility } from "@/types/group";
import { buildGroupSearchIndexPatch } from "./groupSearchIndex";

/** Un grupo NO oculto es descubrible; oculto no. Misma regla que el panel General. */
export function getDiscoverableFromVisibility(
  visibility: GroupVisibility
): boolean {
  return visibility !== "hidden";
}

/**
 * Cambia la visibilidad de un grupo manteniendo consistentes `discoverable` y el
 * índice de búsqueda `search` (mismo efecto que el panel General → Configuración).
 * Requiere los campos del grupo que alimentan el índice (name/description/category/tags),
 * porque `buildGroupSearchIndex` los necesita para no dejar el índice desactualizado.
 */
export async function setGroupVisibility(
  groupId: string,
  nextVisibility: GroupVisibility,
  group: {
    name?: string | null;
    description?: string | null;
    category?: string | null;
    tags?: string[] | null;
    /**
     * ⚠️ Estado real de la comunidad. Antes se pasaba `true` a ciegas al índice,
     * así que cambiar la visibilidad de una comunidad PAUSADA la devolvía a las
     * búsquedas — el descubrimiento filtra por `search.isActive`, no por
     * `isActive`. Ausente se toma como activa, que es el caso normal.
     */
    isActive?: boolean | null;
  }
): Promise<void> {
  const discoverable = getDiscoverableFromVisibility(nextVisibility);
  const updatedAt = serverTimestamp() as unknown as Timestamp;

  await updateDoc(doc(db, "groups", groupId), {
    visibility: nextVisibility,
    discoverable,
    updatedAt,
    // buildGroupSearchIndex normaliza estos campos (categoría inválida → fallback),
    // así que basta con dar valores por defecto seguros ante null/undefined.
    ...buildGroupSearchIndexPatch({
      name: group.name ?? "",
      description: group.description ?? "",
      category: (group.category ?? "otros") as Group["category"],
      tags: group.tags ?? [],
      visibility: nextVisibility,
      discoverable,
      isActive: group.isActive !== false,
      updatedAt,
    }),
  });
}
