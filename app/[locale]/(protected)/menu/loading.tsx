import ListSkeleton from "@/components/ui/ListSkeleton";

/** Menú del avatar: tu tarjeta de perfil, a quién sigues y tus comunidades. */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <ListSkeleton rows={7} avatarSize={48} />
    </main>
  );
}
