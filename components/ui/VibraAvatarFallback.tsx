"use client";

// El hueco del avatar cuando no hay foto NI nombre.
//
// Lleva la marca de Vibra. No intenta representar a la persona —no hay nada que
// representar todavía— sino decir de qué casa viene esa compra.
//
// ⚠️ Sustituye a un intento anterior de dibujar una silueta de detective. Un
// dibujo figurativo a 38 o 44 píxeles no se lee: o queda tosco o se confunde
// con cualquier otro monigote. La marca sí funciona a ese tamaño, porque está
// diseñada exactamente para eso.
//
// Se usa la imagen A SANGRE, llenando el círculo entero. Su degradado llega
// hasta el borde, así que no hace falta ponerle fondo ni márgenes: el intento
// anterior usaba un logotipo sobre blanco y obligaba a un círculo claro que
// desentonaba en una lista oscura.
//
// 📌 Esto es SOLO el respaldo. En cuanto esa persona complete su perfil, su
// nombre y su foto mandan y esto desaparece solo: quien decide es `hasRealName`
// y `photoURL` en cada pantalla, no este componente. Con el completar-perfil de
// Vibra Express (bloque 7) será lo normal. No quitarlo entonces: una cuenta
// recién nacida sigue llegando sin nada, y ese hueco tiene que decir algo.

/** Sale de `public/favicons/android-chrome-512x512.png`, reducido a 256 y webp. */
const MARCA = "/vibra-mark.webp";

export default function VibraAvatarFallback({ size = 44 }: { size?: number }) {
  return (
    // Un <img> a secas y no `next/image`: es un archivo local y fijo, ya
    // reducido a 256 y en webp (menos de 4 KB), y así no depende de la lista de
    // dominios permitidos ni pasa por el optimizador para nada.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={MARCA}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        display: "block",
        flexShrink: 0,
        border: "1px solid rgba(255,255,255,0.12)",
        boxSizing: "border-box",
      }}
    />
  );
}
