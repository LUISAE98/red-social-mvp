// Collage de fondo compartido por el splash de carga (app/layout.tsx), el login
// (LoginCollageBackground) y el intro de la grabación de sesiones
// (egress/session/SessionIntro). Fuente única: antes la lista y la lógica
// estaban duplicadas.

// `flipMobile`: espeja la imagen horizontalmente SOLO en celular (scaleX(-1)),
// para que su sujeto quede del otro lado y componga mejor con la cuadrícula
// vertical. Es dato y no un `nth-child` en el CSS a propósito: así sobrevive si
// el set se reordena.
export type CollageImage = { src: string; wide: boolean; flipMobile?: boolean };

// Set completo de categorías/servicios: 35 imágenes, CADA UNA UNA SOLA VEZ.
// `wide: true` → apaisada, ocupa DOS espacios. 7 anchas x2 + 28 cuadradas x1 = 42.
//
// ── Preferencia ─────────────────────────────────────────────────────────────
// Las 10 curadas van PRIMERO (desbloquearcontenido, encuentroenvivo, educacion,
// live, musica, entretenimiento, saludo, gaming, donacion, sesionexclusiva):
// caen en las primeras filas, que es lo que se ve. El resto rellena el tapete
// hacia abajo/afuera.
//
// ── Por qué este orden no se toca a la ligera ───────────────────────────────
//
// Está construido con BLOQUES que suman 6 y además se parten limpio en 3+3, así
// embaldosa sin huecos a 6 columnas (laptop) Y a 3 (celular) con el MISMO array:
//
//   A = [ancha, cuadr, ancha, cuadr]                 → 6 = 3+3
//   B = [ancha, cuadr, cuadr, cuadr, cuadr]          → 6 = 3+3
//   C = [cuadr x6]                                   → 6 = 3+3
//
// Aquí: A A A B C C C  →  6 col = 7 filas, 3 col = 14 filas, cero huecos.
// (Con 7 anchas y 28 cuadradas la única familia de soluciones es b=7-2a, c=a.)
//
// Si se añade o quita una imagen, hay que rehacer los bloques y REVERIFICAR
// ambas cuadrículas: mezclar spans sin esta estructura mete huecos por todos
// lados. Y NO usar `grid-auto-flow: dense`: reacomoda los tiles y la rompe.
//
// Nota de proporciones: sólo hay 7 apaisadas reales (≥1.78) en /public. Las de
// 3:2 (autos, donacion, Crear-comunidad, miscomunidades, noticias, solicitados)
// van como cuadradas y el `object-fit: cover` les recorta los lados.
// `donacion2` queda fuera a propósito: es vertical (0.67) y se recortaría feo.
export const COLLAGE_IMAGES: CollageImage[] = [
  // ── Bloque A ×3 — aquí viven las 10 curadas ──
  { src: "desbloquearcontenido", wide: true },
  { src: "musica", wide: false },
  { src: "encuentroenvivo", wide: true },
  { src: "educacion", wide: false },

  { src: "live", wide: true },
  { src: "entretenimiento", wide: false },
  { src: "saludo", wide: true, flipMobile: true },
  { src: "gaming", wide: false },

  { src: "sesionexclusiva", wide: true },
  { src: "donacion", wide: false },
  { src: "consejo", wide: true },
  { src: "tecnologia", wide: false },

  // ── Bloque B ──
  // `ciencia` va aquí y no arriba: es ancha (2 espacios) y quedaba demasiado
  // protagonista bajo `saludo`. Sólo hay 7 anchas y todas viven en los bloques
  // A/B, así que ésta es la posición más discreta posible sin rehacer bloques.
  { src: "ciencia", wide: true },
  { src: "negocios", wide: false },
  { src: "creadores", wide: false },
  { src: "deportes", wide: false },
  { src: "arte", wide: false },

  // ── Bloques C ×3 — relleno del tapete ──
  { src: "cine", wide: false },
  { src: "comida", wide: false },
  { src: "familia", wide: false },
  { src: "fitness", wide: false },
  { src: "historia", wide: false },
  { src: "hobbies", wide: false },

  { src: "instituciones", wide: false },
  { src: "libros", wide: false },
  { src: "mascotas", wide: false },
  { src: "moda", wide: false },
  { src: "salud", wide: false },
  { src: "viajes", wide: false },

  { src: "autos", wide: false },
  { src: "Crear-comunidad", wide: false },
  { src: "miscomunidades", wide: false },
  { src: "noticias", wide: false },
  { src: "solicitados", wide: false },
  { src: "suscomunidades", wide: false },
];

/**
 * Devuelve el tapete completo: las 35 imágenes, una sola vez cada una.
 *
 * Ya no recicla. Antes el set eran 10 y había que repetirlas para cubrir la
 * pantalla (con 10 sin repetir los tiles salían de ~455px, enormes). Con 35 el
 * tapete cubre de sobra sin repetir ninguna: 7 filas a 6 columnas en laptop,
 * 14 filas a 3 columnas en celular.
 */
export function buildCollageTiles(): CollageImage[] {
  return COLLAGE_IMAGES;
}
