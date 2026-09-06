import ListSkeleton from "@/components/ui/ListSkeleton";
import SkeletonBlock from "@/components/ui/SkeletonBlock";

/**
 * Mis experiencias. La página son tres pestañas —pendientes, rechazadas,
 * entregadas— y debajo la lista de compras con miniatura cuadrada.
 *
 * Este fallback dibuja las dos cosas, con las medidas de la página real: el
 * ancho de 640 con su aire de `8px 12px 0`, el subnav de `.expSubnav` (icono
 * arriba, etiqueta abajo, 16 de separación con lo que sigue) y las mismas filas
 * que pinta la página mientras carga sus datos, con `padding="0"` porque el aire
 * ya lo pone el envoltorio.
 *
 * Antes solo dibujaba la lista: al montar la página aparecían las pestañas de
 * golpe y empujaban las filas hacia abajo, y ese salto se leía como un segundo
 * esqueleto en vez de como un relevo.
 */
const PESTANAS = 3;

export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <div
        style={{ maxWidth: 640, margin: "0 auto", padding: "8px 12px 0", width: "100%", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", marginBottom: 16 }}>
          {Array.from({ length: PESTANAS }).map((_, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "2px 6px 12px",
              }}
            >
              <SkeletonBlock width={22} height={22} radius={6} />
              <SkeletonBlock width={64} height={10} radius={5} />
            </div>
          ))}
        </div>

        <ListSkeleton rows={5} avatarSize={56} avatarShape="square" padding="0" />
      </div>
    </main>
  );
}
