"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Los tres tipos de comunidad, debajo del título de los 150 países.
 *
 * En laptop van en una fila de tres; en celular se apilan. Entran como los
 * bloques de experiencias —opacidad y un recorrido corto— y la entrada se
 * rehace cada vez que la sección vuelve a la vista.
 *
 * ⚠️ Las imágenes son de PRUEBA (archivos que ya existen en `public/`). Se
 * cambian por las definitivas cuando estén.
 */

const TARJETAS = [
  {
    imagen: "/creadores.webp",
    titulo: "Abierta para descubrir y conectar",
    texto:
      "Cualquiera puede encontrarla, explorar lo que comparte y unirse a la conversación. Ideal para hacer crecer una audiencia, reunir personas con los mismos intereses y convertir cada publicación en una nueva oportunidad de conectar.",
  },
  {
    imagen: "/desbloquearcontenido.webp",
    titulo: "Un espacio reservado para quienes forman parte",
    texto:
      "La comunidad puede descubrirse, pero su contenido y experiencias quedan exclusivamente para sus miembros. Perfecta para compartir con mayor cercanía, cuidar cada interacción y crear un verdadero sentido de pertenencia.",
  },
  {
    imagen: "/encuentroenvivo.webp",
    titulo: "Solo entra quien recibe la invitación",
    texto:
      "No aparece en búsquedas ni puede descubrirse públicamente. Es un espacio discreto y exclusivo para grupos seleccionados, conversaciones especiales o comunidades que prefieren crecer únicamente entre personas invitadas.",
  },
] as const;

export default function LoginCommunityCards() {
  const seccionRef = useRef<HTMLDivElement | null>(null);
  const [dentro, setDentro] = useState(false);

  useEffect(() => {
    const node = seccionRef.current;
    // Sin observador el contenido se muestra tal cual: el estado de partida es
    // invisible, así que un fallo aquí lo escondería para siempre.
    if (!node || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setDentro(true));
      return () => cancelAnimationFrame(id);
    }
    const obs = new IntersectionObserver(
      (entries) => {
        const ratio = Math.max(...entries.map((e) => (e.isIntersecting ? e.intersectionRatio : 0)));
        setDentro(ratio >= 0.15);
      },
      { threshold: [0, 0.15, 0.5] },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={seccionRef} className={`commCards${dentro ? " commIn" : ""}`}>
      <style jsx>{`
        .commCards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 20px;
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
          padding: 26px 20px 40px;
          box-sizing: border-box;
        }

        .commCard {
          display: flex;
          flex-direction: column;
          min-width: 0;
          border-radius: 18px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
        }

        /* Relación fija para que las tres imágenes midan igual aunque los
           archivos definitivos vengan con proporciones distintas. */
        .commCardImg {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 10;
          background: rgba(255, 255, 255, 0.06);
        }

        .commCardImg img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .commCardBody {
          padding: 16px 18px 20px;
        }

        .commCardTitle {
          margin: 0;
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

        /* Entrada: misma curva y mismo lenguaje que los bloques de arriba, con
           las tres tarjetas escalonadas. */
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
          .commCards {
            grid-template-columns: 1fr;
            gap: 16px;
            max-width: 460px;
            padding: 18px 20px 32px;
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

      {TARJETAS.map((c) => (
        <article key={c.titulo} className="commCard">
          <div className="commCardImg">
            {/* Imagen de prueba: decorativa, sin texto alternativo. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.imagen} alt="" loading="lazy" />
          </div>
          <div className="commCardBody">
            <h3 className="commCardTitle">{c.titulo}</h3>
            <p className="commCardText">{c.texto}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
