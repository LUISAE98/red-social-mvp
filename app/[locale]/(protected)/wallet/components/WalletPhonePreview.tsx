"use client";

// Wallet activa simulada dentro del mockup de celular del onboarding. Datos de
// ejemplo (no reales): es una demostración de cómo se ve la wallet ya activa.
// El visitante puede tocar las pestañas para moverse entre Finanzas y Estadísticas.

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  VibraNavigationIcon,
  VibraNavigationIconsStyles,
} from "@/app/components/VibraServiceIcons/VibraNavigationIcons";

type PhoneTab = "finances" | "statistics";

// Ingresos de ejemplo por mes (alturas relativas de las barras).
const STAT_BARS = [42, 58, 50, 72, 63, 88];

export default function WalletPhonePreview() {
  const tNav = useTranslations("nav");
  const tWallet = useTranslations("wallet");
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const [tab, setTab] = useState<PhoneTab>("finances");

  // Transacciones de ejemplo (no reales): etiqueta ya traducida + monto.
  const TX = [
    { label: tWallet("typeLabelGreeting"), amount: "+$230" },
    { label: tWallet("typeLabelAdvice"), amount: "+$180" },
    { label: tCommon("donation"), amount: "+$120" },
    { label: tWallet("txTypeSupercomment"), amount: "+$60" },
    { label: tServices("exclusiveSession"), amount: "+$1,200" },
    { label: tWallet("onboardingPhoneTicket"), amount: "+$350" },
    { label: tWallet("onboardingPhoneSubscription"), amount: "+$99" },
  ];

  return (
    <div className="pw">
      <style jsx>{`
        .pw {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: radial-gradient(120% 90% at 50% 0%, #12101c 0%, #05040a 60%);
          color: #fff;
          font-family: inherit;
          overflow: hidden;
        }

        .pwStatus {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 14px 2px;
          font-size: 9px;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.7);
        }
        .pwDots {
          letter-spacing: 1px;
        }

        .pwHead {
          padding: 4px 14px 8px;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        /* Switch angosto y centrado: solo íconos (el texto se salía en celular). */
        .pwTabs {
          display: flex;
          gap: 4px;
          width: fit-content;
          margin: 0 auto 10px;
          padding: 3px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.06);
        }
        .pwTab {
          flex: 0 0 auto;
          border: none;
          border-radius: 999px;
          padding: 6px 18px;
          font-family: inherit;
          /* El ícono usa currentColor: negro en el activo (fondo blanco),
             claro en el inactivo (fondo oscuro) para que se vea. */
          color: rgba(255, 255, 255, 0.55);
          background: transparent;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 200ms ease, color 200ms ease;
          -webkit-tap-highlight-color: transparent;
        }
        .pwTab svg {
          display: block;
        }
        .pwTabOn {
          background: #ffffff;
          color: #000000;
        }

        .pwBody {
          flex: 1;
          min-height: 0;
          padding: 0 14px 12px;
          overflow: hidden;
        }

        /* --- Finanzas --- */
        .pwAvailLabel {
          font-size: 9.5px;
          color: rgba(255, 255, 255, 0.55);
          margin-bottom: 2px;
        }
        .pwAvailAmount {
          font-size: 27px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #22c55e;
          line-height: 1;
        }
        .pwWithdraw {
          margin-top: 10px;
          width: 100%;
          border: none;
          border-radius: 10px;
          padding: 8px 0;
          font-size: 10px;
          font-weight: 700;
          font-family: inherit;
          color: #0a0810;
          background: #ffffff;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }
        /* El icono de moneda trae trazo morado de marca; aquí va negro. */
        .pwWithdraw :global(svg *) {
          stroke: #000000;
        }
        .pwTxList {
          margin-top: 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .pwTx {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .pwTxName {
          min-width: 0;
          font-size: 10.5px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .pwTxAmount {
          font-size: 10.5px;
          font-weight: 700;
          color: #22c55e;
          flex-shrink: 0;
        }

        /* --- Estadísticas --- */
        .pwStatsTitle {
          font-size: 9.5px;
          color: rgba(255, 255, 255, 0.55);
          margin-bottom: 10px;
        }
        .pwChart {
          display: flex;
          align-items: flex-end;
          gap: 6px;
          height: 96px;
        }
        .pwBar {
          flex: 1;
          border-radius: 4px 4px 2px 2px;
          background: linear-gradient(180deg, #c084fc, #7c3aed);
        }
        .pwStatsFoot {
          margin-top: 14px;
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }
        .pwStatsMonth {
          font-size: 9.5px;
          color: rgba(255, 255, 255, 0.55);
        }
        .pwStatsValue {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: #fff;
        }
        .pwStatsGrowth {
          font-size: 11px;
          font-weight: 700;
          color: #22c55e;
        }
      `}</style>

      <div className="pwStatus">
        <span>9:41</span>
        <span className="pwDots">•••</span>
      </div>

      <div className="pwHead">Wallet</div>

      <VibraNavigationIconsStyles />

      <div className="pwTabs">
        <button
          type="button"
          className={`pwTab${tab === "finances" ? " pwTabOn" : ""}`}
          onClick={() => setTab("finances")}
          aria-label={tNav("finances")}
        >
          {/* Moneda ($) */}
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v10" />
            <path d="M14.6 9.2c-.6-.8-1.6-1.2-2.6-1.2-1.4 0-2.5.8-2.5 1.9s1.1 1.6 2.5 1.9 2.6.8 2.6 2-1.1 1.9-2.6 1.9c-1.1 0-2.1-.5-2.7-1.2" />
          </svg>
        </button>
        <button
          type="button"
          className={`pwTab${tab === "statistics" ? " pwTabOn" : ""}`}
          onClick={() => setTab("statistics")}
          aria-label={tNav("statistics")}
        >
          {/* Barras (estadísticas) */}
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 20v-6" />
            <path d="M12 20V5" />
            <path d="M19 20v-9" />
          </svg>
        </button>
      </div>

      <div className="pwBody">
        {tab === "finances" ? (
          <>
            <div className="pwAvailLabel">{tWallet("onboardingPhoneAvailable")}</div>
            <div className="pwAvailAmount">$12,450</div>
            <button type="button" className="pwWithdraw">
              {tWallet("onboardingPhoneWithdraw")}
              <VibraNavigationIcon type="coin" size={14} strokeWidth={2} />
            </button>

            <div className="pwTxList">
              {TX.map((tx) => (
                <div key={tx.label} className="pwTx">
                  <span className="pwTxName">{tx.label}</span>
                  <span className="pwTxAmount">{tx.amount}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="pwStatsTitle">{tWallet("onboardingPhoneIncome")}</div>
            <div className="pwChart">
              {STAT_BARS.map((h, i) => (
                <span key={i} className="pwBar" style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="pwStatsFoot">
              <div>
                <div className="pwStatsMonth">{tWallet("onboardingPhoneThisMonth")}</div>
                <div className="pwStatsValue">$8,900</div>
              </div>
              <span className="pwStatsGrowth">+18%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
