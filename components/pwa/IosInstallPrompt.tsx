"use client";

/**
 * Añadir Vibra a la pantalla de inicio, en iPhone y iPad.
 *
 * 🚨 Aquí NO hay botón que instale, y no es una carencia del código.
 *
 * Safari no emite el evento de instalación ni expone ninguna API para pedirla:
 * en Apple, instalar es un gesto que solo puede hacer la persona, a mano, desde
 * el menú Compartir. Lo único que se puede hacer desde aquí es explicarlo bien.
 * De ahí que este aviso sea un instructivo y el de Android un botón.
 *
 * ⚠️ Y no es cosmético. En iPhone, los avisos push SOLO funcionan si la app está
 * en la pantalla de inicio; en Safari a secas no llegan nunca, se configure lo
 * que se configure. Así que todo el trabajo de notificaciones no le sirve de
 * nada a un usuario de iPhone que no haya pasado por aquí. Este aviso es el
 * requisito de aquello, no un extra de crecimiento.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { usePwaInstalled } from "@/lib/hooks/usePwaInstalled";
import { aplazar, puedePreguntar } from "@/lib/pwa/aplazarAviso";

/** Clave propia: posponer este aviso no calla al de Android, ni al revés. */
const CLAVE_APLAZADO = "vibra:iosInstallPromptAplazado";

/** El glifo de Compartir de iOS, para que el paso 1 se reconozca sin leerlo. */
function IconoCompartir() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "inline-block", verticalAlign: "-2px", flexShrink: 0 }}
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 12H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

export default function IosInstallPrompt() {
  const t = useTranslations("iosInstallPrompt");
  const { instalada, plataforma } = usePwaInstalled();

  /** Se cerró en esta visita. Lo de localStorage lo lleva `puedePreguntar`. */
  const [cerrado, setCerrado] = useState(false);

  /**
   * ⚠️ Se calcula al pintar, sin efecto ni estado derivado.
   *
   * El orden del `&&` no es casual. `instalada` vale `null` hasta que hidrata,
   * así que en el servidor y en la primera pintada la condición se corta ANTES
   * de llegar a `puedePreguntar`, que lee `localStorage` y ahí no existe. Eso
   * evita de un plumazo las dos trampas: leer el navegador en el servidor, y
   * enseñarle el instructivo un fotograma a quien ya tiene la app puesta.
   */
  const visible =
    !cerrado &&
    instalada === false &&
    plataforma === "ios" &&
    puedePreguntar(CLAVE_APLAZADO);

  function noAhora() {
    aplazar(CLAVE_APLAZADO);
    setCerrado(true);
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        // La misma altura que el aviso de Android. Nunca coinciden —o es un
        // aparato de Apple o no lo es—, así que compartir sitio es coherente.
        bottom: "calc(154px + var(--vb-safe-bottom, 0px))",
        zIndex: 150,
        width: "min(420px, calc(100vw - 24px))",
        boxSizing: "border-box",
        padding: 14,
        borderRadius: 14,
        border: "1px solid rgba(168,85,255,0.45)",
        background: "rgba(14,10,28,0.96)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 18px 48px rgba(0,0,0,0.55)",
        color: "#fff",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            width: 36,
            height: 36,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "rgba(168,85,255,0.16)",
            color: "#a855f7",
          }}
        >
          <IconoCompartir />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>{t("title")}</div>
          <div
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.35,
              marginTop: 2,
            }}
          >
            {t("body")}
          </div>
        </div>
      </div>

      {/* Los dos pasos, numerados. Es lo único que puede hacer este aviso, así
          que se dicen enteros en vez de insinuarlos. */}
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 6,
          fontSize: 12.5,
          color: "rgba(255,255,255,0.88)",
          lineHeight: 1.35,
        }}
      >
        {[t("step1"), t("step2")].map((paso, i) => (
          <li key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                flex: "0 0 auto",
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "rgba(168,85,255,0.22)",
                color: "#c99bf5",
                fontSize: 10.5,
                fontWeight: 700,
                display: "grid",
                placeItems: "center",
              }}
            >
              {i + 1}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              {paso}
              {/* El glifo va junto al paso que lo menciona, no suelto. */}
              {i === 0 ? (
                <span style={{ color: "#c99bf5", display: "flex" }}>
                  <IconoCompartir />
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={noAhora}
          style={{
            appearance: "none",
            border: "none",
            background: "transparent",
            color: "rgba(255,255,255,0.7)",
            fontSize: 13,
            fontFamily: "inherit",
            padding: "8px 10px",
            cursor: "pointer",
          }}
        >
          {t("later")}
        </button>
      </div>
    </div>
  );
}
