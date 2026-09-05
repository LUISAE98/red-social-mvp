/**
 * Reels. No lleva filas ni tarjetas: el reel ocupa la pantalla entera, así que
 * el fallback es un solo bloque a pantalla completa con la misma onda que el
 * resto de los skeletons. Dibujar aquí una lista mentiría sobre lo que viene.
 */
export default function Loading() {
  return (
    <main
      style={{
        position: "relative",
        width: "100%",
        height: "var(--vb-alto-pantalla)",
        background: "#000",
        overflow: "hidden",
      }}
    >
      {/* El relleno y la onda son los de `.vb-skel` en globals.css; aquí solo
          se dice que ocupa el hueco entero. La posición va en línea para que
          gane siempre a la de la clase, sin depender del orden de las hojas. */}
      <div
        className="vb-skel"
        aria-hidden="true"
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
      />
    </main>
  );
}
