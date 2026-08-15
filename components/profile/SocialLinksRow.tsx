"use client";

import { listSocialLinks, type SocialLinks } from "@/lib/profile/socialNetworks";
import SocialIcon from "./SocialIcon";
import { SOCIAL_ICON_BRAND } from "./socialIconPaths";

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
  size = 18,
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
          gap: 6px;
        }

        .vb-social-link {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          border-radius: 999px;
          color: rgba(255, 255, 255, 0.72);
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.04);
          transition:
            color 160ms ease,
            border-color 160ms ease,
            background 160ms ease;
        }

        /* El color de la marca solo aparece al pasar el cursor. En reposo los
           seis van del mismo gris: una fila de logos a todo color le roba la
           atencion al nombre y a la foto, que es de lo que va el card. */
        .vb-social-link:hover {
          color: var(--vb-social-brand, #fff);
          border-color: rgba(255, 255, 255, 0.28);
          background: rgba(255, 255, 255, 0.09);
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-social-link {
            transition: none;
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
          style={
            { "--vb-social-brand": SOCIAL_ICON_BRAND[item.id] } as React.CSSProperties
          }
        >
          <SocialIcon id={item.id} size={size} />
        </a>
      ))}
    </div>
  );
}
