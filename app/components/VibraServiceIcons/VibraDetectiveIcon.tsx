"use client";

// Quien encarga sin haber puesto perfil todavía.
//
// Una persona con sombrero y gabardina: se lee como "anónimo" de un vistazo,
// sin necesidad de etiqueta. Es mejor que unas iniciales sacadas de un nombre de
// relleno, que solo consiguen que un código parezca un nombre.
//
// 📌 Cuando exista el completar-perfil de Vibra Express (bloque 7), la mayoría
// traerá foto y esto casi no se verá. No sobra: una cuenta recién nacida sigue
// llegando sin nada, y ese hueco tiene que decir algo.

export default function VibraDetectiveIcon({
  size = 24,
  color = "currentColor",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Ala del sombrero */}
      <path d="M3.5 8.4h17" />
      {/* Copa */}
      <path d="M6.9 8.4c0-2.9 2.3-4.9 5.1-4.9s5.1 2 5.1 4.9" />
      {/* Cabeza, bajo el ala */}
      <path d="M8.1 10.2a3.9 3.9 0 0 0 7.8 0" />
      {/* Hombros de la gabardina, con solapa */}
      <path d="M4.7 20.5c0-3.2 3.3-5.2 7.3-5.2s7.3 2 7.3 5.2" />
      <path d="M12 15.3v5.2" />
    </svg>
  );
}
