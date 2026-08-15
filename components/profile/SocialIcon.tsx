"use client";

import { useId } from "react";

import type { SocialNetworkId } from "@/lib/profile/socialNetworks";
import { SOCIAL_ICON_PATH } from "./socialIconPaths";

/**
 * La marca de una red, como se ve de verdad.
 *
 * Un solo color plano no alcanza, y por eso cada una se pinta a su manera:
 *
 * - **Instagram** es un degradado, no un rosa. Se le aplica al trazo oficial.
 * - **YouTube y Facebook** son insignias: el trazo oficial es la pastilla con el
 *   símbolo RECORTADO, no dibujado. Pintado de un color, el hueco deja ver el
 *   fondo — que aquí es negro— y el triángulo o la f se ven oscuros en vez de
 *   blancos. Se resuelve poniendo la pieza blanca DETRÁS y el trazo de marca
 *   encima: el recorte la descubre.
 * - **TikTok** son tres copias del mismo trazo, corridas: cian a un lado,
 *   magenta al otro y blanca al centro. Así está hecho el logo original.
 * - **X y Twitch** sí son de un color, y ya.
 */

const INSTAGRAM_STOPS = [
  { offset: "0%", color: "#FFDC80" },
  { offset: "20%", color: "#FCAF45" },
  { offset: "40%", color: "#F56040" },
  { offset: "60%", color: "#E1306C" },
  { offset: "80%", color: "#C13584" },
  { offset: "100%", color: "#5851DB" },
];

/** El triángulo que YouTube lleva recortado en su pastilla. */
const YOUTUBE_PLAY = "M9.545 15.568V8.432L15.818 12l-6.273 3.568z";

export default function SocialIcon({
  id,
  size = 18,
}: {
  id: SocialNetworkId;
  size?: number;
}) {
  // Los degradados se referencian por id, y en una fila hay varios íconos a la
  // vez: con un id fijo, todos apuntarían a la primera definición del documento.
  const uid = useId();
  const gradientId = `vb-social-ig-${uid}`;
  const path = SOCIAL_ICON_PATH[id];

  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
  };

  if (id === "instagram") {
    return (
      <svg {...common}>
        <defs>
          {/* En diagonal, como el original: arriba a la derecha el amarillo y
              abajo a la izquierda el morado. */}
          <linearGradient id={gradientId} x1="100%" y1="0%" x2="0%" y2="100%">
            {INSTAGRAM_STOPS.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>
        <path d={path} fill={`url(#${gradientId})`} />
      </svg>
    );
  }

  if (id === "youtube") {
    return (
      <svg {...common}>
        <path d={YOUTUBE_PLAY} fill="#fff" />
        <path d={path} fill="#ff0000" />
      </svg>
    );
  }

  if (id === "facebook") {
    return (
      <svg {...common}>
        {/* Un pelo por dentro del borde, para que no asome un halo blanco. */}
        <circle cx="12" cy="12" r="11.4" fill="#fff" />
        <path d={path} fill="#0866ff" />
      </svg>
    );
  }

  if (id === "tiktok") {
    return (
      <svg {...common}>
        <path d={path} fill="#25f4ee" transform="translate(-1.1 -0.7)" />
        <path d={path} fill="#fe2c55" transform="translate(1.1 0.7)" />
        <path d={path} fill="#fff" />
      </svg>
    );
  }

  // X en blanco: su color de marca es el negro, y sobre nuestro fondo negro no
  // se vería. Twitch sí va con el suyo.
  return <svg {...common}>
    <path d={path} fill={id === "x" ? "#fff" : "#9146ff"} />
  </svg>;
}
