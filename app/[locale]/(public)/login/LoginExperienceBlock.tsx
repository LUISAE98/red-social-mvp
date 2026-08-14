"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";

/**
 * Un bloque de experiencia del login (debajo del fold).
 *
 * En laptop ocupa una FILA completa partida en dos mitades: de un lado el video
 * circular con el antetítulo y el título, del otro la descripción. El lado se
 * ALTERNA fila tras fila (`itemsLeft`), que es lo que le da ritmo a la lectura
 * en vez de una columna monótona.
 *
 * En celular se apila en el mismo orden del HTML —video, puntos, antetítulo,
 * título, descripción—, así que el cambio de mitades no lo afecta.
 */

export default function LoginExperienceBlock({
  eyebrow,
  title,
  description,
  videoSrc,
  accentColor,
  itemsLeft = false,
  active = true,
  carousel = null,
}: {
  /** Antetítulo. El CSS lo pinta en MAYÚSCULAS. */
  eyebrow: string;
  title: string;
  description: string;
  /** ⚠️ Hoy son videos de MUESTRA; se cambian por los definitivos más adelante. */
  videoSrc: string;
  accentColor: string;
  /**
   * La DESCRIPCIÓN va a la izquierda y la presentación a la derecha. Se alterna
   * bloque a bloque. (El nombre viene de cuando esa mitad llevaba una lista de
   * items; se conserva para no tocar los cinco llamados.)
   */
  itemsLeft?: boolean;
  /**
   * El bloque es el visible. En laptop siempre lo es; en el carrusel de celular
   * lo pone el rail, y solo el activo reproduce su video —cinco videos a la vez
   * en un celular son batería y datos tirados.
   */
  active?: boolean;
  /**
   * Presente solo cuando el bloque es una tarjeta del carrusel de celular. Trae
   * los puntos indicadores —que se pintan debajo del círculo, dentro de la
   * tarjeta— y hace que la entrada se repita cada vez que la tarjeta pasa a ser
   * la activa, incluso si ya se había visto.
   */
  carousel?: { count: number; current: number; onSelect: (i: number) => void } | null;
}) {
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
  //
  // Con movimiento reducido se queda quieto en su primer frame en vez de
  // esconderse: ya no hay foto debajo que pudiera ocupar su lugar.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const playing = active && inView && !reduceMotion;

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

    // NO se arranca en cuanto el bloque aparece, sino cuando hay video
    // suficiente por delante. Arrancar antes es lo que producía los tirones del
    // primer card: empezaba a reproducir mientras todavía se estaba
    // descargando, y encima compitiendo con la carga de la página. Los de más
    // abajo iban finos porque para entonces el archivo ya estaba en caché.
    // Mientras tanto se ve la portada, así que la espera no se nota.
    // 3 = HAVE_FUTURE_DATA.
    if (v.readyState >= 3) kick();
    else v.addEventListener("canplay", kick);

    // Red de seguridad del bucle: si el navegador deja el video en el último
    // frame en vez de reiniciarlo, se rebobina a mano. El video está grabado
    // para que el primer y el último frame coincidan, así que el corte no se ve.
    const onEnded = () => {
      v.currentTime = 0;
      kick();
    };
    v.addEventListener("ended", onEnded);
    // Si se queda sin datos a mitad, se retoma cuando vuelva a haberlos.
    v.addEventListener("stalled", kick);
    return () => {
      v.removeEventListener("canplay", kick);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("stalled", kick);
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
      className={`expBlock${itemsLeft ? " expBlockFlip" : ""}${
        // En el carrusel la entrada se ata a "ser la tarjeta activa", así que se
        // rehace en cada cambio, también al volver a una ya vista. Apilados en
        // laptop se hace una sola vez, al aparecer: ahí repetirla en cada scroll
        // sería mareante.
        (carousel ? active : entered) ? " expBlockIn" : ""
      }`}
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

        /* Alternado: la descripción pasa a la primera columna. Se hace con la
           propiedad order y no reordenando el HTML, para que el lector de
           pantalla siga leyendo antes la presentación que su descripción. */
        .expBlockFlip .expBlockMain {
          order: 2;
        }
        .expBlockFlip .expBlockAside {
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

        .expBlockDots {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 7px;
          margin: 16px 0 0;
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

        /* La mitad de la descripción. Centrada en su columna, con el texto
           centrado igual que la presentación de enfrente. */
        .expBlockAside {
          display: flex;
          justify-content: center;
          min-width: 0;
        }

        .expBlockDesc {
          margin: 0;
          max-width: 44ch;
          font-size: clamp(12.5px, 0.92vw, 14px);
          line-height: 1.65;
          text-align: center;
          color: rgba(255, 255, 255, 0.86);
        }

        /* Celular: una sola columna, y la descripción SIEMPRE debajo del
           título, sin importar el alternado. */
        @media (max-width: 900px) {
          .expBlock {
            grid-template-columns: 1fr;
            gap: 4px;
            padding: 24px 20px;
          }
          .expBlockFlip .expBlockMain,
          .expBlockFlip .expBlockAside {
            order: initial;
          }
          .expBlockAside {
            margin-top: 13px;
          }
        }

        /* ── Entrada ──────────────────────────────────────────────────────
           Estado de partida de cada pieza. La clase .expBlockIn (la pone el
           observador al entrar el bloque) las lleva a su sitio; el retraso del
           texto es lo que arma la secuencia video → texto. La curva es de
           salida rápida y frenado largo, que es lo que hace que se sienta un
           movimiento y no un parpadeo. */
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

        @media (prefers-reduced-motion: reduce) {
          /* Quien pidió menos movimiento ve el bloque puesto, sin recorrido. */
          .expBlockMedia,
          .expBlockEyebrow,
          .expBlockTitle,
          .expBlockDesc {
            opacity: 1;
            transform: none;
            transition: none;
          }
        }
      `}</style>

      <div className="expBlockMain">
        {/* Sin aro, resplandor ni imagen de respaldo: el disco se recorta limpio
            contra el negro. La foto que había debajo era de otra toma, así que
            al arrancar el video saltaba de una imagen a otra; ahora el círculo
            va en negro hasta que hay video, y los primeros ya vienen cargados
            desde el splash. */}
        <div className="expBlockMedia">
          <video
            ref={videoRef}
            // El video NO se descarga hasta que el bloque se ve por primera
            // vez. Con cinco cards en la página, cargarlos todos de entrada
            // satura la red y el que estás mirando se entrecorta. (Los que ya
            // trae precargados el splash llegan aquí como copia en memoria.)
            src={entered ? videoSrc : undefined}
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

        {/* Puntos del carrusel, justo debajo del círculo. Van dentro de la
            tarjeta —y no en el rail— para que queden pegados al video; como en
            celular solo se ve una tarjeta, nunca se perciben repetidos. Fuera
            del bloque de la animación de entrada a propósito: son navegación y
            deben quedarse quietos. */}
        {carousel && (
          <div className="expBlockDots">
            {Array.from({ length: carousel.count }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => carousel.onSelect(i)}
                aria-label={`Ir a la experiencia ${i + 1}`}
                aria-current={i === carousel.current ? "true" : undefined}
                style={{
                  width: i === carousel.current ? 18 : 6,
                  height: 6,
                  padding: 0,
                  border: "none",
                  borderRadius: 999,
                  background:
                    i === carousel.current ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.28)",
                  transition: "width 260ms ease, background 260ms ease",
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        )}

        {/* El antetítulo se pinta en mayúsculas desde el CSS. */}
        <p className="expBlockEyebrow" style={{ color: accentColor }}>
          {eyebrow}
        </p>

        <h2 className="expBlockTitle">{title}</h2>
      </div>

      {/* La descripción ocupa la otra mitad. Va DESPUÉS en el HTML, así que al
          apilarse en celular cae justo debajo del título, como estaba. */}
      <div className="expBlockAside">
        <p className="expBlockDesc">{description}</p>
      </div>
    </section>
  );
}
