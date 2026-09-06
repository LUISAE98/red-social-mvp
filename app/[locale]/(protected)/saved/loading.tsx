import { PostSkeletonList } from "@/app/components/PostSkeleton/PostSkeleton";

/**
 * Guardados. Misma silueta que el feed —son las mismas tarjetas— y el mismo
 * ancho de 720 que usa `SavedPostsFeed`, para que el relevo entre este fallback
 * y el esqueleto del cliente no mueva nada de sitio.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
        <PostSkeletonList count={3} />
      </div>
    </main>
  );
}
