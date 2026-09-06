/**
 * El glifo de foto de Vibra, en un solo sitio.
 *
 * Había tres versiones del mismo dibujo repartidas por el producto: la del
 * compositor de mensajes, la verde del compositor de publicaciones y una de
 * contorno en los placeholders de portada y en adjuntar imagen de un
 * comentario. Distinto grosor, distinto encuadre y distinto peso visual para
 * decir exactamente lo mismo.
 *
 * 🚨 El dibujo va CENTRADO en el lienzo. No lo muevas sin recolocarlo. 🚨
 * La versión del chat ocupaba de 3.5 a 17.5 en las dos direcciones dentro de un
 * lienzo de 24, o sea centrada en (10.5, 11) cuando el centro es (12, 12). Ese
 * desvío se traducía en unos 2px a la izquierda y 1.25 arriba, y el icono se
 * veía más alto que sus vecinos con el hueco descuadrado. Las coordenadas de
 * aquí ya llevan la corrección de +1.5 en X y +1 en Y.
 */
export default function VibraPhotoIcon({
  size = 26,
  color = "#fff",
}: {
  size?: number;
  /** El marco se dibuja a trazo y el interior relleno, los dos de este color. */
  color?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <rect
        x="5"
        y="5"
        width="14"
        height="14"
        rx="2.4"
        fill="none"
        stroke={color}
        strokeWidth="2.2"
      />
      {/* El sol */}
      <circle cx="8.7" cy="9.2" r="1.6" fill={color} />
      {/* Las montañas, que suben hasta tapar el borde inferior del marco */}
      <path d="M5 16.8 L9.5 12.2 L12 14.8 L15.7 11 L19 14.5 V19 H5 Z" fill={color} />
    </svg>
  );
}
