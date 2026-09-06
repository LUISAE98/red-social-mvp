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
 * 🚨 ESTE FALLBACK NO DIBUJA FORMAS, Y NO PUEDE VOLVER A DIBUJARLAS.
 *
 * Se dispara para TODAS las hijas del segmento, no solo para el feed. Cuando
 * pintaba tres tarjetas de publicación, entrar a un perfil se veía así: primero
 * tres posts falsos, luego la cabecera del perfil, luego el contenido. Dos
 * esqueletos seguidos con siluetas distintas, y el primero mintiendo sobre lo
 * que venía. Cualquier forma que se ponga aquí va a ser la equivocada en la
 * mayoría de las rutas.
 *
 * Así que aquí solo se reserva el alto de la pantalla: el cambio se nota —el
 * contenido anterior desaparece en el acto— y el único esqueleto con forma que
 * llega a verse es el de la ruta destino, que sí sabe lo que viene. Cada ruta
 * pone su silueta en su propio `loading.tsx` (o en su cliente, como hace el
 * feed con `PostSkeletonList`).
 */
export default function Loading() {
  return <main style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%" }} aria-hidden="true" />;
}
