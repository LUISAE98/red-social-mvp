// Collage de fondo compartido por el splash de carga (app/layout.tsx) y el
// login (LoginCollageBackground). Fuente única: antes la lista y la lógica
// estaban duplicadas en ambos archivos.

export type CollageImage = { src: string; wide: boolean };

// Set curado. `wide: true` → la imagen es apaisada y ocupa dos columnas.
// El orden alterna cuadrada/ancha a propósito: la cuadrícula es de 6 columnas,
// así que cada fila queda cuadrada(1) + ancha(2) + cuadrada(1) + ancha(2) = 6
// exactas, sin huecos. No romper esa alternancia al editar la lista.
export const COLLAGE_IMAGES: CollageImage[] = [
  { src: "gaming", wide: false },
  { src: "desbloquearcontenido", wide: true },
  { src: "musica", wide: false },
  { src: "encuentroenvivo", wide: true },
  { src: "tecnologia", wide: false },
  { src: "saludo", wide: true },
  { src: "educacion", wide: false },
  { src: "live", wide: true },
  { src: "negocios", wide: false },
  { src: "sesionexclusiva", wide: true },
];

/**
 * Reparte las imágenes en `count` tiles recorriendo el set en orden.
 *
 * Sin rotación a propósito. La versión anterior desplazaba cada repetición
 * (`(i % len + Math.floor(i / len) * 3) % len`) con la intención de evitar
 * repeticiones, pero conseguía lo contrario: arrastraba imágenes iguales a la
 * misma zona de la cuadrícula. Medido sobre la ventana visible en móvil
 * (~3 columnas x ~5 filas, porque los tiles ocupan 40vw): la rotación dejaba
 * 3.33 imágenes duplicadas a la vista y el recorrido simple deja 0.00.
 * El recorrido simple gana en todos los tamaños de ventana entre 2x4 y 4x8.
 */
export function buildCollageTiles(count: number): CollageImage[] {
  return Array.from(
    { length: count },
    (_, i) => COLLAGE_IMAGES[i % COLLAGE_IMAGES.length]
  );
}
