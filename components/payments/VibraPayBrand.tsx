import type { CSSProperties } from "react";

/**
 * Wordmark "Vibra" con el gradiente animado del header (mismo efecto de colores
 * que `.brandLogo`). Se usa en las pasarelas de pago (Stripe y Mercado Pago) en el
 * lugar donde antes iba el logo del procesador.
 */
export default function VibraPayBrand({ style }: { style?: CSSProperties }) {
  return (
    <>
      <style>{`@keyframes vibraPayBrandFlow{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}`}</style>
      <span
        aria-label="Vibra"
        style={{
          display: "inline-block",
          fontSize: 28,
          fontWeight: 680,
          letterSpacing: "-0.035em",
          lineHeight: 1,
          backgroundImage:
            "linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%)",
          backgroundSize: "220% 220%",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          WebkitTextFillColor: "transparent",
          animation: "vibraPayBrandFlow 4.5s ease-in-out infinite",
          ...style,
        }}
      >
        Vibra
      </span>
    </>
  );
}
