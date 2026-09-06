import { CardsSkeleton } from "@/components/ui/ListSkeleton";

/**
 * Espacio personal. `OwnerSidebar` no es una lista de avatar + dos renglones
 * —que es lo que dibujaba antes este fallback— sino una pila de paneles: el
 * bloque del perfil arriba y debajo las secciones, todas con el radio 12 y los 8
 * de separación de `sectionPanel`.
 *
 * El ancho y el aire son los de la página: 720 con `16px 0 0`, y los 10 de
 * costado los pone el propio panel, así que aquí se reproducen a mano.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 10px 0", boxSizing: "border-box" }}>
        {/* El bloque de arriba, que es el del perfil, es más alto que los demás. */}
        <CardsSkeleton count={1} height={104} radius={12} />
        <div style={{ height: 8 }} />
        <CardsSkeleton count={5} height={62} radius={12} gap={8} />
      </div>
    </main>
  );
}
