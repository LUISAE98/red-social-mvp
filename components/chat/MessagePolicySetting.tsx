"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";

import { MESSAGE_POLICIES, type MessagePolicy } from "@/lib/chat/types";

// Selector de quién puede abrirme un DM. Cuatro niveles en vez de un on/off: la
// mayoría de creadores no quiere "todos o nadie", quiere filtrar.
//
// Estética calcada del selector de visibilidad del compositor de lives: filas
// separadas por un divisor (sin caja), título + descripción a la izquierda y el
// radio a la derecha. Así el patrón de "elegir quién ve / quién puede" se ve
// igual en todo el producto.
//
// A diferencia de aquel, aquí son <button> con semántica de radio real: se
// navega con teclado y lo anuncia el lector de pantalla. Visualmente idéntico.

const OPTION_LABEL_KEY: Record<MessagePolicy, string> = {
  everyone: "messagePolicyEveryone",
  following_and_followers: "messagePolicyFollowingAndFollowers",
  following: "messagePolicyFollowing",
  none: "messagePolicyNone",
};

const MESSAGE_POLICY_HELP_KEY: Record<MessagePolicy, string> = {
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

  const rowStyle = (isLast: boolean): CSSProperties => ({
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 2px",
    background: "transparent",
    border: "none",
    borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.08)",
    borderRadius: 0,
    textAlign: "left",
    cursor: disabled ? "not-allowed" : "pointer",
    userSelect: "none",
    fontFamily: "inherit",
    WebkitTapHighlightColor: "transparent",
  });

  return (
    <>
      <style jsx>{`
        .vibra-policy-radio {
          transition: transform 160ms ease;
        }
        @media (hover: hover) {
          .vibra-policy-radio:hover {
            transform: scale(1.02);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vibra-policy-radio,
          .vibra-policy-radio:hover {
            transition: none;
            transform: none;
          }
        }
      `}</style>

      <div
        role="radiogroup"
        aria-label={tProfile("messagePolicyLabel")}
        style={{ width: "100%", opacity: disabled ? 0.5 : 1 }}
      >
        {MESSAGE_POLICIES.map((policy, index) => {
          const active = value === policy;
          const isLast = index === MESSAGE_POLICIES.length - 1;

          return (
            <button
              key={policy}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              className="vibra-policy-radio"
              onClick={() => {
                if (disabled || active) return;
                onChange(policy);
              }}
              style={rowStyle(isLast)}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                  }}
                >
                  {tProfile(OPTION_LABEL_KEY[policy])}
                </span>
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "rgba(255,255,255,0.4)",
                    marginTop: 2,
                    lineHeight: 1.4,
                  }}
                >
                  {tProfile(MESSAGE_POLICY_HELP_KEY[policy])}
                </span>
              </span>

              <span
                aria-hidden
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  border: `2px solid ${active ? "#a855f7" : "rgba(255,255,255,0.25)"}`,
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  boxSizing: "border-box",
                }}
              >
                {active ? (
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "#a855f7",
                    }}
                  />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
