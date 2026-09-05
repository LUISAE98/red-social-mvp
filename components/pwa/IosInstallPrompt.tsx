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
import PanelModal from "./PanelModal";

/** Clave propia: posponer este aviso no calla al de Android, ni al revés. */
const CLAVE_APLAZADO = "vibra:iosInstallPromptAplazado";

/** El glifo de Compartir de iOS, para que el paso 1 se reconozca sin leerlo. */
function IconoCompartir({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}
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
    <PanelModal
      titulo={t("title")}
      cuerpo={t("body")}
      textoDescartar={t("later")}
      onDescartar={noAhora}
      icono={<IconoCompartir />}
    >
      {/* Los dos pasos, numerados. Es lo único que puede hacer este aviso, así
          que se dicen enteros en vez de insinuarlos. */}
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 8,
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
                color: "#d8b4fe",
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
                <span style={{ color: "#d8b4fe", display: "flex" }}>
                  <IconoCompartir size={13} />
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </PanelModal>
  );
}
