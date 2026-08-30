"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useInView } from "./useInView";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import { useCreatorNetRate } from "@/lib/wallet/useCreatorNetRate";
import LoginWalletPhone from "./LoginWalletPhone";
import LoginFaq from "./LoginFaq";

/**
 * Panel de creador del login. Se abre desde "Descubre cómo monetizar en Vibra"
 * y baja con tres bloques: el reparto del dinero, la wallet (simulada, pero
 * usable) y el alcance internacional.
 *
 * Los porcentajes NO están escritos a mano y tampoco son los mismos para todos: salen del
 * país de quien está mirando. Alguien que entra desde Turquía ve el 30% que le va a tocar,
 * no el 25% de México.
 *
 * Antes de registrarse el país sale de su IP, así que es una ESTIMACIÓN. Se dice en el
 * propio texto: prometerle un 25% que luego resulte 30% es la forma más rápida de que se
 * sienta engañado el día del primer retiro.
 */

/** Duración del llenado de la barra. Los números corren con ella. */
const LLENADO_MS = 1100;

export default function LoginCreatorPanel() {
  // Su comisión según su país. Sin sesión iniciada sale de la IP, que aquí es siempre el
  // caso: esta pantalla es justo la de antes de entrar.
  const { commissionRate, netRate, minWithdrawalUsd, esEstimacion } = useCreatorNetRate();
  const COMISION_PCT = Math.round(commissionRate * 100);
  const NETO_PCT = Math.round(netRate * 100);
  const t = useTranslations("loginLanding");
  // Un observador por sección: cada una entra y sale por su cuenta al pasar
  // por delante, en vez de encenderse las tres cuando asoma la primera.
  const [splitRef, splitDentro] = useInView<HTMLElement>(0.25);
  const [walletRef, walletDentro] = useInView<HTMLElement>(0.2);
  const [alcanceRef, alcanceDentro] = useInView<HTMLElement>(0.2);
  /** 0 → 1. Gobierna el ancho del relleno Y los dos números, para que no se
   *  puedan desincronizar entre sí. */
  const [avance, setAvance] = useState(0);


  // Llenado de la barra. Va por cuadros y no por transición CSS porque los
  // números tienen que ir contando al mismo ritmo que crece el relleno.
  useEffect(() => {
    let raf = 0;
    if (!splitDentro) {
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
  }, [splitDentro]);

  // El de la izquierda sube hacia su parte; el de la derecha baja desde el 100,
  // que es lo que hace ver que uno le cede terreno al otro.
  const pctTuyo = Math.round(NETO_PCT * avance);
  const pctNuestro = Math.round(100 - (100 - COMISION_PCT) * avance);

  return (
    <div className="cre">
      <style jsx>{`
        .cre {
          width: 100%;
          max-width: 1000px;
          margin: 0 auto;
          /* MISMO aire arriba que la invitación a la que sustituye (74px), para
             que el panel arranque justo donde estaba la pregunta y no salte
             hacia arriba al abrirse. Si se cambia allá, hay que cambiarlo aquí. */
          /* Abajo casi nada: el pie legal trae su propio relleno (22px) y sumar
             los dos abría un hueco muerto tras la última pregunta. */
          padding: 74px 20px 8px;
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
        .creNota {
          margin: 6px 0 0;
          font-size: 12.5px;
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.45);
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
        .split.seccionDentro .barra {
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
        /* Bloque pegado a la IZQUIERDA. Junto con el de alcance —pegado a la
           derecha— arma el zigzag de la sección, el mismo ritmo que traen las
           experiencias de arriba. */
        .wallet {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 44px;
          margin-top: 92px;
          max-width: 820px;
          margin-inline-end: auto;
        }

        .walletTexto {
          text-align: start;
        }
        .walletTexto .creTitle,
        .walletTexto .creText {
          margin-inline: 0;
        }


        /* ── Alcance ────────────────────────────────────────────────────── */
        /* Espejo del bloque de la wallet: aquí el texto va a la IZQUIERDA y la
           imagen a la derecha, para que las dos filas se lean intercaladas. */
        .alcance {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: center;
          gap: 44px;
          /* Más cerca de la wallet que del resto: las dos filas se leen como una
             sola idea intercalada, no como dos secciones sueltas. */
          margin-top: 56px;
          max-width: 900px;
          margin-inline-start: auto;
        }
        .alcanceTexto {
          text-align: end;
        }
        .planeta {
          width: 260px;
          aspect-ratio: 1 / 1;
          flex-shrink: 0;
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
        /* Cada sección se enciende con SU propio observador, así que entra al
           acercarse y se retira al salir, las veces que haga falta. */
        .seccionDentro {
          opacity: 1;
          transform: none;
        }

        @media (max-width: 900px) {
          .cre {
            padding-top: 52px;
          }
          /* Celular: nada de zigzag, todo apilado y centrado. */
          .wallet {
            grid-template-columns: 1fr;
            justify-items: center;
            gap: 26px;
            margin-top: 64px;
            max-width: none;
          }
          .walletTexto {
            text-align: center;
          }
          .alcance {
            grid-template-columns: 1fr;
            justify-items: center;
            gap: 26px;
            margin-top: 46px;
            max-width: none;
            margin-inline-start: 0;
          }
          /* El planeta sube al primer lugar, como en el resto de los bloques. */
          .alcanceTexto {
            order: 2;
            text-align: center;
          }
          .planeta {
            order: 1;
            width: min(64%, 240px);
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
          .split.seccionDentro .barra {
            animation: none;
          }
        }
      `}</style>

      <section ref={splitRef} className={`split${splitDentro ? " seccionDentro" : ""}`}>
        <p className="creEyebrow">
          <VibraGradientText>{t("earnEyebrow")}</VibraGradientText>
        </p>
        <h2 className="creTitle">
          {t.rich("earnTitle", {
            net: NETO_PCT,
            vibra: (chunks) => (
              <span style={{ fontSize: "1.15em" }}>
                <VibraGradientText>{chunks}</VibraGradientText>
              </span>
            ),
          })}
        </h2>
        <p className="creText">{t("earnText", { commission: COMISION_PCT })}</p>

        {/* Su mínimo de retiro y, si el país salió de la IP, que es aproximado.

            Antes esta pantalla decía 25% a todo el mundo. Un creador turco leía el número
            que no era y se enteraba el día del primer retiro. */}
        <p className="creNota">
          {t("earnMinimum", { min: minWithdrawalUsd })}
          {esEstimacion ? ` ${t("earnEstimated")}` : ""}
        </p>

        <div className="barra" aria-hidden="true">
          <span className="barraFill" style={{ width: `${NETO_PCT * avance}%` }} />
          {/* El número sube contando, así que el porcentaje va como dato del
              texto y no escrito dentro de la frase. */}
          <span className="barraLabel">{t("earnBarYours", { net: pctTuyo })}</span>
          <span className="barraResto">{pctNuestro}%</span>
        </div>
      </section>

      <section ref={walletRef} className={`wallet${walletDentro ? " seccionDentro" : ""}`}>
        <LoginWalletPhone />

        <div className="walletTexto">
          <p className="creEyebrow">
            <VibraGradientText>{t("walletEyebrow")}</VibraGradientText>
          </p>
          <h2 className="creTitle">
            {t.rich("walletTitle", {
              vibra: (chunks) => <VibraGradientText>{chunks}</VibraGradientText>,
            })}
          </h2>
          <p className="creText">{t("walletText")}</p>
        </div>
      </section>

      <section ref={alcanceRef} className={`alcance${alcanceDentro ? " seccionDentro" : ""}`}>
        {/* El texto va PRIMERO en el HTML aunque en pantalla comparta fila con la
            imagen: al apilarse en celular queda el planeta arriba por el `order`,
            y quien use lector de pantalla escucha el contenido antes que un
            adorno. */}
        <div className="alcanceTexto">
          <p className="creEyebrow">
            <VibraGradientText>{t("intlEyebrow")}</VibraGradientText>
          </p>
          <h2 className="creTitle">
            {t.rich("intlTitle", {
              vibra: (chunks) => <VibraGradientText>{chunks}</VibraGradientText>,
            })}
          </h2>
          <p className="creText" style={{ marginInlineStart: "auto" }}>
            {t("intlText")}
          </p>
        </div>

        <div className="planeta">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/suscomunidades.webp" alt="" loading="lazy" />
        </div>
      </section>

      {/* Cierre del panel: las dudas que quedan después de leerlo todo. */}
      <LoginFaq />
    </div>
  );
}
