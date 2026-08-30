"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import { useCreatorNetRate } from "@/lib/wallet/useCreatorNetRate";
import { useInView } from "./useInView";

/**
 * Preguntas frecuentes del panel de creador, al cierre del login.
 *
 * Acordeón de una sola pregunta abierta a la vez: con varias abiertas la lista
 * se estira tanto que la siguiente pregunta queda fuera de la pantalla y deja de
 * verse como una lista.
 *
 * ⚠️ Las respuestas de cobro, requisitos y facturación describen cómo QUEREMOS
 * que funcione; el alta de cuenta para retirar todavía no está conectada (se fue
 * con Didit y su reemplazo en Stripe está pendiente). Antes de publicar esta
 * página conviene revisarlas con quien lleve lo fiscal y lo legal.
 */



/** Las nueve preguntas viven en `messages` como faq1Q…faq9A. */
const NUMEROS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export default function LoginFaq() {
  // La comisión que le toca a quien está leyendo, según su país. Ver `LoginCreatorPanel`.
  const { commissionRate } = useCreatorNetRate();
  const COMISION_PCT = Math.round(commissionRate * 100);
  const t = useTranslations("loginLanding");
  const [abierta, setAbierta] = useState<number | null>(null);
  const [seccionRef, dentro] = useInView<HTMLElement>(0.12);

  // Pregunta y respuesta de cada número. La única que lleva dato es la de la
  // comisión, que lo toma de la constante del ledger.
  const preguntas = NUMEROS.map((n) => ({
    p: t(`faq${n}Q`),
    r: n === 7 ? t("faq7A", { commission: COMISION_PCT }) : t(`faq${n}A`),
  }));

  return (
    <section ref={seccionRef} className={`faq${dentro ? " faqIn" : ""}`}>
      <style jsx>{`
        .faq {
          width: 100%;
          max-width: 760px;
          margin: 0 auto;
          padding: 96px 20px 12px;
          box-sizing: border-box;
          opacity: 0;
          transform: translateY(22px);
          transition:
            opacity 620ms ease,
            transform 620ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .faqIn {
          opacity: 1;
          transform: none;
        }

        .eyebrow {
          margin: 0;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          text-align: center;
        }

        .title {
          margin: 10px 0 30px;
          font-size: clamp(22px, 2.6vw, 32px);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.12;
          text-align: center;
          color: #ffffff;
        }

        .item {
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .item:last-child {
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .q {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 4px;
          border: none;
          background: transparent;
          color: #ffffff;
          font-family: inherit;
          font-size: 14.5px;
          font-weight: 600;
          letter-spacing: -0.01em;
          line-height: 1.35;
          text-align: start;
          cursor: pointer;
        }

        /* El degradado de marca al pasar el cursor y mientras la pregunta está
           abierta. Va en el TEXTO y no en el botón: el degradado se aplica
           recortando el fondo contra las letras, y eso vuelve transparente todo
           lo que haya dentro, incluida la flecha. */
        .qText {
          min-width: 0;
          transition: color 180ms ease;
        }
        /* Al TOCAR (celular) y mientras está abierta. El degradado se declara
           una vez en una variable y se aplica igual en los dos casos y en el
           del cursor, que vive aparte por vivir dentro de su media query. */
        .q {
          --degradadoVibra: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
        }
        .q:active .qText,
        .qOpen .qText {
          background: var(--degradadoVibra);
          background-size: 220% 220%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: vibraTextFlow 4.5s ease-in-out infinite;
        }

        /* Con cursor, además, al pasar por encima. Va detrás de (hover: hover)
           porque en pantallas táctiles el :hover se queda pegado después de
           tocar y dejaría preguntas cerradas con el degradado puesto. */
        @media (hover: hover) and (pointer: fine) {
          .q:hover .qText {
            background: var(--degradadoVibra);
            background-size: 220% 220%;
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            animation: vibraTextFlow 4.5s ease-in-out infinite;
          }
          .q:hover .chevron {
            color: #c084fc;
          }
        }
        @keyframes vibraTextFlow {
          0%,
          100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        .q:active .chevron {
          color: #c084fc;
        }

        .chevron {
          flex-shrink: 0;
          color: rgba(255, 255, 255, 0.5);
          transition:
            transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
            color 180ms ease;
        }
        .chevronOpen {
          transform: rotate(180deg);
          color: #c084fc;
        }

        /* Despliegue suave hasta la altura que necesite el texto. Con grid de
           0fr a 1fr la transición funciona sin tener que medir el contenido ni
           inventar un max-height que se quede corto en los idiomas largos. */
        .panel {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 320ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .panelOpen {
          grid-template-rows: 1fr;
        }
        .panelInner {
          overflow: hidden;
        }
        /* Sin tope de ancho: la respuesta usa todo el contenedor, igual que la
           pregunta de arriba. El límite de caracteres por línea lo pone ya el
           ancho de la sección. */
        .a {
          margin: 0;
          padding: 0 4px 20px;
          font-size: 13px;
          line-height: 1.7;
          color: rgba(255, 255, 255, 0.68);
        }

        @media (max-width: 900px) {
          /* De lado a lado con un margen mínimo. El margen negativo recupera el
             relleno del panel que lo contiene, y el ancho pasa a AUTO para que
             ese espacio se convierta en anchura: con el 100% fijo de la regla
             base, el bloque conservaba su medida y el margen solo lo corría
             hacia la izquierda. */
          .faq {
            width: auto;
            max-width: none;
            margin-inline: -20px;
            padding: 64px 16px 8px;
          }
          .q {
            font-size: 13.5px;
            padding: 16px 2px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .faq {
            opacity: 1;
            transform: none;
            transition: none;
          }
          .panel,
          .chevron {
            transition: none;
          }
          /* El degradado se queda quieto, pero conserva sus colores. */
          .q:hover .qText,
          .q:active .qText,
          .qOpen .qText {
            animation: none;
            background-position: 50% 50%;
          }
        }
      `}</style>

      <p className="eyebrow">
        <VibraGradientText>{t("faqEyebrow")}</VibraGradientText>
      </p>
      <h2 className="title">{t("faqTitle")}</h2>

      {preguntas.map((item, i) => {
        const open = abierta === i;
        return (
          <div key={item.p} className="item">
            <button
              type="button"
              className={`q${open ? " qOpen" : ""}`}
              aria-expanded={open}
              // Volver a pulsar la abierta la cierra; abrir otra cierra la anterior.
              onClick={() => setAbierta(open ? null : i)}
            >
              <span className="qText">{item.p}</span>
              <svg
                className={`chevron${open ? " chevronOpen" : ""}`}
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M6 9.5l6 6 6-6" />
              </svg>
            </button>

            <div className={`panel${open ? " panelOpen" : ""}`}>
              <div className="panelInner">
                <p className="a">{item.r}</p>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
