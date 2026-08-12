"use client";

import type React from "react";
import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";

/**
 * Un bloque de experiencia del login (debajo del fold): video circular,
 * antetítulo, título, descripción y los items del servicio.
 *
 * Es genérico a propósito. Ya hay dos bloques con la misma estructura —saludos y
 * encuentros— y vendrán más; tenerlos en un solo componente evita repetir 120
 * líneas de CSS por cada experiencia y garantiza que el ritmo vertical sea
 * idéntico en todos.
 *
 * Se desarrolla PRIMERO en laptop; el acomodo fino de celular es un paso aparte.
 */

/**
 * Servicios que hoy tienen bloque propio en el login. Es un subconjunto de los
 * que acepta ServiceFeaturePreview: se amplía conforme se sumen experiencias.
 */
type ServiceKey =
  | "saludo"
  | "consejo"
  | "meetGreet"
  | "customClass"
  | "profileDonation"
  | "liveDonation"
  | "liveAccess"
  | "vodUnlock"
  | "superComments"
  | "premiumPost"
  | "subscription";

export default function LoginExperienceBlock({
  eyebrow,
  title,
  description,
  videoSrc,
  poster,
  service,
  accentColor,
  wide = false,
}: {
  /** Antetítulo. El CSS lo pinta en MAYÚSCULAS. */
  eyebrow: string;
  title: string;
  description: string;
  /** ⚠️ Hoy son videos de MUESTRA; se cambian por los definitivos más adelante. */
  videoSrc: string;
  /** Imagen del primer frame: el círculo se ve bien aunque el video tarde o falle. */
  poster: string;
  /**
   * Servicio(s) de los que se listan los items (reutiliza ServiceFeaturePreview).
   * Con varios, un solo bloque cubre varias experiencias emparentadas y sus
   * items se reparten en columnas.
   */
  service: ServiceKey | readonly ServiceKey[];
  accentColor: string;
  /**
   * Ocupa la fila COMPLETA de la rejilla en vez de una columna. Para las
   * experiencias que se cuentan juntas y necesitan más aire que un tercio.
   */
  wide?: boolean;
}) {
  const services = Array.isArray(service) ? service : [service as ServiceKey];

  return (
    <section className={wide ? "expBlock expBlockWide" : "expBlock"}>
      <style jsx>{`
        /* Es una COLUMNA de la fila de experiencias: no fija ancho ni se centra a
           sí misma — de eso se encarga la rejilla del padre (.loginExpGrid). */
        .expBlock {
          width: 100%;
          min-width: 0;
          padding: 8px 12px 24px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          box-sizing: border-box;
        }

        /* El círculo: el video se recorta en un disco perfecto (aspect-ratio 1
           + object-fit: cover), con un aro tenue que lo despega del negro. */
        /* El círculo se mide contra SU COLUMNA, no contra la ventana: así los
           tres quedan iguales sin importar el ancho de la rejilla. */
        .expBlockMedia {
          position: relative;
          width: min(74%, 190px);
          aspect-ratio: 1 / 1;
          border-radius: 50%;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.06);
        }

        .expBlockMedia video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .expBlockEyebrow {
          margin: 21px 0 0;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .expBlockTitle {
          margin: 8px 0 0;
          font-size: clamp(17.5px, 1.75vw, 24px);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.15;
          color: #ffffff;
          max-width: 20ch;
        }

        .expBlockBody {
          width: 100%;
        }

        .expBlockDesc {
          margin: 13px auto 0;
          max-width: 54ch;
          font-size: clamp(11.5px, 0.84vw, 13px);
          line-height: 1.65;
          color: rgba(255, 255, 255, 0.62);
        }

        /* Items de la experiencia. Se reutiliza ServiceFeaturePreview, que ya
           trae iconos y textos —y su variante en voz de FAN—, para que el login
           diga lo mismo que la tarjeta del creador y no haya dos copys que
           mantener. El zoom los encoge al mismo 80% que el resto del bloque,
           porque sus tamaños viven en estilos inline dentro de ese componente. */
        .expBlockItems {
          margin: 18px auto 0;
          text-align: left;
          zoom: 0.8;
        }

        /* Bloque ANCHO: ocupa la fila entera. El texto se mantiene estrecho para
           que siga siendo legible, y los items se reparten en tantas columnas
           como servicios traiga. */
        .expBlockWide {
          grid-column: 1 / -1;
          padding-top: 26px;
        }

        .expBlockWide .expBlockBody {
          max-width: 100%;
        }

        .expBlockWide .expBlockItems {
          display: grid;
          grid-template-columns: repeat(var(--exp-cols, 1), minmax(0, 1fr));
          gap: 0 28px;
          max-width: 860px;
        }

        @media (max-width: 900px) {
          .expBlockWide .expBlockItems {
            grid-template-columns: 1fr;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .expBlockMedia video {
            visibility: hidden;
          }
        }
      `}</style>

      <div
        className="expBlockMedia"
        style={{
          boxShadow: `0 0 0 1px rgba(255,255,255,0.1), 0 24px 60px ${accentColor}2e`,
          // Póster de respaldo: si el video no se ve (movimiento reducido o
          // error de carga), el círculo sigue teniendo imagen.
          backgroundImage: `url(${poster})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <video
          src={videoSrc}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
        />
      </div>

      <p className="expBlockEyebrow" style={{ color: accentColor }}>
        {eyebrow}
      </p>

      <h2 className="expBlockTitle">{title}</h2>

      <div className="expBlockBody">
        <p className="expBlockDesc">{description}</p>

        <div
          className="expBlockItems"
          style={{ "--exp-cols": services.length } as React.CSSProperties}
        >
          {services.map((s) => (
            <ServiceFeaturePreview
              key={s}
              service={s}
              accentColor={accentColor}
              audience="user"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
