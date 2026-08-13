"use client";

import { useEffect, useRef, useState } from "react";
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
  omitIcons,
  itemsLeft = false,
  active = true,
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
  /**
   * Esconde items del servicio por su icono, conservando los demás con su
   * traducción. Sirve para los que no aplican en el login, donde todavía no
   * hay un creador concreto detrás.
   */
  omitIcons?: readonly string[];
  /** Los items van a la IZQUIERDA. Se alterna bloque a bloque. */
  itemsLeft?: boolean;
  /**
   * El bloque es el visible. En laptop siempre lo es; en el carrusel de celular
   * lo pone el rail, y solo el activo reproduce su video —cinco videos a la vez
   * en un celular son batería y datos tirados.
   */
  active?: boolean;
}) {
  const services = Array.isArray(service) ? service : [service as ServiceKey];

  // Entrada al hacer scroll. Se dispara UNA vez, con el 22% del bloque a la
  // vista, y a partir de ahí el CSS encadena video → texto → items.
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [entered, setEntered] = useState(false);
  /** El bloque está a la vista AHORA (no como `entered`, que es de una sola vez). */
  const [inView, setInView] = useState(false);

  // Solo se reproduce el video del bloque visible. En laptop los cinco están en
  // la página, y cinco videos decodificando a la vez saturan al navegador: se
  // entrecortan y termina soltando alguno, que es justo el síntoma de "se traba
  // y de pronto ya no se reproduce".
  const playing = active && inView;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!playing) {
      v.pause();
      return;
    }
    // Puede rechazarse (política de reproducción del navegador); el póster
    // queda debajo, así que el círculo nunca se ve vacío.
    const kick = () => void v.play().catch(() => {});
    kick();
    // Red de seguridad del bucle: si el navegador deja el video en el último
    // frame en vez de reiniciarlo, se rebobina a mano. El video está grabado
    // para que el primer y el último frame coincidan, así que el corte no se ve.
    const onEnded = () => {
      v.currentTime = 0;
      kick();
    };
    // Y si se detiene por falta de datos o por ahorro de energía, se retoma.
    v.addEventListener("ended", onEnded);
    v.addEventListener("stalled", kick);
    v.addEventListener("suspend", kick);
    return () => {
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("stalled", kick);
      v.removeEventListener("suspend", kick);
    };
  }, [playing]);

  useEffect(() => {
    const node = sectionRef.current;
    // Sin observador (navegador viejo) el bloque se muestra tal cual: el estado
    // de partida es invisible, así que un fallo aquí escondería el contenido.
    if (!node || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setEntered(true);
          obs.disconnect();
        }
      },
      { threshold: 0.22 },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // Este NO se desconecta: sigue el ir y venir del bloque para prender y apagar
  // su video. Umbral bajo, para que ya esté andando cuando se alcance a ver.
  useEffect(() => {
    const node = sectionRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(id);
    }
    const obs = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), {
      threshold: 0.1,
    });
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className={`expBlock${itemsLeft ? " expBlockFlip" : ""}${entered ? " expBlockIn" : ""}`}
    >
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
          width: min(84%, 300px);
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

        /* ── Entrada ──────────────────────────────────────────────────────
           Estado de partida de cada pieza. La clase .expBlockIn (la pone el
           observador al entrar el bloque) las lleva a su sitio; los retrasos
           son lo que arma la secuencia video → texto → items, poco más de un
           segundo en total. La curva es de salida rápida y frenado largo, que
           es lo que hace que se sienta un movimiento y no un parpadeo. */
        .expBlockMedia {
          opacity: 0;
          transform: translateY(20px) scale(0.92);
          transition:
            opacity 700ms ease,
            transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .expBlockIn .expBlockMedia {
          opacity: 1;
          transform: none;
        }

        .expBlockEyebrow,
        .expBlockTitle,
        .expBlockDesc {
          opacity: 0;
          transform: translateY(24px);
          transition:
            opacity 600ms ease 120ms,
            transform 600ms cubic-bezier(0.22, 1, 0.36, 1) 120ms;
        }
        .expBlockIn .expBlockEyebrow,
        .expBlockIn .expBlockTitle,
        .expBlockIn .expBlockDesc {
          opacity: 1;
          transform: none;
        }

        /* Los items entran DESDE SU LADO —de la izquierda si están a la
           izquierda— para que el movimiento acompañe al alternado en vez de
           contradecirlo. Los selectores llegan a las filas que arma
           ServiceFeaturePreview (mosaico > fila). */
        .expBlockItems > :global(div) > :global(div) {
          opacity: 0;
          transform: translateX(20px);
          transition:
            opacity 520ms ease,
            transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .expBlockFlip .expBlockItems > :global(div) > :global(div) {
          transform: translateX(-20px);
        }
        .expBlockIn .expBlockItems > :global(div) > :global(div) {
          opacity: 1;
          transform: none;
        }

        /* Uno por uno, 100 ms de separación, arrancando cuando el texto ya va
           en camino. */
        .expBlockItems > :global(div) > :global(div):nth-child(1) {
          transition-delay: 260ms;
        }
        .expBlockItems > :global(div) > :global(div):nth-child(2) {
          transition-delay: 360ms;
        }
        .expBlockItems > :global(div) > :global(div):nth-child(3) {
          transition-delay: 460ms;
        }
        .expBlockItems > :global(div) > :global(div):nth-child(4) {
          transition-delay: 560ms;
        }
        .expBlockItems > :global(div) > :global(div):nth-child(5) {
          transition-delay: 660ms;
        }
        .expBlockItems > :global(div) > :global(div):nth-child(6) {
          transition-delay: 760ms;
        }

        @media (prefers-reduced-motion: reduce) {
          .expBlockMedia video {
            visibility: hidden;
          }
          /* Quien pidió menos movimiento ve el bloque puesto, sin recorrido. */
          .expBlockMedia,
          .expBlockEyebrow,
          .expBlockTitle,
          .expBlockDesc,
          .expBlockItems > :global(div) > :global(div) {
            opacity: 1;
            transform: none;
            transition: none;
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
            ref={videoRef}
            // El video NO se descarga hasta que el bloque se ve por primera
            // vez. Con cinco cards en la página, cargarlos todos de entrada
            // satura la red y el que estás mirando se entrecorta.
            src={entered ? videoSrc : undefined}
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            // El clip entero, no solo su cabecera: son unos segundos en bucle y
            // con "metadata" el navegador vuelve a pedir datos en cada vuelta,
            // que es de donde salen los tirones en la costura del bucle.
            preload="auto"
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
            omitIcons={omitIcons}
            columns={1}
            // Sobre negro puro, el 42% de blanco por defecto casi no se lee.
            descColor="rgba(255,255,255,0.78)"
          />
        ))}
      </div>
    </section>
  );
}
