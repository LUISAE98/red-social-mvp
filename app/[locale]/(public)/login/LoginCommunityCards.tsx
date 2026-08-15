"use client";

import { useInView } from "./useInView";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import { useCarouselRail, type CarouselInfo } from "./useCarouselRail";

/**
 * Los tres tipos de comunidad, debajo del título de los 150 países.
 *
 * En laptop van en una fila de tres. En celular son un CARRUSEL con el mismo
 * comportamiento que las tarjetas de experiencias —una por vista, se acomoda
 * sola al soltar, avanza cada 5 s hasta que la tocas y lleva sus puntos—,
 * porque comparten `useCarouselRail`.
 *
 * Ahí las tarjetas se ven más grandes que en laptop: no hay nada a los lados
 * que compita, así que el margen es lo único que las contiene.
 */

const TARJETAS = [
  {
    imagen: "/comunidadpublica.webp",
    etiqueta: "Comunidad pública",
    titulo: "Abierta para descubrir y conectar",
    texto:
      "Cualquiera puede encontrarla, explorar lo que comparte y unirse a la conversación. Ideal para hacer crecer una audiencia, reunir personas con los mismos intereses y convertir cada publicación en una nueva oportunidad de conectar.",
  },
  {
    imagen: "/comunidadprivada.webp",
    etiqueta: "Comunidad privada",
    titulo: "Un espacio reservado para quienes forman parte",
    texto:
      "La comunidad puede descubrirse, pero su contenido y experiencias quedan exclusivamente para sus miembros. Perfecta para compartir con mayor cercanía, cuidar cada interacción y crear un verdadero sentido de pertenencia.",
  },
  {
    imagen: "/comunidadoculta.webp",
    etiqueta: "Comunidad oculta",
    titulo: "Solo entra quien recibe la invitación",
    texto:
      "No aparece en búsquedas ni puede descubrirse públicamente. Es un espacio discreto y exclusivo para grupos seleccionados, conversaciones especiales o comunidades que prefieren crecer únicamente entre personas invitadas.",
  },
] as const;

export default function LoginCommunityCards() {
  // Aquí no hace falta `active` ni `isMobile`: no hay video que pausar y las
  // tres tarjetas se pintan igual estén o no a la vista.
  const { setRail, carousel } = useCarouselRail(TARJETAS.length);

  // Entrada al aparecer la sección, igual que los bloques de arriba: se rehace
  // cada vez que vuelve a la vista.
  const [seccionRef, dentro] = useInView<HTMLDivElement>(0.15);

  return (
    <div ref={seccionRef} className={`commWrap${dentro ? " commIn" : ""}`}>
      <style jsx>{`
        .commWrap {
          width: 100%;
        }

        /* Laptop: fila de tres. */
        .commCards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 40px;
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
          /* Mucho aire arriba: con poco, el título de los 150 países se leía
             como el encabezado de las comunidades y no como el cierre de las
             experiencias, que es lo que es. */
          padding: 96px 20px 40px;
          box-sizing: border-box;
        }

        /* Sin caja: ni fondo, ni borde, ni relleno. Cada bloque es la imagen y
           su texto sueltos sobre el negro de la página.
           El tope de ancho es lo que las separa de verdad en laptop: la columna
           sigue midiendo lo mismo y el sobrante se reparte a los lados. */
        .commCard {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          min-width: 0;
          max-width: 250px;
          margin: 0 auto;
        }

        /* Cuadradas, como las imágenes que las alimentan. La proporción fija
           hace que las tres midan igual aunque los archivos vengan distintos. */
        .commCardImg {
          position: relative;
          width: 100%;
          aspect-ratio: 1 / 1;
          border-radius: 22px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
        }

        .commCardImg img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .commCardLabel {
          margin: 16px 0 0;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          line-height: 1.2;
        }

        .commCardTitle {
          margin: 8px 0 0;
          font-size: 15.5px;
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.02em;
          color: #ffffff;
        }

        .commCardText {
          margin: 9px 0 0;
          font-size: 12.5px;
          line-height: 1.6;
          color: rgba(255, 255, 255, 0.72);
        }

        /* Entrada: misma curva y mismo lenguaje que los bloques de arriba. */
        .commCard {
          opacity: 0;
          transform: translateY(20px);
          transition:
            opacity 560ms ease,
            transform 560ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .commIn .commCard {
          opacity: 1;
          transform: none;
        }
        .commIn .commCard:nth-child(1) {
          transition-delay: 60ms;
        }
        .commIn .commCard:nth-child(2) {
          transition-delay: 160ms;
        }
        .commIn .commCard:nth-child(3) {
          transition-delay: 260ms;
        }

        @media (max-width: 900px) {
          /* Celular: carrusel de una por vista, igual que las experiencias. Sin
             touch-action ni listeners de gesto: el navegador ya distingue el
             desplazamiento vertical de la página del horizontal del rail. */
          .commCards {
            display: flex;
            flex-direction: row;
            gap: 12px;
            max-width: none;
            padding: 64px 0 32px;
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            overscroll-behavior-x: contain;
            scrollbar-width: none;
          }
          .commCards::-webkit-scrollbar {
            display: none;
          }

          /* La tarjeta ocupa el ancho completo —el texto respira hasta los 30px
             de margen—, pero la IMAGEN se queda en su tamaño de laptop. */
          .commCard {
            flex: 0 0 100%;
            max-width: none;
            margin: 0;
            padding: 0 30px;
            box-sizing: border-box;
            scroll-snap-align: center;
          }

          .commCardImg {
            max-width: 250px;
          }

          /* En el carrusel entran todas a la vez —solo se ve una— así que no
             tiene sentido escalonarlas. */
          .commIn .commCard:nth-child(1),
          .commIn .commCard:nth-child(2),
          .commIn .commCard:nth-child(3) {
            transition-delay: 60ms;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .commCard {
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
      `}</style>

      <div className="commCards" ref={setRail}>
        {TARJETAS.map((c) => (
          <article key={c.titulo} className="commCard">
            <div className="commCardImg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.imagen} alt="" loading="lazy" />
            </div>

            {/* Puntos del carrusel, debajo de la imagen y dentro de la tarjeta,
                igual que en las experiencias. Solo en celular: en laptop se ven
                las tres a la vez y no hay nada que indicar. */}
            {carousel && <Dots carousel={carousel} />}

            {/* El CSS pone el nombre en mayúsculas, así el texto se escribe
                normal y cada idioma lo acentúa como debe. */}
            <p className="commCardLabel">
              <VibraGradientText>{c.etiqueta}</VibraGradientText>
            </p>

            <h3 className="commCardTitle">{c.titulo}</h3>
            <p className="commCardText">{c.texto}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function Dots({ carousel }: { carousel: CarouselInfo }) {
  return (
    <div className="commDots">
      <style jsx>{`
        .commDots {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 7px;
          margin: 18px 0 0;
        }
      `}</style>
      {Array.from({ length: carousel.count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => carousel.onSelect(i)}
          aria-label={`Ir a la comunidad ${i + 1}`}
          aria-current={i === carousel.current ? "true" : undefined}
          style={{
            width: i === carousel.current ? 18 : 6,
            height: 6,
            padding: 0,
            border: "none",
            borderRadius: 999,
            background: i === carousel.current ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)",
            transition: "width 260ms ease, background 260ms ease",
            cursor: "pointer",
          }}
        />
      ))}
    </div>
  );
}
