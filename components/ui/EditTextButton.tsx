"use client";

/**
 * "Editar" en texto morado.
 *
 * Sustituye a los lápices flotantes que había sobre el avatar, la portada y las
 * historias. Un icono encima de una foto tapa parte de la imagen y, sin fondo ni
 * borde, no se lee como algo pulsable; el texto sí, y no le quita sitio a lo que
 * está mirando la persona.
 *
 * Lleva sombra en el texto porque sobre una portada puede caer encima de
 * cualquier color, y el morado solo no siempre despega del fondo.
 */
export default function EditTextButton({
  children,
  onClick,
  disabled,
  ariaLabel,
  title,
  style,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      style={{
        border: "none",
        background: "transparent",
        padding: 0,
        color: "#a855f7",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        fontFamily: "inherit",
        letterSpacing: "-0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        textShadow: "0 1px 3px rgba(0,0,0,0.55)",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
