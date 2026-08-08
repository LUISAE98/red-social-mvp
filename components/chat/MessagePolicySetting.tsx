"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { MESSAGE_POLICIES, type MessagePolicy } from "@/lib/chat/types";

// Selector de quién puede abrirme un DM. Cuatro niveles en vez de un on/off: la
// mayoría de creadores no quiere "todos o nadie", quiere filtrar.
//
// Lista vertical y no segmentos horizontales: "a quien sigo y a quien me sigue"
// no cabe en una fila de cuatro sin recortarse en celular. Es un grupo de radios
// real, navegable con teclado y anunciado por lector de pantalla.

const OPTION_LABEL_KEY: Record<MessagePolicy, string> = {
  everyone: "messagePolicyEveryone",
  following_and_followers: "messagePolicyFollowingAndFollowers",
  following: "messagePolicyFollowing",
  none: "messagePolicyNone",
};

export const MESSAGE_POLICY_HELP_KEY: Record<MessagePolicy, string> = {
  everyone: "messagePolicyEveryoneHelp",
  following_and_followers: "messagePolicyFollowingAndFollowersHelp",
  following: "messagePolicyFollowingHelp",
  none: "messagePolicyNoneHelp",
};

export default function MessagePolicySetting({
  value,
  onChange,
  disabled = false,
}: {
  value: MessagePolicy;
  onChange: (next: MessagePolicy) => void;
  disabled?: boolean;
}) {
  const tProfile = useTranslations("profile");

  const groupStyle: CSSProperties = {
    display: "grid",
    gap: 6,
    width: "100%",
    opacity: disabled ? 0.5 : 1,
  };

  function optionStyle(active: boolean): CSSProperties {
    return {
      display: "flex",
      alignItems: "center",
      gap: 9,
      minHeight: 40,
      padding: "0 12px",
      borderRadius: 10,
      border: active
        ? "1px solid rgba(168,85,247,0.55)"
        : "1px solid rgba(255,255,255,0.10)",
      background: active ? "rgba(168,85,247,0.16)" : "rgba(255,255,255,0.04)",
      color: active ? "#f3e8ff" : "rgba(255,255,255,0.78)",
      fontSize: 13.5,
      fontWeight: active ? 600 : 500,
      fontFamily: "inherit",
      lineHeight: 1.25,
      textAlign: "left",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background 0.18s ease, border-color 0.18s ease, color 0.18s ease",
      WebkitTapHighlightColor: "transparent",
    };
  }

  return (
    <div style={groupStyle} role="radiogroup" aria-label={tProfile("messagePolicyLabel")}>
      {MESSAGE_POLICIES.map((policy) => {
        const active = value === policy;
        return (
          <button
            key={policy}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => {
              if (disabled || active) return;
              onChange(policy);
            }}
            style={optionStyle(active)}
          >
            {/* Punto de radio dibujado a mano: el input nativo no se puede
                pintar con el resto del sistema visual. */}
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 14,
                height: 14,
                borderRadius: 999,
                border: active
                  ? "4px solid #a855f7"
                  : "1.5px solid rgba(255,255,255,0.34)",
                boxSizing: "border-box",
              }}
            />
            {tProfile(OPTION_LABEL_KEY[policy])}
          </button>
        );
      })}
    </div>
  );
}
