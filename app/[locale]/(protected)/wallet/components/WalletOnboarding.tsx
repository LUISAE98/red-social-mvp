"use client";

// Wallet de un creador que todavía no monetiza: no tiene servicios activos ni
// ha recibido ninguna solicitud. En vez del reporte en ceros, ve una invitación
// a empezar. La condición la decide useWalletVisibility, el mismo gate que
// muestra u oculta la sección Wallet del rail derecho.

import { useTranslations } from "next-intl";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";

const PERK_KEYS = [
  "onboardingPerk1",
  "onboardingPerk2",
  "onboardingPerk3",
  "onboardingPerk4",
  "onboardingPerk5",
] as const;

export default function WalletOnboarding() {
  const tWallet = useTranslations("wallet");

  return (
    <>
      <style jsx>{`
        .onboarding {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding: 32px 0 64px;
        }

        .onboardingTitle {
          margin: 0;
          font-size: 34px;
          line-height: 1.1;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        /* Bloque alineado a la derecha, contrapeso del título principal */
        .onboardingRules {
          align-self: flex-end;
          text-align: right;
          margin-top: 80px;
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

        /* Lista de ventajas: alineada a la izquierda, contrapeso del bloque de
           reglas que va a la derecha. */
        .onboardingPerks {
          list-style: none;
          margin: 44px 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .onboardingPerk {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 16px;
          line-height: 1.35;
          font-weight: 500;
          color: #ffffff;
        }

        /* Círculo morado tenue + paloma morada sólida: ambos morados, pero con
           contraste suficiente para que la paloma se vea. */
        .onboardingPerkCheck {
          flex: 0 0 auto;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          background: rgba(168, 85, 255, 0.18);
          border: 1.5px solid rgba(168, 85, 255, 0.5);
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .onboardingPerkCheck svg {
          width: 13px;
          height: 13px;
          display: block;
        }

        @media (max-width: 900px) {
          .onboarding {
            padding: 24px 0 48px;
          }

          .onboardingTitle {
            font-size: 28px;
            max-width: none;
          }

          .onboardingRules {
            margin-top: 52px;
          }

          .onboardingRulesTitle {
            font-size: 19px;
          }

          .onboardingText {
            max-width: none;
          }

          .onboardingPerks {
            margin-top: 32px;
            gap: 12px;
          }

          .onboardingPerk {
            font-size: 15px;
          }
        }
      `}</style>

      <section className="onboarding">
        {/* Texto enriquecido: cada idioma decide qué palabra lleva el degradado
            y en qué punto de la frase cae, en vez de asumir que va al final. */}
        <h2 className="onboardingTitle">
          {tWallet.rich("onboardingTitle", {
            vibra: (chunks) => <VibraGradientText>{chunks}</VibraGradientText>,
          })}
        </h2>

        <p className="onboardingText">{tWallet("onboardingSubtitle")}</p>

        <ul className="onboardingPerks">
          {PERK_KEYS.map((key) => (
            <li key={key} className="onboardingPerk">
              <span className="onboardingPerkCheck" aria-hidden="true">
                <svg viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2 6.2 4.7 9 10 3.2"
                    stroke="#a855ff"
                    strokeWidth="1.8"
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
      </section>
    </>
  );
}
