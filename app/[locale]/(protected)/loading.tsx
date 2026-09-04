import { PostSkeleton } from "@/app/components/PostSkeleton/PostSkeleton";

/**
 * Fallback de navegación del área autenticada.
 *
 * Sin un `loading.tsx`, el App Router NO cambia de pantalla hasta que llega la
 * respuesta del servidor con la ruta destino: la pantalla anterior se queda
 * congelada y el toque parece no haber hecho nada. Con este archivo, Next crea
 * una frontera de Suspense y pinta esto AL INSTANTE, así que la navegación se
 * siente inmediata y el contenido llega después.
 *
 * El layout —bottom-nav, header, sidebar— NO se vuelve a montar; solo se
 * reemplaza el contenido. Esa permanencia del nav es justo lo que hace que se
 * lea como una app y no como una web recargando.
 *
 * Es el fallback COMPARTIDO de las hijas que no traen el suyo. Por eso dibuja
 * posts: la raíz es el feed, y guardados y el detalle de una publicación tienen
 * la misma forma. Las secciones con otra silueta —perfil, mensajes, avisos,
 * wallet, menú, reels— traen su propio `loading.tsx` al lado de su ruta.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }}>
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <PostSkeleton key={i} />
        ))}
      </div>
    </main>
  );
}
