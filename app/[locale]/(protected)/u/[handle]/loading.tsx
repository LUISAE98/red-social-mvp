import ProfileHeaderSkeleton from "@/components/profile/ProfileHeaderSkeleton";

/**
 * Perfil. Es la navegación más común desde el contenido —tocar el avatar de una
 * publicación— y la que más se notaba: el perfil ya tenía su skeleton, pero solo
 * aparecía DESPUÉS de que la navegación terminara, así que entre el toque y el
 * skeleton se quedaba la pantalla anterior congelada.
 *
 * Mismo componente que usa ProfileClient mientras resuelve sus datos, así que el
 * relevo entre este fallback y el de la página no se ve: es el mismo dibujo.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "100dvh", background: "#000" }}>
      <ProfileHeaderSkeleton />
    </main>
  );
}
