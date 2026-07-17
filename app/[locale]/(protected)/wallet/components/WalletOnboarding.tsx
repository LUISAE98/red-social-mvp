"use client";

// Wallet de un creador que todavía no monetiza: no tiene servicios activos ni
// ha recibido ninguna solicitud. En vez del reporte en ceros, ve una invitación
// a empezar. La condición la decide useWalletVisibility, el mismo gate que
// muestra u oculta la sección Wallet del rail derecho.

import { useTranslations } from "next-intl";
import VibraGradientText from "@/app/components/VibraGradientText/VibraGradientText";

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
          max-width: 15ch;
          font-size: 52px;
          line-height: 1.04;
          letter-spacing: -0.04em;
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
          font-size: 30px;
          line-height: 1.1;
          letter-spacing: -0.03em;
          font-weight: 700;
          color: #ffffff;
        }

        .onboardingText {
          margin: 18px 0 0;
          max-width: 46ch;
          font-size: 17px;
          line-height: 1.5;
          font-weight: 400;
          color: rgba(255, 255, 255, 0.72);
        }

        @media (max-width: 900px) {
          .onboarding {
            padding: 24px 0 48px;
          }

          .onboardingTitle {
            font-size: 36px;
            max-width: none;
          }

          .onboardingRules {
            margin-top: 52px;
          }

          .onboardingRulesTitle {
            font-size: 24px;
          }

          .onboardingText {
            margin-top: 14px;
            font-size: 15px;
            max-width: none;
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

        <div className="onboardingRules">
          <h3 className="onboardingRulesTitle">{tWallet("onboardingRulesTitle")}</h3>
          <p className="onboardingText">{tWallet("onboardingRulesText")}</p>
        </div>
      </section>
    </>
  );
}
