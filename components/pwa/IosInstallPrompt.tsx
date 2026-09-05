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
import { aplazar, puedePreguntar, CADENCIA_INSTRUCTIVO } from "@/lib/pwa/aplazarAviso";
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

/** Marco común de los dos dibujos, para que se lean como dos capturas. */
const MAQUETA: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.09)",
  borderRadius: 10,
  overflow: "hidden",
};

/** Lo que está APAGADO en el dibujo: presente para dar contexto, sin llamar. */
const APAGADO = "rgba(255,255,255,0.28)";

/** El número del paso. */
function Paso({ n }: { n: number }) {
  return (
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
      {n}
    </span>
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
    puedePreguntar(CLAVE_APLAZADO, CADENCIA_INSTRUCTIVO);

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
      {/* ⚠️ Lo de Safari va PRIMERO y destacado, no dentro del texto corrido.
          Desde Chrome o Firefox de iPhone estos dos pasos existen pero no dejan
          una app de verdad, así que quien lo intente desde ahí se queda a medias
          creyendo que lo hizo bien. Es el requisito, no una nota al pie. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 10px",
          marginBottom: 12,
          borderRadius: 9,
          background: "rgba(168,85,255,0.14)",
          border: "1px solid rgba(168,85,255,0.28)",
          fontSize: 12,
          fontWeight: 600,
          color: "#e9d5ff",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"
             style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M12 11.5v4.5" />
        </svg>
        {t("safariOnly")}
      </div>

      {/* Los dos pasos, DIBUJADOS. Decirlos con palabras obligaba a traducir del
          texto a la pantalla; enseñando dónde hay que tocar, no hay que traducir
          nada. */}
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
        <li style={{ display: "grid", gap: 6 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: "rgba(255,255,255,0.88)",
            }}
          >
            <Paso n={1} />
            {t("step1")}
          </span>

          {/* La barra de abajo de Safari, con el botón de Compartir señalado.
              Los otros cuatro iconos van apagados: están para que se reconozca
              la barra, no para que se miren. */}
          <div
            aria-hidden="true"
            style={{
              ...MAQUETA,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-around",
              padding: "8px 12px",
              color: APAGADO,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>

            {/* El señalado. Anillo morado y un punto más grande. */}
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 28,
                height: 28,
                borderRadius: 9,
                color: "#fff",
                background: "rgba(168,85,255,0.30)",
                boxShadow: "0 0 0 2px #a855f7",
              }}
            >
              <IconoCompartir size={15} />
            </span>

            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h7v15H4zM13 5h7v15h-7z" />
            </svg>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="7" height="7" rx="1.5" />
              <rect x="13" y="13" width="7" height="7" rx="1.5" />
            </svg>
          </div>
        </li>

        <li style={{ display: "grid", gap: 6 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: "rgba(255,255,255,0.88)",
            }}
          >
            <Paso n={2} />
            {t("step2")}
          </span>

          {/* La hoja de compartir, con la fila que hay que tocar encendida y su
              texto EXACTO, en el idioma en que iOS se lo va a enseñar. */}
          <div aria-hidden="true" style={MAQUETA}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "8px 11px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <span
                style={{
                  width: 15,
                  height: 15,
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.13)",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  height: 7,
                  width: "45%",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.13)",
                }}
              />
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "9px 11px",
                background: "rgba(168,85,255,0.22)",
                boxShadow: "inset 0 0 0 1.5px #a855f7",
              }}
            >
              {/* Un cuadrado con un más: el icono de "Añadir a pantalla de inicio". */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff"
                   strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                   style={{ flexShrink: 0 }}>
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <path d="M12 8v8M8 12h8" />
              </svg>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#fff" }}>
                {t("addToHomeScreen")}
              </span>
            </div>
          </div>
        </li>
      </ol>
    </PanelModal>
  );
}
