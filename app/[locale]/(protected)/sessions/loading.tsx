import { CardsSkeleton } from "@/components/ui/ListSkeleton";
import SkeletonBlock from "@/components/ui/SkeletonBlock";

/**
 * Sesiones. El mismo dibujo que ya pinta la página mientras resuelve sus datos
 * —`CardsSkeleton count={3} height={116}`— dentro del mismo `pageWrapper` de 640
 * con su aire de `8px 16px 0`, para que el relevo entre este fallback y el de la
 * página no mueva ni un pixel.
 */
export default function Loading() {
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 16px 0", boxSizing: "border-box" }}>
      <div style={{ marginBottom: 16 }}>
        <SkeletonBlock width={172} height={25} radius={7} />
      </div>
      <CardsSkeleton count={3} height={116} />
    </div>
  );
}
