"use client";

/**
 * Tarjeta de "Crea tu comunidad": imagen, copy y botón a /groups/new.
 *
 * Nace del bloque `createCommunitySection` del menú derecho de laptop
 * (WalletDesktopRail) para poder mostrar lo mismo en el OwnerSidebar de celular,
 * donde ese menú no existe. Mismo asset, mismas llaves de texto (namespace
 * `nav`) y mismo botón degradado.
 *
 * Es AUTOCONTENIDA a propósito: no hereda de `.railSection` ni de ninguna clase
 * del rail, así que se puede colocar en cualquier contenedor sin arrastrar el
 * layout del menú derecho.
 *
 * Diferencia deliberada con el rail: allá la imagen lleva un
 * `translateX(-35px)` para compensar el aire del asset dentro de la columna. Ese
 * empujón es específico de esa caja; aquí la imagen va centrada, porque en un
 * contenedor a lo ancho ese desplazamiento la dejaría descuadrada.
 */

import Image from "next/image";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { setNavSlideDir } from "@/lib/nav-slide";

export default function CreateCommunityCard({
  /** Ancho máximo de la imagen. */
  imageMaxWidth = 420,
}: {
  imageMaxWidth?: number;
}) {
  const tNav = useTranslations("nav");

  return (
    <section
      className="createCommunityCard"
      aria-label={tNav("createCommunityLabel")}
    >
      <style jsx>{`
        .createCommunityCard {
          display: grid;
          gap: 4px;
          justify-items: center;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        /* Los márgenes negativos recortan el aire propio del .webp, que trae
           bastante espacio muerto arriba y abajo. Son los mismos del rail. */
        .createCommunityCard :global(.createCommunityCardImage) {
          width: 100%;
          max-width: ${imageMaxWidth}px;
          height: auto;
          display: block;
          margin: -6px auto -14px;
          object-fit: contain;
        }

        .createCommunityCardCopy {
          margin-bottom: 6px;
          display: grid;
          gap: 2px;
          color: #fff;
          text-align: center;
          justify-items: center;
          font-family: inherit;
        }

        .createCommunityCardCopy strong {
          font-size: 16px;
          font-weight: 600;
          line-height: 1.08;
          letter-spacing: -0.02em;
        }

        .createCommunityCardCopy span {
          font-size: 12px;
          font-weight: 400;
          line-height: 1.28;
          color: rgba(255, 255, 255, 0.76);
        }

        .createCommunityCard :global(.createCommunityCardButton) {
          opacity: 0.85;
          /* Ancho ajustado al texto en vez de a la caja: "Crear comunidad" es
             bastante más largo en alemán o finés, y con un ancho fijo el texto
             se saldría de los 40px de alto (hay overflow: hidden). El mínimo
             evita que se encoja de más en idiomas de palabra corta. */
          width: fit-content;
          min-width: 215px;
          max-width: 100%;
          height: 40px;
          min-height: 40px;
          padding: 8px 34px;
          border-radius: 10px;
          border: none;
          background-image: linear-gradient(
            100deg,
            #ff2fb3 0%,
            #a855f7 35%,
            #4f46ff 70%,
            #ff2fb3 100%
          );
          background-size: 280% 280%;
          background-position: 0% 50%;
          color: #fff;
          font-size: 14px;
          font-weight: 600;
          letter-spacing: -0.01em;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 7px 18px rgba(168, 85, 255, 0.11);
          filter: saturate(0.84) brightness(0.93);
          overflow: hidden;
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
        }
      `}</style>

      <Image
        src="/Crear-comunidad.webp"
        alt=""
        width={280}
        height={187}
        className="createCommunityCardImage"
        aria-hidden="true"
      />

      <div className="createCommunityCardCopy">
        <strong>{tNav("createCommunityTitle")}</strong>
        <span>{tNav("createCommunitySubtitle")}</span>
      </div>

      <Link
        href="/groups/new"
        className="createCommunityCardButton"
        // Entra deslizando como el resto de la navegación, igual que el resto
        // de enlaces del sidebar.
        onClick={() => setNavSlideDir("right")}
      >
        {tNav("createCommunityButton")}
      </Link>
    </section>
  );
}
