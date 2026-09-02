"use client";

// Quien encarga sin haber puesto perfil todavía.
//
// Una silueta con sombrero, en blanco sólido sobre un círculo gris: se lee como
// "anónimo" de un vistazo, sin necesidad de etiqueta. Es mejor que unas
// iniciales sacadas de un nombre de relleno, que solo consiguen que un código
// parezca un nombre.
//
// ⚠️ Se dibuja con FORMAS RELLENAS, no con trazos finos. A 38 o 44 píxeles un
// contorno de línea se deshace y no se distingue de cualquier otro monigote; la
// silueta aguanta el tamaño pequeño, que es el único al que se va a ver.
//
// Trae su propio círculo de fondo, así que se usa SOLA, sin envolverla en otro
// avatar de respaldo: dos círculos concéntricos es justo lo que se veía mal.
//
// 📌 Cuando exista el completar-perfil de Vibra Express (bloque 7), la mayoría
// traerá foto y esto casi no se verá. No sobra: una cuenta recién nacida sigue
// llegando sin nada, y ese hueco tiene que decir algo.

import { useId } from "react";

export default function VibraDetectiveIcon({
  size = 44,
  color = "#ffffff",
  background = "#4b515e",
}: {
  size?: number;
  color?: string;
  background?: string;
}) {
  // Un identificador por instancia. En una lista de encargos salen varios a la
  // vez, y un id repetido dentro de un documento es inválido; funciona por
  // accidente porque todos recortan igual, y dejaría de hacerlo en cuanto la
  // forma cambiara.
  const clipId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        {/* Los hombros salen por debajo del círculo; esto los recorta a ras. */}
        <clipPath id={clipId}>
          <circle cx="24" cy="24" r="24" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="24" fill={background} />
      <g fill={color} clipPath={`url(#${clipId})`}>
        {/* Copa del sombrero */}
        <path d="M15.6 16.4v-1.1c0-4.7 3.6-8.4 8.4-8.4s8.4 3.7 8.4 8.4v1.1z" />
        {/* Ala, más ancha que la copa: es lo que lo hace un sombrero y no un gorro */}
        <rect x="6.4" y="16.4" width="35.2" height="3.5" rx="1.75" />
        {/* Cabeza, asomando bajo el ala */}
        <path d="M17.1 19.9h13.8v1.9a6.9 6.9 0 0 1-13.8 0z" />
        {/* Hombros de la gabardina */}
        <path d="M24 29.4c7.1 0 12.9 4.7 12.9 10.4V48H11.1v-8.2c0-5.7 5.8-10.4 12.9-10.4z" />
        {/* Cuello de la gabardina: la muesca que separa la cabeza del cuerpo */}
        <path d="M21.5 29.9h5l-2.5 4.4z" fill={background} />
      </g>
    </svg>
  );
}
