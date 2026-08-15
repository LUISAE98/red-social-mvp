"use client";

import { useState } from "react";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import { WALLET_COMMISSION_RATE } from "@/lib/wallet/walletFinances";
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

const COMISION_PCT = Math.round(WALLET_COMMISSION_RATE * 100);

const PREGUNTAS: { p: string; r: string }[] = [
  {
    p: "¿Necesito una cuenta especial para crear y vender?",
    r: "No. En Vibra todos usan la misma cuenta. Puedes registrarte, completar tu perfil y activar los servicios que quieras ofrecer. Cuando solicites tu primer retiro, validaremos tu identidad y al completar la verificación, tu cuenta quedará marcada con un distintivo especial para que los usuarios te identifiquen como creador.",
  },
  {
    p: "¿Qué puedo ofrecer?",
    r: "Once experiencias. Saludos y consejos grabados, meet & greet, sesiones exclusivas, tickets para tus transmisiones, supercomentarios, donaciones en tu perfil y durante tus lives, videos bajo demanda, publicaciones premium y suscripciones a tu comunidad. Activas solo las que te interesen y tú pones los precios.",
  },
  {
    p: "¿Necesito un mínimo de horas de transmisión o de seguidores?",
    r: "No. No pedimos mínimo de horas al aire, de seguidores ni de publicaciones. Puedes vender tu primera experiencia el mismo día que abres tu cuenta.",
  },
  {
    p: "¿En qué países está disponible?",
    r: "Tu contenido se puede ver y comprar desde casi cualquier país, y el cobro está configurado para más de 120 jurisdicciones con su impuesto y su moneda. La lista de países desde los que se puede recibir el dinero es más corta y depende de dónde vivas, al activar tus experiencias te decimos si el tuyo ya está disponible.",
  },
  {
    p: "¿Qué necesito para poder cobrar?",
    r: "Verificar tu identidad y registrar la cuenta donde quieres recibir tu dinero. Es un trámite de una sola vez. Mientras no lo completes tus ganancias no se pierden, se quedan acumuladas en tu wallet.",
  },
  {
    p: "¿Cuándo recibo mi dinero?",
    r: "Cada venta entra a tu wallet al momento y se libera cuando la experiencia se completó y pasó su plazo de garantía. A partir de ahí retiras cuando quieras, sin esperar a fin de mes y sin comisión por retirar.",
  },
  {
    p: `¿Cuánto cobra Vibra?`,
    r: `El ${COMISION_PCT}% de cada venta, y solo cuando vendes. No hay mensualidad, ni costo por publicar, ni cobro por abrir tu comunidad. De ese porcentaje sale el procesamiento del pago, el video y el streaming, los impuestos de la plataforma y el soporte.`,
  },
  {
    p: "¿Tengo que facturar?",
    r: "Depende de tu país y de tu situación fiscal. Vibra te entrega el detalle de todo lo que ganaste y de lo que se retuvo, para ti o para tu contador. Si donde vives necesitas emitir comprobantes por tus ingresos, esto funciona como cualquier otra actividad que te genere dinero.",
  },
  {
    p: "¿En qué moneda me pagan?",
    r: "Tu audiencia paga en la suya, con los medios de pago de su país, y tú recibes en la moneda de tu cuenta. La conversión la hace Vibra y la ves reflejada en cada movimiento de tu wallet.",
  },
];

export default function LoginFaq() {
  const [abierta, setAbierta] = useState<number | null>(null);
  const [seccionRef, dentro] = useInView<HTMLElement>(0.12);

  return (
    <section ref={seccionRef} className={`faq${dentro ? " faqIn" : ""}`}>
      <style jsx>{`
        .faq {
          width: 100%;
          max-width: 760px;
          margin: 0 auto;
          padding: 96px 20px 40px;
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
        .q:hover .qText,
        .qOpen .qText {
          background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 45%, #4f46ff 100%);
          background-size: 220% 220%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: vibraTextFlow 4.5s ease-in-out infinite;
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
        .q:hover .chevron {
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
          .faq {
            padding: 64px 20px 32px;
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
          .qOpen .qText {
            animation: none;
            background-position: 50% 50%;
          }
        }
      `}</style>

      <p className="eyebrow">
        <VibraGradientText>Preguntas frecuentes</VibraGradientText>
      </p>
      <h2 className="title">Lo que casi todos preguntan antes de empezar</h2>

      {PREGUNTAS.map((item, i) => {
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
