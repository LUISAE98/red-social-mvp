import ListSkeleton from "@/components/ui/ListSkeleton";
import SkeletonBlock from "@/components/ui/SkeletonBlock";

/**
 * Avisos. El título y luego la lista, con las medidas de `.notifPage`: 640 de
 * ancho —no los 720 por defecto de `ListSkeleton`, que dejaban la lista más
 * ancha que la real— y la cabecera de `.notifPageHead` con su aire de
 * `0 16px 10px`.
 *
 * Sin el título, al montar la página aparecía de golpe y empujaba la lista hacia
 * abajo: un salto que se leía como un segundo esqueleto.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "8px 0 0", boxSizing: "border-box" }}>
        <div style={{ padding: "0 16px 10px" }}>
          <SkeletonBlock width={132} height={25} radius={7} />
        </div>
        <ListSkeleton rows={8} avatarSize={44} maxWidth={640} padding="0 16px" />
      </div>
    </main>
  );
}
