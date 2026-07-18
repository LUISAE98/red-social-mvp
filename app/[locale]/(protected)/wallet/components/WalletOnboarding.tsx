"use client";

// Wallet de un creador que todavía no monetiza: no tiene servicios activos ni
// ha recibido ninguna solicitud. En vez del reporte en ceros, ve una invitación
// a empezar. La condición la decide useWalletVisibility, el mismo gate que
// muestra u oculta la sección Wallet del rail derecho.

import Image from "next/image";
import { useTranslations } from "next-intl";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import WalletPhonePreview from "./WalletPhonePreview";
import WalletOnboardingGlobe from "./WalletOnboardingGlobe";
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
  // Cifras demo sin centavos: quita el ".00"/",00" cuando el monto es redondo,
  // conservando el símbolo de moneda (respeta el switcheo de moneda).
  const formatNoCents = (mxn: number) =>
    formatPrice(mxn, { code: true }).replace(/([.,])00(\D*)$/, "$2");

  return (
    <>
      <style jsx>{`
        /* Solo el onboarding se acota: en laptops grandes las filas con
           space-between se estiraban y quedaban huecas. La wallet activa (otro
           componente) no pasa por aquí y sigue sin restricción de ancho. */
        .onboardingRoot {
          max-width: 768px;
          margin-left: auto;
          margin-right: auto;
        }

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

        /* Ventajas + reglas, centradas como grupo con un espacio intermedio
           controlado. clamp evita que en laptops grandes quede un hueco muerto
           enorme (tope 64px) y que en angosto se peguen (mínimo 32px). */
        .onboardingColumns {
          align-self: stretch;
          margin-top: 56px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: clamp(32px, 5vw, 64px);
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
          border: 1.9px solid #a855ff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .onboardingPerkCheck svg {
          width: 8px;
          height: 8px;
          display: block;
        }

        /* Sección de comisión, fuera de la tarjeta con imagen. Igual que la fila
           de arriba: centrada como grupo, con espacio intermedio controlado por
           clamp para no dejar hueco muerto en laptops grandes. */
        .commission {
          margin-top: 16px;
          display: flex;
          justify-content: center;
          align-items: stretch;
          gap: clamp(32px, 5vw, 64px);
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

        /* Tarjeta con imagen de fondo (entretenimiento) en vez del contenedor
           morado. styled-jsx no scopea clases sobre <Image>: el posicionamiento
           va inline; velo y contenido en clases de hermanos (elementos DOM). */
        /* Ancho por contenido; sin redondeo (esquinas cuadradas). La altura la
           toma del estirado de la fila (align-items: stretch), igualando al
           bloque de la izquierda para acercar su borde superior al banner. */
        .exampleCard {
          position: relative;
          isolation: isolate;
          overflow: hidden;
        }

        .exampleScrim {
          position: absolute;
          inset: 0;
          z-index: 1;
          background: linear-gradient(
            160deg,
            rgba(8, 5, 16, 0.82) 0%,
            rgba(8, 5, 16, 0.62) 100%
          );
        }

        .exampleCardInner {
          position: relative;
          z-index: 2;
          height: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 26px 32px;
          text-align: center;
        }

        .exampleChargeGroup {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        /* "Si cobras $1,000 MXN" en una sola línea, misma fuente que el label. */
        .exampleChargeLine {
          font-size: 18px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        /* Nota sutil debajo del monto cobrado. */
        .exampleBeforeTax {
          font-size: 10px;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.4);
          white-space: nowrap;
        }

        .exampleDivider {
          align-self: stretch;
          height: 1px;
          background: rgba(168, 85, 255, 0.28);
          margin: 4px 0;
        }

        /* "Tú recibes" + monto: centrados dentro de la tarjeta. */
        .exampleLabel {
          align-self: center;
          font-size: 18px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.7);
          white-space: nowrap;
        }

        .exampleReceive {
          align-self: center;
          font-size: 39px;
          font-weight: 500;
          letter-spacing: -0.01em;
          color: #a855ff;
          white-space: nowrap;
        }

        .commissionTitle {
          margin: 0;
          font-size: 26px;
          line-height: 1.15;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        /* Bloque de transparencia, alineado a la derecha. */
        /* Fila: mockup de celular a la izquierda, texto a la derecha.
           align-items flex-start sube el texto a la altura donde arranca el celular. */
        .clearSection {
          margin-top: 48px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          gap: clamp(24px, 5vw, 56px);
        }

        .clearTextBlock {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }

        /* Mockup de celular (marco). La pantalla queda lista para su contenido. */
        .phoneMock {
          flex-shrink: 0;
          width: 190px;
          aspect-ratio: 9 / 19;
          border-radius: 30px;
          padding: 7px;
          box-sizing: border-box;
          background: linear-gradient(155deg, #16131c 0%, #0a0810 100%);
          border: 1px solid rgba(255, 255, 255, 0.12);
          box-shadow:
            0 24px 60px rgba(0, 0, 0, 0.55),
            inset 0 1px 0 rgba(255, 255, 255, 0.06);
          position: relative;
        }

        /* Notch superior */
        .phoneMock::before {
          content: "";
          position: absolute;
          top: 10px;
          left: 50%;
          transform: translateX(-50%);
          width: 46px;
          height: 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.14);
          z-index: 2;
        }

        .phoneScreen {
          width: 100%;
          height: 100%;
          border-radius: 24px;
          overflow: hidden;
          background: #05040a;
          position: relative;
        }

        .clearTitle {
          margin: 0;
          font-size: 26px;
          line-height: 1.15;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        .clearText {
          margin: 14px 0 0;
          max-width: 40ch;
          font-size: 15px;
          line-height: 1.5;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.72);
        }

        /* Ancho grande; el globo llena este contenedor y se encoge solo en móvil. */
        .clearGlobe {
          margin-top: -14px;
          width: min(430px, 100%);
          align-self: flex-end;
        }

        /* Imagen de estilo de vida, a lo ancho del onboarding. */
        .lifestyle {
          margin-top: 44px;
        }

        .lifestyleImageWrap {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 9;
          overflow: hidden;
        }

        /* Velo oscuro sobre la imagen. */
        .lifestyleImageWrap::after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(8, 5, 16, 0.45);
          pointer-events: none;
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
          /* Sin estirado vertical: se conserva la altura y se ensancha un poco. */
          transform: scaleX(1.08);
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

          /* En angosto: celular arriba, texto abajo, centrados. */
          .clearSection {
            margin-top: 36px;
            flex-direction: column;
            gap: 26px;
          }

          .phoneMock {
            width: 158px;
          }

          .clearTextBlock {
            align-items: center;
            text-align: center;
          }

          .clearText {
            max-width: none;
          }

          .clearGlobe {
            align-self: center;
          }

          .clearTitle {
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
            /* Un cuadrado a ancho completo sería altísimo en el teléfono. */
            aspect-ratio: 16 / 10;
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

      <div className="onboardingRoot">
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
                        strokeWidth="2.1"
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
                        strokeWidth="2.1"
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
            <Image
              src="/entretenimiento.webp"
              alt=""
              fill
              sizes="(max-width: 900px) 90vw, 260px"
              style={{ objectFit: "cover", zIndex: 0 }}
            />
            <div className="exampleScrim" aria-hidden="true" />

            <div className="exampleCardInner">
              <span className="exampleChargeGroup">
                <span className="exampleChargeLine">
                  {tWallet("onboardingExampleCharge")}{" "}
                  {formatNoCents(EXAMPLE_CHARGE_MXN)}
                </span>
                <span className="exampleBeforeTax">{tWallet("onboardingBeforeTax")}</span>
              </span>

              <span className="exampleDivider" aria-hidden="true" />

              <span className="exampleLabel">{tWallet("onboardingExampleReceive")}</span>
              <span className="exampleReceive">
                {formatNoCents(EXAMPLE_RECEIVE_MXN)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Transparencia: título + descripción, alineados a la derecha. */}
      <section className="clearSection">
        {/* Simulador de celular con una wallet activa demo (Finanzas / Estadísticas). */}
        <div className="phoneMock">
          <div className="phoneScreen">
            <WalletPhonePreview />
          </div>
        </div>

        <div className="clearTextBlock">
          <h2 className="clearTitle">
            {tWallet.rich("onboardingClearTitle", {
              vibra: (chunks) => <span style={{ color: "#22c55e" }}>{chunks}</span>,
            })}
          </h2>
          <p className="clearText">{tWallet("onboardingClearText")}</p>

          {/* Planeta 3D blanco (mismo motor que el globo de la wallet). */}
          <div className="clearGlobe">
            <WalletOnboardingGlobe />
          </div>
        </div>
      </section>

      {/* Imagen de estilo de vida, a lo ancho. Debajo irá más contenido. */}
      <section className="lifestyle">
        <div className="lifestyleImageWrap">
          <Image
            src="/wallet.webp"
            alt=""
            fill
            sizes="(max-width: 900px) 100vw, 768px"
            style={{ objectFit: "cover" }}
          />
        </div>
      </section>
      </div>
    </>
  );
}
