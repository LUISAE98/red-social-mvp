/**
 * Datos falsos para montar los componentes del simulador.
 *
 * Viven aparte porque son ruido: lo que importa de una fila es el botón, no el
 * post ni el servicio que hace falta inventarle al componente para que arranque.
 */
import type { Post } from "@/lib/posts/types";

export const POST_DEMO: Post = {
  id: "demo-post",
  text: "Publicación de mentira para montar el visor de imágenes del feed.",
  authorId: "demo-autor",
  authorName: "Ana Creadora",
  isDeleted: false,
};

export const AUTOR_DEMO = {
  authorName: "Ana Creadora",
  avatarUrl: null,
  profileHref: "/es/u/ana",
};

export const IMAGEN_DEMO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ec4899"/><stop offset="0.5" stop-color="#9333ea"/>
        <stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
      <rect width="900" height="900" fill="url(#g)"/>
      <text x="450" y="470" font-family="system-ui" font-size="54" fill="#fff"
        text-anchor="middle" opacity="0.9">imagen de mentira</text>
    </svg>`,
  );

export const USUARIOS_FLAMA = [
  { userId: "u1", displayName: "Ana Creadora", username: "ana", avatarUrl: null },
  { userId: "u2", displayName: "Beto Público", username: "beto", avatarUrl: null },
  { userId: "u3", displayName: "Cami Vibra", username: "cami", avatarUrl: null },
];

export const CANALES_WALLET = [
  { id: "saludos", label: "Saludos" },
  { id: "consejos", label: "Consejos" },
  { id: "sesiones", label: "Sesiones exclusivas" },
];
