"use client";

// Wallet de un creador que todavía no monetiza: no tiene servicios activos ni
// ha recibido ninguna solicitud. En vez del reporte en ceros, ve una invitación
// a empezar. La condición la decide useWalletVisibility, el mismo gate que
// muestra u oculta la sección Wallet del rail derecho.

import Image from "next/image";
import { useTranslations } from "next-intl";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import {
  WALLET_COMMISSION_RATE,
  WALLET_NET_RATE,
} from "@/lib/wallet/walletFinances";

// Deriva el porcentaje de la comisión real: si algún día cambia la tasa, este
// texto de marketing se actualiza con ella en vez de quedar desincronizado.
const COMMISSION_PCT = Math.round(WALLET_COMMISSION_RATE * 100);

// Cifras del ejemplo, ancladas en MXN (como todo el sistema de precios). El neto
// se deriva de la tasa real, no se quema, y se pasan a usePriceFormat para que
// entren al switcheo de moneda de la plataforma.
const EXAMPLE_CHARGE_MXN = 1000;
const EXAMPLE_RECEIVE_MXN = Math.round(EXAMPLE_CHARGE_MXN * WALLET_NET_RATE);

const PERK_KEYS = [
  "onboardingPerk1",
  "onboardingPerk2",
  "onboardingPerk3",
  "onboardingPerk4",
  "onboardingPerk5",
] as const;

const FEE_PERK_KEYS = [
  "onboardingFeePerk1",
  "onboardingFeePerk2",
  "onboardingFeePerk3",
  "onboardingFeePerk4",
] as const;

export default function WalletOnboarding() {
  const tWallet = useTranslations("wallet");
  const { format: formatPrice } = usePriceFormat();

  return (
    <>
      <style jsx>{`
        .onboarding {
          position: relative;
          isolation: isolate;
          overflow: hidden;
          border-radius: 20px;
          padding: 40px 36px 48px;
        }

        /* Velo oscuro sobre la imagen: la escena tiene el brillo de la TV que
           haría ilegible el texto blanco, sobre todo el bloque de la derecha. */
        .onboardingScrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(
            100deg,
            rgba(8, 5, 16, 0.9) 0%,
            rgba(8, 5, 16, 0.55) 52%,
            rgba(8, 5, 16, 0.78) 100%
          );
        }

        .onboardingInner {
          position: relative;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .onboardingTitle {
          margin: 0;
          font-size: 34px;
          line-height: 1.1;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        /* Fila inferior: ventajas a la izquierda, reglas a la derecha. */
        .onboardingColumns {
          align-self: stretch;
          margin-top: 56px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 32px;
        }

        .onboardingRules {
          text-align: right;
        }

        .onboardingRulesTitle {
          margin: 0;
          font-size: 22px;
          line-height: 1.15;
          letter-spacing: -0.02em;
          font-weight: 700;
          color: #ffffff;
        }

        .onboardingText {
          margin: 14px 0 0;
          max-width: 46ch;
          font-size: 15px;
          line-height: 1.5;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.72);
        }

        /* Lista de ventajas, alineada a la izquierda de la fila inferior. */
        .onboardingPerks {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }

        .onboardingPerk {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          line-height: 1.3;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.92);
        }

        /* Círculo sin relleno, solo contorno morado, con el mismo grosor de trazo
           que la paloma de adentro. */
        .onboardingPerkCheck {
          flex: 0 0 auto;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: transparent;
          border: 1.4px solid #a855ff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .onboardingPerkCheck svg {
          width: 8px;
          height: 8px;
          display: block;
        }

        /* Sección de comisión, fuera de la tarjeta con imagen. */
        .commission {
          margin-top: 40px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 32px;
        }

        .commissionLeft {
          flex: 0 1 auto;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 14px;
        }

        /* 23% y su lista de garantías, lado a lado. */
        .commissionFigureRow {
          display: flex;
          align-items: center;
          gap: 22px;
        }

        /* Ejemplo, a la derecha de la sección de comisión. */
        .commissionRight {
          flex: 0 1 auto;
          min-width: 0;
          display: flex;
          justify-content: flex-end;
        }

        .exampleCard {
          display: grid;
          grid-template-columns: auto auto;
          align-items: baseline;
          gap: 6px 14px;
          padding: 20px 24px;
          border-radius: 16px;
          background: rgba(168, 85, 255, 0.08);
          border: 1px solid rgba(168, 85, 255, 0.28);
        }

        .exampleLabel {
          font-size: 14px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        .exampleCharge {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #ffffff;
          white-space: nowrap;
          text-align: right;
        }

        .exampleReceive {
          font-size: 22px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #22c55e;
          white-space: nowrap;
          text-align: right;
        }

        .commissionTitle {
          margin: 0;
          font-size: 26px;
          line-height: 1.15;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        /* El tamaño y el estirado van en este span normal (styled-jsx no scopea
           clases sobre el componente VibraGradientText); el degradado los hereda.
           line-height holgado + padding evitan que background-clip:text corte el
           número por abajo. */
        .commissionPct {
          display: inline-block;
          font-size: 92px;
          line-height: 1.15;
          letter-spacing: -0.04em;
          font-weight: 500;
          padding-bottom: 0.12em;
          /* Estirado vertical: crece hacia arriba y abajo desde su centro. */
          transform: scaleY(1.3);
          transform-origin: left center;
        }

        @media (max-width: 900px) {
          .onboarding {
            padding: 28px 20px 36px;
            border-radius: 16px;
          }

          /* En angosto: título+23% arriba, ejemplo abajo, ambos a lo ancho. */
          .commission {
            margin-top: 32px;
            flex-direction: column;
            align-items: stretch;
            gap: 20px;
          }

          .commissionTitle {
            font-size: 22px;
          }

          .commissionPct {
            font-size: 72px;
          }

          /* En angosto el 23% no cabe junto a la lista: se apilan. */
          .commissionFigureRow {
            flex-direction: column;
            align-items: flex-start;
            gap: 18px;
          }

          .commissionRight {
            justify-content: flex-start;
          }

          .exampleCard {
            width: 100%;
            justify-content: start;
          }

          .onboardingTitle {
            font-size: 28px;
            max-width: none;
          }

          /* En pantalla angosta las dos columnas no caben lado a lado:
             se apilan, ventajas arriba y reglas abajo. */
          .onboardingColumns {
            margin-top: 36px;
            flex-direction: column;
            align-items: stretch;
            gap: 36px;
          }

          .onboardingRulesTitle {
            font-size: 19px;
          }

          .onboardingText {
            max-width: none;
          }
        }
      `}</style>

      <section className="onboarding">
        {/* Fondo decorativo. styled-jsx no scopea clases sobre <Image>, así que
            el posicionamiento va inline; el aspecto (velo, capas) en las clases
            de los hermanos, que sí son elementos DOM. */}
        <Image
          src="/desbloquearcontenido.webp"
          alt=""
          fill
          priority
          sizes="(max-width: 900px) 100vw, 860px"
          style={{ objectFit: "cover", zIndex: 0 }}
        />
        <div className="onboardingScrim" aria-hidden="true" />

        <div className="onboardingInner">
          {/* Texto enriquecido: cada idioma decide qué palabra lleva el degradado
              y en qué punto de la frase cae, en vez de asumir que va al final. */}
          <h2 className="onboardingTitle">
            {tWallet.rich("onboardingTitle", {
              vibra: (chunks) => <VibraGradientText>{chunks}</VibraGradientText>,
            })}
          </h2>

          <div className="onboardingColumns">
            <ul className="onboardingPerks">
              {PERK_KEYS.map((key) => (
                <li key={key} className="onboardingPerk">
                  <span className="onboardingPerkCheck" aria-hidden="true">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6.2 4.7 9 10 3.2"
                        stroke="#a855ff"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {tWallet(key)}
                </li>
              ))}
            </ul>

            <div className="onboardingRules">
              <h3 className="onboardingRulesTitle">
                {tWallet.rich("onboardingRulesTitle", {
                  vibra: (chunks) => <VibraGradientText>{chunks}</VibraGradientText>,
                })}
              </h3>
              <p className="onboardingText">{tWallet("onboardingRulesText")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Comisión: fuera de la tarjeta con imagen. Texto a la izquierda; la
          derecha queda reservada para un ejemplo que se agregará después. */}
      <section className="commission">
        <div className="commissionLeft">
          <h2 className="commissionTitle">{tWallet("onboardingCommissionTitle")}</h2>

          <div className="commissionFigureRow">
            <span className="commissionPct">
              <VibraGradientText>{COMMISSION_PCT}%</VibraGradientText>
            </span>

            <ul className="onboardingPerks">
              {FEE_PERK_KEYS.map((key) => (
                <li key={key} className="onboardingPerk">
                  <span className="onboardingPerkCheck" aria-hidden="true">
                    <svg viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6.2 4.7 9 10 3.2"
                        stroke="#a855ff"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {tWallet(key)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="commissionRight">
          <div className="exampleCard">
            <span className="exampleLabel">{tWallet("onboardingExampleCharge")}</span>
            <span className="exampleCharge">
              {formatPrice(EXAMPLE_CHARGE_MXN, { code: true })}
            </span>
            <span className="exampleLabel">{tWallet("onboardingExampleReceive")}</span>
            <span className="exampleReceive">
              {formatPrice(EXAMPLE_RECEIVE_MXN, { code: true })}
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
