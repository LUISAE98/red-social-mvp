import { PostSkeleton } from "@/app/components/PostSkeleton/PostSkeleton";
import SkeletonBlock from "@/components/ui/SkeletonBlock";

/**
 * Detalle de una publicación. Una sola tarjeta, no una lista, y con el botón de
 * volver encima. Se copian las medidas de `.postPage` y `.postBack` de la página
 * real (640 de ancho, el mismo aire arriba y los mismos márgenes del botón) para
 * que la tarjeta no dé un salto al llegar.
 */
export default function Loading() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 0 96px" }}>
      <div style={{ margin: "4px 16px 12px", padding: "6px 4px" }}>
        <SkeletonBlock width={84} height={16} radius={6} />
      </div>
      <PostSkeleton />
    </div>
  );
}
