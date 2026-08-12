"use client";

import ServiceFeaturePreview from "@/components/services/ServiceFeaturePreview";

/**
 * Un bloque de experiencia del login (debajo del fold).
 *
 * En laptop ocupa una FILA completa partida en dos mitades: de un lado el video
 * circular con el título y la descripción, del otro los items. El lado de los
 * items se ALTERNA fila tras fila (`itemsLeft`), que es lo que le da ritmo a la
 * lectura en vez de una columna monótona.
 *
 * En celular se apila todo; el acomodo fino de móvil es un paso aparte.
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
  items,
  itemsLeft = false,
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
   * listas se apilan una tras otra.
   */
  service: ServiceKey | readonly ServiceKey[];
  accentColor: string;
  /**
   * Items propios en vez de los del servicio. Necesario cuando una card cubre
   * varias experiencias: los textos de ServiceFeaturePreview hablan de una
   * sola ("recibes un saludo…") y aquí tienen que abarcar todas.
   * Solo aplica con UN servicio; con varios, cada uno trae los suyos.
   */
  items?: readonly { icon: string; title: string; description: string }[];
  /** Los items van a la IZQUIERDA. Se alterna bloque a bloque. */
  itemsLeft?: boolean;
}) {
  const services = Array.isArray(service) ? service : [service as ServiceKey];

  return (
    <section className={itemsLeft ? "expBlock expBlockFlip" : "expBlock"}>
      <style jsx>{`
        /* Una fila = dos mitades. Las dos con minmax(0, 1fr) para que ninguna se
           ensanche por su contenido y las filas queden alineadas entre sí. */
        .expBlock {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          align-items: center;
          gap: 48px;
          width: 100%;
          max-width: 1080px;
          margin: 0 auto;
          padding: 30px 20px;
          box-sizing: border-box;
        }

        /* Alternado: los items pasan a la primera columna. Se hace con la
           propiedad order y no reordenando el HTML, para que el lector de
           pantalla siga leyendo antes la presentación que su lista. */
        .expBlockFlip .expBlockMain {
          order: 2;
        }
        .expBlockFlip .expBlockItems {
          order: 1;
        }

        .expBlockMain {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          min-width: 0;
        }

        /* El círculo se mide contra SU MITAD, no contra la ventana. */
        .expBlockMedia {
          position: relative;
          width: min(70%, 250px);
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
          margin: 22px 0 0;
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

        .expBlockDesc {
          margin: 13px auto 0;
          max-width: 44ch;
          font-size: clamp(12.5px, 0.92vw, 14px);
          line-height: 1.65;
          color: rgba(255, 255, 255, 0.86);
        }

        /* Items. Se reutiliza ServiceFeaturePreview, que ya trae iconos y textos
           —y su variante en voz de FAN—, para que el login diga lo mismo que la
           tarjeta del creador y no haya dos copys que mantener.
           El zoom los AGRANDA: sus tamaños (11px el título, 10px la descripción)
           están pensados para las tarjetas del creador y aquí se leían chicos. */
        .expBlockItems {
          text-align: left;
          min-width: 0;
          zoom: 1.3;
        }

        /* Con varios servicios, sus listas se apilan con aire entre ellas. */
        .expBlockItems > :global(div) + :global(div) {
          margin-top: 14px;
        }

        /* Celular: una sola columna y los items SIEMPRE debajo, sin importar el
           alternado. (El acomodo fino de móvil se hace aparte.) */
        @media (max-width: 900px) {
          .expBlock {
            grid-template-columns: 1fr;
            gap: 4px;
            padding: 24px 20px;
          }
          .expBlockFlip .expBlockMain,
          .expBlockFlip .expBlockItems {
            order: initial;
          }
          .expBlockItems {
            margin-top: 18px;
            max-width: 420px;
            margin-left: auto;
            margin-right: auto;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .expBlockMedia video {
            visibility: hidden;
          }
        }
      `}</style>

      <div className="expBlockMain">
        <div
          className="expBlockMedia"
          style={{
            // Sin aro ni resplandor: el disco se recorta limpio contra el negro.
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

        {/* El antetítulo se pinta en mayúsculas desde el CSS. */}
        <p className="expBlockEyebrow" style={{ color: accentColor }}>
          {eyebrow}
        </p>

        <h2 className="expBlockTitle">{title}</h2>

        <p className="expBlockDesc">{description}</p>
      </div>

      <div className="expBlockItems">
        {services.map((s) => (
          <ServiceFeaturePreview
            key={s}
            service={s}
            accentColor={accentColor}
            audience="user"
            cells={services.length === 1 ? items : undefined}
            columns={1}
            // Sobre negro puro, el 42% de blanco por defecto casi no se lee.
            descColor="rgba(255,255,255,0.78)"
          />
        ))}
      </div>
    </section>
  );
}
