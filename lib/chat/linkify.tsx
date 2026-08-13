import React from "react";

/**
 * Convierte en enlaces las direcciones que aparecen dentro de un mensaje.
 *
 * Sin esto, mandar una dirección la dejaba como texto plano: había que
 * seleccionarla y copiarla a mano.
 *
 * Solo se enlazan `http://`, `https://` y lo que empieza por `www.`. Nada de
 * inventar esquemas: un `javascript:` enlazado sería un agujero, y detectar
 * "cualquier cosa con un punto" convierte cada abreviatura en un enlace roto.
 */

/**
 * El último carácter no puede ser puntuación de cierre: sin eso, "mira vibraon.com."
 * se llevaría el punto final dentro del enlace, y "(vibraon.com)" el paréntesis.
 */
const URL_PATTERN = /((?:https?:\/\/|www\.)[^\s<]*[^\s<.,:;!?"')\]}])/gi;

/** Copia sin `g` para poder preguntar por una parte suelta sin arrastrar estado. */
const URL_TEST = new RegExp(`^${URL_PATTERN.source}$`, "i");

/** `www.algo` no es una URL válida para `href`: le falta el esquema. */
function toHref(match: string): string {
  return match.startsWith("www.") ? `https://${match}` : match;
}

export function renderMessageText(text: string): React.ReactNode {
  if (!text) return text;

  // Con el grupo de captura, `split` devuelve también las coincidencias.
  const parts = text.split(URL_PATTERN);
  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    if (!part) return null;
    if (!URL_TEST.test(part)) return <React.Fragment key={index}>{part}</React.Fragment>;

    return (
      <a
        key={index}
        href={toHref(part)}
        target="_blank"
        // `noopener` es lo que impide que la página abierta pueda manipular la
        // pestaña de Vibra a través de `window.opener`.
        rel="noopener noreferrer nofollow"
        // Tocar el enlace no debe además desplegar el detalle del mensaje.
        onClick={(e) => e.stopPropagation()}
        style={{ color: "inherit", textDecoration: "underline" }}
      >
        {part}
      </a>
    );
  });
}
