/**
 * Videollamada. Sin formas, a propósito.
 *
 * Existe para no heredar el fallback de `/sessions`, que dibuja la lista de
 * sesiones: entrar a una llamada vería primero tres tarjetas de lista y luego
 * una sala de video, dos cosas que no se parecen.
 *
 * Y no dibuja una silueta propia porque la sala ya tiene su propio estado de
 * conexión —con su aviso de qué está pasando—, y un esqueleto por encima solo
 * añadiría un parpadeo antes de él. Aquí basta con el lienzo negro a pantalla
 * completa, que es sobre lo que va a montarse la llamada.
 */
export default function Loading() {
  return (
    <main
      aria-hidden="true"
      style={{ minHeight: "var(--vb-alto-pantalla)", width: "100%", background: "#000" }}
    />
  );
}
