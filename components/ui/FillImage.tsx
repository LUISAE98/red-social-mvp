"use client";

// Una imagen que llena a su contenedor posicionado.
//
// ⚠️ Es un `<img>` a pelo, y NO `next/image`, a propósito.
//
// `next/image` valida el dominio de cada URL contra la lista de
// `remotePatterns` de la configuración — y lo hace AUNQUE las imágenes vayan sin
// optimizar. Una foto de perfil alojada en un host que no esté en esa lista no
// da error visible: sale en blanco. De ahí que los avatares cargaran "a veces
// sí y a veces no", según de dónde viniera la foto de cada persona.
//
// El `Avatar` compartido ya usaba un `<img>` normal por este mismo motivo. Esto
// es lo mismo para los sitios que necesitan que la imagen llene a su padre.
//
// El resultado visual es idéntico al de `next/image` con `fill`: ese modo pinta
// exactamente `position:absolute; inset:0; width:100%; height:100%`.

import { useState } from "react";

type Props = {
  src: string | null | undefined;
  alt?: string;
  /** Qué se ve si la imagen falla o no hay. Normalmente el marcador de siempre. */
  fallback?: React.ReactNode;
  objectFit?: "cover" | "contain";
  className?: string;
  /**
   * Diferir la carga hasta que la imagen entre en pantalla.
   *
   * 🚨 Por defecto es `false`, y eso es un CAMBIO deliberado: antes todas las
   * imágenes de aquí eran `loading="lazy"` y `decoding="async"`.
   *
   * Ese par estaba causando el parpadeo de los avatares. Un `<img loading="lazy">`
   * recién insertado no se pinta en el mismo fotograma ni aunque los bytes ya
   * estén en la caché del navegador: primero hay que decidir si está en pantalla,
   * y esa decisión ocurre DESPUÉS del layout. Con `decoding="async"` encima, el
   * navegador tiene además permiso para pintar el fotograma sin la imagen
   * decodificada. Resultado: un hueco en blanco de un fotograma.
   *
   * Normalmente no se nota, porque el elemento se crea una vez. Se nota mucho
   * donde el elemento se RECREA: el visor de historias remonta el panel entero
   * en cada historia (`key={story.id}`), así que ese fotograma en blanco se
   * repetía en cada paso. Se veía como el avatar quitándose y poniéndose, y
   * pasaba aunque el perfil ya estuviera en caché — no era un problema de datos.
   *
   * Diferir la carga tiene sentido para media pesada bajo el pliegue. Los seis
   * sitios que usan esto son avatares y círculos de historia: pequeños y a la
   * vista. Ahí lo que hace falta es que aparezcan sin dudar.
   */
  lazy?: boolean;
};

export default function FillImage({
  src,
  alt = "",
  fallback = null,
  objectFit = "cover",
  className,
  lazy = false,
}: Props) {
  // Una URL rota deja de intentarse y se enseña el marcador. Sin esto, el hueco
  // se queda vacío y parece que la persona no tiene foto.
  const [failed, setFailed] = useState(false);

  if (!src || failed) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={lazy ? "lazy" : "eager"}
      // `sync` acompaña a `eager`: pedir la imagen cuanto antes y luego dejar
      // que el navegador pinte sin ella devolvería el mismo hueco por otra vía.
      decoding={lazy ? "async" : "sync"}
      // Las fotos de Google rechazan la petición si les llega el origen que la
      // pide. Sin esto, un avatar de una cuenta de Google puede no cargar.
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit,
        display: "block",
      }}
    />
  );
}
