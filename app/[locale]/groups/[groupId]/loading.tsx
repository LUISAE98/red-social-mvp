import ProfileHeaderSkeleton from "@/components/profile/ProfileHeaderSkeleton";
import { groupPageUi } from "@/lib/groups/groupPageStyles";

/**
 * Comunidad. El otro destino frecuente desde el feed —el nombre de la comunidad
 * en la cabecera de una publicación—, junto con el perfil.
 *
 * Mismo skeleton y mismo ancho que usa la página mientras resuelve sus datos, así
 * que el relevo entre este fallback y el suyo no se ve.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "100dvh", background: "#000" }}>
      <ProfileHeaderSkeleton maxWidth={groupPageUi.pageMaxWidth} />
    </main>
  );
}
