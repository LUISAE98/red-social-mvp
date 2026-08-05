// Lápiz de edición propio de Vibra (para "cambiar avatar" y "cambiar portada").
// Trazo con currentColor → hereda el color del botón (morado de marca). No es un emoji.
export default function EditPencilIcon({ size = 17 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {/* Cuerpo del lápiz */}
      <path d="M16.7 4.2a1.9 1.9 0 0 1 2.7 2.7L8.6 17.7l-3.6 1 1-3.6L16.7 4.2Z" />
      {/* Separación de la punta (bisel) */}
      <path d="M14.8 6.1l2.7 2.7" />
    </svg>
  );
}
