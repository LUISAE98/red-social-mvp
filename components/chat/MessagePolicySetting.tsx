"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { MESSAGE_POLICIES, type MessagePolicy } from "@/lib/chat/types";

// Selector de quién puede abrirme un DM. Tres niveles en vez de un on/off: la
// mayoría de creadores no quiere "todos o nadie", quiere filtrar.
//
// No es un Switch porque no son 2 estados. Se pinta como grupo de radios
// (accesible con teclado y lector de pantalla) con aspecto de segmentos.

const OPTION_LABEL_KEY: Record<MessagePolicy, string> = {
  everyone: "messagePolicyEveryone",
  following: "messagePolicyFollowing",
  none: "messagePolicyNone",
};

export const MESSAGE_POLICY_HELP_KEY: Record<MessagePolicy, string> = {
  everyone: "messagePolicyEveryoneHelp",
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
    display: "inline-flex",
    gap: 2,
    padding: 2,
    borderRadius: 8,
    background: "rgba(255,255,255,0.06)",
    opacity: disabled ? 0.5 : 1,
  };

  function optionStyle(active: boolean): CSSProperties {
    return {
      minHeight: 30,
      padding: "0 10px",
      borderRadius: 6,
      border: "none",
      background: active ? "rgba(168,85,247,0.28)" : "transparent",
      color: active ? "#e9d5ff" : "rgba(255,255,255,0.66)",
      fontSize: 12.5,
      fontWeight: active ? 600 : 500,
      fontFamily: "inherit",
      lineHeight: 1.2,
      whiteSpace: "nowrap",
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "background 0.18s ease, color 0.18s ease",
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
            {tProfile(OPTION_LABEL_KEY[policy])}
          </button>
        );
      })}
    </div>
  );
}
