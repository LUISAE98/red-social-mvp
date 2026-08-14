"use client";

import { useEffect, useRef, useState } from "react";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import { WALLET_COMMISSION_RATE, WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import LoginWalletPhone from "./LoginWalletPhone";

/**
 * Panel de creador del login. Se abre desde "Descubre cómo monetizar en Vibra"
 * y baja con tres bloques: el reparto del dinero, la wallet (simulada, pero
 * usable) y el alcance internacional.
 *
 * Los porcentajes NO están escritos a mano: salen de la misma constante que usa
 * el ledger, así que si la comisión cambia, este texto cambia con ella.
 */

const COMISION_PCT = Math.round(WALLET_COMMISSION_RATE * 100);
const NETO_PCT = Math.round(WALLET_NET_RATE * 100);

/** Duración del llenado de la barra. Los números corren con ella. */
const LLENADO_MS = 1100;

export default function LoginCreatorPanel() {
  const raizRef = useRef<HTMLDivElement | null>(null);
  const [dentro, setDentro] = useState(false);
  /** 0 → 1. Gobierna el ancho del relleno Y los dos números, para que no se
   *  puedan desincronizar entre sí. */
  const [avance, setAvance] = useState(0);

  useEffect(() => {
    const node = raizRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setDentro(true));
      return () => cancelAnimationFrame(id);
    }
    const obs = new IntersectionObserver(
      (entries) => {
        const ratio = Math.max(...entries.map((e) => (e.isIntersecting ? e.intersectionRatio : 0)));
        setDentro(ratio >= 0.08);
      },
      { threshold: [0, 0.08, 0.3] },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);

  // Llenado de la barra. Va por cuadros y no por transición CSS porque los
  // números tienen que ir contando al mismo ritmo que crece el relleno.
  useEffect(() => {
    let raf = 0;
    if (!dentro) {
      raf = requestAnimationFrame(() => setAvance(0));
      return () => cancelAnimationFrame(raf);
    }
    // Quien pidió menos movimiento ve la barra ya llena, sin conteo.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      raf = requestAnimationFrame(() => setAvance(1));
      return () => cancelAnimationFrame(raf);
    }
    let inicio = 0;
    const paso = (t: number) => {
      if (!inicio) inicio = t;
      const p = Math.min(1, (t - inicio) / LLENADO_MS);
      // Salida rápida y frenado largo, como el resto de las animaciones.
      setAvance(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [dentro]);

  // El de la izquierda sube hacia su parte; el de la derecha baja desde el 100,
  // que es lo que hace ver que uno le cede terreno al otro.
  const pctTuyo = Math.round(NETO_PCT * avance);
  const pctNuestro = Math.round(100 - (100 - COMISION_PCT) * avance);

  return (
    <div ref={raizRef} className={`cre${dentro ? " creIn" : ""}`}>
      <style jsx>{`
        .cre {
          width: 100%;
          max-width: 1000px;
          margin: 0 auto;
          /* MISMO aire arriba que la invitación a la que sustituye (74px), para
             que el panel arranque justo donde estaba la pregunta y no salte
             hacia arriba al abrirse. Si se cambia allá, hay que cambiarlo aquí. */
          padding: 74px 20px 60px;
          box-sizing: border-box;
        }

        /* ── Reparto del dinero ─────────────────────────────────────────── */
        .split {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .creEyebrow {
          margin: 0;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .creTitle {
          margin: 10px 0 0;
          font-size: clamp(22px, 2.6vw, 32px);
          font-weight: 700;
          letter-spacing: -0.03em;
          line-height: 1.12;
          color: #ffffff;
        }

        .creText {
          margin: 12px 0 0;
          max-width: 54ch;
          font-size: clamp(12.5px, 0.95vw, 14.5px);
          line-height: 1.65;
          color: rgba(255, 255, 255, 0.78);
        }

        /* Barra del reparto: la parte del creador ocupa lo que le toca de
           verdad, así el 75 y el 25 se ven además de leerse. Se RELLENA al
           entrar —de 0 a su meta— y al llegar da un pequeño respingo, como algo
           que se asienta al frenar. */
        .barra {
          position: relative;
          width: min(100%, 520px);
          height: 46px;
          margin-top: 26px;
          border-radius: 14px;
          overflow: hidden;
          /* Sin contorno y con el fondo francamente gris: así el relleno de
             color es lo único que destaca. */
          background: rgba(255, 255, 255, 0.16);
        }

        .barraFill {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          border-radius: 14px;
          background: linear-gradient(100deg, #ff2fb3 0%, #a855f7 55%, #4f46ff 100%);
        }

        /* Los dos números están desde el principio, encima del relleno: el de la
           izquierda a su altura y el otro pegado a la derecha. */
        .barraLabel,
        .barraResto {
          position: absolute;
          top: 0;
          bottom: 0;
          display: grid;
          place-items: center;
          white-space: nowrap;
          /* Ancho fijo en cifras para que el número no baile al cambiar de
             dígito mientras cuenta. */
          font-variant-numeric: tabular-nums;
        }
        .barraLabel {
          left: 16px;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #fff;
        }
        .barraResto {
          right: 16px;
          font-size: 12px;
          font-weight: 700;
          color: rgba(255, 255, 255, 0.75);
        }

        /* El respingo arranca cuando el relleno terminó su recorrido. */
        .creIn .barra {
          animation: asentar 460ms cubic-bezier(0.34, 1.56, 0.64, 1) 1100ms;
        }
        @keyframes asentar {
          0% {
            transform: scale(1);
          }
          40% {
            transform: scale(1.045);
          }
          100% {
            transform: scale(1);
          }
        }

        /* ── Wallet ─────────────────────────────────────────────────────── */
        .wallet {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 44px;
          margin-top: 92px;
        }

        .walletTexto {
          text-align: start;
        }
        .walletTexto .creTitle,
        .walletTexto .creText {
          margin-inline: 0;
        }

        .nota {
          margin: 14px 0 0;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.45);
        }

        /* ── Alcance ────────────────────────────────────────────────────── */
        .alcance {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin-top: 92px;
        }
        .planeta {
          width: min(64%, 240px);
          aspect-ratio: 1 / 1;
        }
        .planeta img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          display: block;
        }

        /* ── Entrada ────────────────────────────────────────────────────── */
        .split,
        .wallet,
        .alcance {
          opacity: 0;
          transform: translateY(22px);
          transition:
            opacity 620ms ease,
            transform 620ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .creIn .split {
          opacity: 1;
          transform: none;
        }
        .creIn .wallet {
          opacity: 1;
          transform: none;
          transition-delay: 90ms;
        }
        .creIn .alcance {
          opacity: 1;
          transform: none;
          transition-delay: 180ms;
        }

        @media (max-width: 900px) {
          .cre {
            padding-top: 52px;
          }
          .wallet {
            grid-template-columns: 1fr;
            justify-items: center;
            gap: 26px;
            margin-top: 64px;
          }
          .walletTexto {
            text-align: center;
          }
          .alcance {
            margin-top: 64px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .split,
          .wallet,
          .alcance {
            opacity: 1;
            transform: none;
            transition: none;
          }
          /* La barra se muestra ya llena, sin respingo (el llenado lo salta el
             propio código al detectar la preferencia). */
          .creIn .barra {
            animation: none;
          }
        }
      `}</style>

      <section className="split">
        <p className="creEyebrow">
          <VibraGradientText>Tus ganancias</VibraGradientText>
        </p>
        <h2 className="creTitle">
          De cada venta, el{" "}
          <span style={{ fontSize: "1.15em" }}>
            <VibraGradientText>{NETO_PCT}% es para ti</VibraGradientText>
          </span>
        </h2>
        <p className="creText">
          Vibra conserva una comisión del {COMISION_PCT}% por cada venta. Sin mensualidades ni
          costos por publicar, solo ganamos cuando tú también ganas.
        </p>

        <div className="barra" aria-hidden="true">
          <span className="barraFill" style={{ width: `${NETO_PCT * avance}%` }} />
          <span className="barraLabel">{pctTuyo}% para ti</span>
          <span className="barraResto">{pctNuestro}%</span>
        </div>
      </section>

      <section className="wallet">
        <LoginWalletPhone />

        <div className="walletTexto">
          <p className="creEyebrow">
            <VibraGradientText>Tu wallet</VibraGradientText>
          </p>
          <h2 className="creTitle">Tu dinero a la vista, siempre</h2>
          <p className="creText">
            Cada venta aparece con su nombre y su hora, y el saldo se actualiza al momento. Retira
            a tu cuenta cuando quieras, sin comisión por retirar y sin esperar a fin de mes.
          </p>
          <p className="nota">
            Toca el celular, es una demostración con datos de ejemplo y funciona de verdad.
          </p>
        </div>
      </section>

      <section className="alcance">
        <div className="planeta">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/suscomunidades.webp" alt="" loading="lazy" />
        </div>
        <h2 className="creTitle" style={{ marginTop: 22 }}>
          Te pueden pagar desde casi cualquier país
        </h2>
        <p className="creText">
          Tu audiencia compra en su moneda y con los medios de pago de su país. Tú lo recibes
          convertido, en la tuya, sin tener que entender de tipos de cambio ni de impuestos de otro
          continente.
        </p>
      </section>
    </div>
  );
}
