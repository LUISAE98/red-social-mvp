import ListSkeleton from "@/components/ui/ListSkeleton";

/**
 * Mis experiencias (lo que la persona compró). Miniatura cuadrada en vez de
 * círculo: aquí la fila encabeza un producto, no una persona.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <ListSkeleton rows={5} avatarSize={56} avatarShape="square" />
    </main>
  );
}
