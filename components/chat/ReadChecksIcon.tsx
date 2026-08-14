/**
 * Doble palomita de leído.
 *
 * Se dibuja con dos trazos desplazados en vez de dos palomitas completas: la
 * segunda tapa la mitad corta de la primera, que es como se lee el símbolo a
 * este tamaño sin que se convierta en una mancha.
 *
 * Vive aparte porque la usan el hilo (junto al globo) y la lista de
 * conversaciones (bajo la hora).
 */
export default function ReadChecksIcon({ size = 21 }: { size?: number }) {
  return (
    <svg
      width={size}
      // La proporción del lienzo es 26×16; el alto se deriva para no deformarla.
      height={Math.round((size * 16) / 26)}
      viewBox="0 0 26 16"
      fill="none"
      stroke="#53bdeb"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block" }}
    >
      <path d="M2 8.8L6.3 13L13.6 3.4" />
      <path d="M11.7 13L19 3.4" />
    </svg>
  );
}
