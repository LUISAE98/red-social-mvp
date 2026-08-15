"use client";

import { useTranslations } from "next-intl";

import {
  normalizeSocialHandle,
  socialProfileUrl,
  SOCIAL_HANDLE_MAX,
  SOCIAL_NETWORK_IDS,
  SOCIAL_NETWORKS,
  type SocialLinks,
  type SocialNetworkId,
} from "@/lib/profile/socialNetworks";
import SocialIcon from "./SocialIcon";

/**
 * Los seis campos de redes, uno por red del catálogo.
 *
 * Es el mismo componente en el alta y en los ajustes del perfil, para que las
 * dos pantallas acepten y limpien exactamente lo mismo. Trabaja sobre el texto
 * TAL CUAL lo escriben —sin limpiarlo mientras teclean, que se siente como que
 * el campo pelea— y avisa por debajo cuando lo escrito todavía no sirve. La
 * limpieza de verdad ocurre al guardar.
 */
export default function SocialLinksEditor({
  value,
  onChange,
  disabled,
}: {
  /** Texto crudo por red, tal como va en los campos. */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const tProfile = useTranslations("profile");

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {SOCIAL_NETWORK_IDS.map((id) => {
        const raw = value[id] ?? "";
        const clean = normalizeSocialHandle(id, raw);
        const invalid = raw.trim().length > 0 && clean === null;
        const net = SOCIAL_NETWORKS[id];

        return (
          <label key={id} style={{ display: "grid", gap: 4 }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 28,
                  height: 28,
                  flexShrink: 0,
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.72)",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.10)",
                }}
              >
                <SocialIcon id={id} size={16} />
              </span>

              <input
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                disabled={disabled}
                value={raw}
                maxLength={200}
                onChange={(e) => onChange({ ...value, [id]: e.target.value })}
                // El principio de la liga, tal cual. Enseña la forma sin
                // depender del idioma y deja claro que pegar la liga completa
                // también vale.
                placeholder={net.urlPrefix}
                aria-label={net.label}
                aria-invalid={invalid || undefined}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 36,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: `1px solid ${
                    invalid ? "rgba(248,113,113,0.55)" : "rgba(255,255,255,0.12)"
                  }`,
                  background: "rgba(255,255,255,0.04)",
                  color: "#fff",
                  fontFamily: "inherit",
                  fontSize: 13,
                  outline: "none",
                }}
              />
            </span>

            {/* La liga que va a quedar, en cuanto lo escrito sirve. Es la
                respuesta a "¿y esto qué va a hacer?" sin tener que guardar y
                salir a verlo al perfil. */}
            {invalid ? (
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.3,
                  color: "rgba(248,113,113,0.9)",
                  paddingInlineStart: 36,
                }}
              >
                {tProfile("socialHandleInvalid", { network: net.label })}
              </span>
            ) : clean ? (
              <span
                style={{
                  fontSize: 11,
                  lineHeight: 1.3,
                  color: "rgba(255,255,255,0.45)",
                  paddingInlineStart: 36,
                  wordBreak: "break-all",
                }}
              >
                {socialProfileUrl(id, clean).replace(/^https:\/\//, "")}
              </span>
            ) : null}
          </label>
        );
      })}

      <span
        style={{
          fontSize: 11,
          lineHeight: 1.35,
          color: "rgba(255,255,255,0.45)",
        }}
      >
        {tProfile("socialLinksHint")}
      </span>
    </div>
  );
}

/** Los campos como texto, a partir de lo que ya está guardado. */
export function socialLinksToDraft(links: SocialLinks | null | undefined) {
  const draft: Record<string, string> = {};
  for (const id of SOCIAL_NETWORK_IDS) draft[id] = links?.[id] ?? "";
  return draft;
}

/** ¿Hay algo escrito que no sirva? Para no dejar guardar a medias. */
export function draftHasInvalidHandle(draft: Record<string, string>) {
  return SOCIAL_NETWORK_IDS.some((id: SocialNetworkId) => {
    const raw = draft[id] ?? "";
    return raw.trim().length > 0 && normalizeSocialHandle(id, raw) === null;
  });
}

export { SOCIAL_HANDLE_MAX };
