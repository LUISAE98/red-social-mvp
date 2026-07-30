// Texto con el degradado de marca animado — el efecto de la palabra "Vibra".
//
// El original vive inline en LoginClient.tsx (.heroVibraGradientText) y fue
// copiado a mano en SessionOutro.tsx y en la página de dev de video-icons.
// Este componente existe para no seguir multiplicando esa copia; el contrato
// (ángulo, paradas de color, background-size y timing) es idéntico al del login.

import type { CSSProperties, ReactNode } from "react";

export default function VibraGradientText({
  children,
  className,
  gradient,
  style,
}: {
  children: ReactNode;
  /** Clase extra del consumidor (tamaño, peso, etc.). El degradado no se toca. */
  className?: string;
  /**
   * Degradado alternativo (CSS `linear-gradient(...)`). Por defecto usa el de
   * marca. Se aplica como `background-image` para conservar el background-size
   * y la animación de la clase; usar el shorthand `background` los reiniciaría.
   */
  gradient?: string;
  /** Estilos extra (p. ej. `fontSize`) para el span. Se fusionan con el degradado. */
  style?: CSSProperties;
}) {
  return (
    <>
      <style jsx>{`
        .vibraGradientText {
          background: linear-gradient(
            100deg,
            #ff2fb3 0%,
            #a855f7 45%,
            #4f46ff 100%
          );
          background-size: 220% 220%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: vibraTextFlow 4.5s ease-in-out infinite;
        }

        @keyframes vibraTextFlow {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }

        /* Respeta a quien pidió menos movimiento: el degradado se queda quieto,
           pero el texto conserva sus colores. */
        @media (prefers-reduced-motion: reduce) {
          .vibraGradientText {
            animation: none;
            background-position: 50% 50%;
          }
        }
      `}</style>

      <span
        className={["vibraGradientText", className].filter(Boolean).join(" ")}
        style={{ ...(gradient ? { backgroundImage: gradient } : {}), ...style }}
      >
        {children}
      </span>
    </>
  );
}
