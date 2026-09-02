"use client";

// El hueco del avatar cuando no hay foto NI nombre.
//
// Lleva el logotipo de Vibra, la W de las dos V. No intenta representar a la
// persona —no hay nada que representar todavía— sino decir de quién es la casa
// donde se hizo esa compra.
//
// ⚠️ Sustituye a un intento anterior de dibujar una silueta de detective. Un
// dibujo figurativo a 38 o 44 píxeles no se lee: o queda tosco o se confunde
// con cualquier otro monigote. La marca sí funciona a ese tamaño, porque está
// diseñada para eso.
//
// El fondo va CLARO a propósito: el logotipo es de colores vivos sobre blanco,
// y sobre un círculo oscuro se recortaría con un cuadro blanco alrededor.
//
// 📌 Cuando exista el completar-perfil de Vibra Express (bloque 7), la mayoría
// traerá foto y esto casi no se verá. No sobra: una cuenta recién nacida sigue
// llegando sin nada, y ese hueco tiene que decir algo.

export default function VibraAvatarFallback({ size = 44 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        background: "#fff",
        border: "1px solid rgba(255,255,255,0.16)",
        boxSizing: "border-box",
      }}
    >
      {/* Un <img> a secas y no `next/image`: es un archivo local y fijo, sin
          nada que optimizar, y así no depende de la lista de dominios. */}
      <img
        src="/logotipo.webp"
        alt=""
        width={Math.round(size * 0.78)}
        height={Math.round(size * 0.78)}
        style={{
          width: Math.round(size * 0.78),
          height: Math.round(size * 0.78),
          objectFit: "contain",
          display: "block",
        }}
      />
    </span>
  );
}
