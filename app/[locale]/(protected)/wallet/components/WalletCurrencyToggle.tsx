"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import {
  useWalletCurrencyMode,
  setWalletCurrencyMode,
  type WalletCurrencyMode,
} from "@/lib/wallet/useWalletCurrencyMode";
import { useWalletMoney } from "@/lib/wallet/useWalletMoney";

/**
 * Switch de lectura de la wallet, USD o la moneda anclada en el switch global.
 *
 * Sustituye al `CurrencySwitcher` que estaba sobre el saldo. Ese cambiaba la moneda de
 * TODA la plataforma desde dentro de la wallet, que es un efecto mucho mayor del que
 * sugiere su sitio; este solo cambia cómo lee el creador su propio dinero.
 *
 * No se pinta si su moneda ya es la de liquidación: no habría nada que elegir.
 *
 * Mismo estilo que el switch neto/bruto, con el que comparte fila.
 */
export default function WalletCurrencyToggle({ style }: { style?: CSSProperties }) {
  const tWallet = useTranslations("wallet");
  const mode = useWalletCurrencyMode();
  const { localCurrency, hasLocalOption } = useWalletMoney();

  if (!hasLocalOption) return null;

  const opciones: { key: WalletCurrencyMode; label: string }[] = [
    { key: "usd", label: "USD" },
    { key: "local", label: localCurrency },
  ];

  return (
    <div style={{ display: "flex", justifyContent: "center", ...style }}>
      <div
        role="tablist"
        aria-label={tWallet("walletCurrencyLabel")}
        style={{
          display: "inline-flex",
          padding: 3,
          borderRadius: 11,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
          gap: 2,
        }}
      >
        {opciones.map(({ key, label }) => {
          const active = mode === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setWalletCurrencyMode(key)}
              style={{
                border: "none",
                cursor: "pointer",
                borderRadius: 8,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                whiteSpace: "nowrap",
                fontVariantNumeric: "tabular-nums",
                color: active ? "#fff" : "rgba(255,255,255,0.6)",
                background: active ? "linear-gradient(135deg, #4f46ff, #a855f7)" : "transparent",
                transition: "color 150ms ease, background 150ms ease",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
