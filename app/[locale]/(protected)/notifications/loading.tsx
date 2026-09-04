import ListSkeleton from "@/components/ui/ListSkeleton";

/** Avisos. Filas de avatar redondo + dos líneas, la forma de la lista real. */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <ListSkeleton rows={8} avatarSize={44} />
    </main>
  );
}
