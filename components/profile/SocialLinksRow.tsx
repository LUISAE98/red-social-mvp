"use client";

import { listSocialLinks, type SocialLinks } from "@/lib/profile/socialNetworks";
import SocialIcon from "./SocialIcon";

/**
 * Las redes del perfil en el card: una fila de íconos, sin texto.
 *
 * Cada liga se arma en `socialProfileUrl` a partir del catálogo; lo guardado es
 * solo el usuario y nunca llega crudo al `href`. Se abren en pestaña nueva con
 * `rel="me noopener noreferrer nofollow"` — `noopener` para que la página de
 * destino no pueda tocar la nuestra, y `nofollow` para no repartir peso de
 * buscador desde un campo que llena cualquiera.
 */
export default function SocialLinksRow({
  links,
  size = 22,
}: {
  links: SocialLinks | null | undefined;
  size?: number;
}) {
  const items = listSocialLinks(links);
  if (items.length === 0) return null;

  return (
    <div className="vb-social-row">
      <style jsx global>{`
        .vb-social-row {
          margin-top: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 14px;
        }

        /* Sin caja: el logotipo suelto, con sus propios colores. La separacion
           entre ellos es la que los ordena. El area de toque sigue siendo
           holgada por el acolchado, aunque no se vea. */
        .vb-social-link {
          display: grid;
          place-items: center;
          padding: 2px;
          border-radius: 999px;
          transition:
            transform 160ms ease,
            opacity 160ms ease;
        }

        .vb-social-link:hover {
          transform: scale(1.12);
        }

        .vb-social-link:active {
          opacity: 0.75;
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-social-link {
            transition: none;
          }
          .vb-social-link:hover {
            transform: none;
          }
        }
      `}</style>

      {items.map((item) => (
        <a
          key={item.id}
          className="vb-social-link"
          href={item.url}
          target="_blank"
          rel="me noopener noreferrer nofollow"
          title={`${item.label} · @${item.handle}`}
          aria-label={`${item.label}, @${item.handle}`}
        >
          <SocialIcon id={item.id} size={size} />
        </a>
      ))}
    </div>
  );
}
