"use client";

/**
 * Ofrecer instalar la app, en Android y en Chrome de escritorio.
 *
 * 🚨 Este componente NO es opcional una vez que se usa `usePwaInstallPrompt`.
 *
 * Ese hook llama a `preventDefault()` sobre el evento del navegador, y eso APAGA
 * la barra que Chrome saca por su cuenta. O sea: capturar el evento y no pintar
 * nada dejaría el producto PEOR que antes de tocarlo — sin la barra del
 * navegador y sin nada nuestro. Los dos van juntos.
 *
 * En iPhone no aparece nunca, y no por decisión nuestra: Safari no emite ese
 * evento ni deja instalar desde código. Ahí hace falta un aviso distinto, que
 * explique el gesto de "Compartir → Añadir a pantalla de inicio".
 */

import { useState } from "react";
import { useTranslations } from "next-intl";

import { usePwaInstalled } from "@/lib/hooks/usePwaInstalled";
import { usePwaInstallPrompt } from "@/lib/hooks/usePwaInstallPrompt";
import { aplazar, puedePreguntar, CADENCIA_INSTALAR } from "@/lib/pwa/aplazarAviso";
import PanelModal from "./PanelModal";

/** Cuándo se pospuso por última vez. Vuelve cada 6 h hasta que se instale. */
const CLAVE_APLAZADO = "vibra:installPromptAplazado";

export default function InstallAppPrompt() {
  const t = useTranslations("installPrompt");
  const { instalada } = usePwaInstalled();
  const { puedeInstalar, instalar } = usePwaInstallPrompt();

  /** Se cerró en esta visita. Lo de localStorage lo lleva `puedePreguntar`. */
  const [cerrado, setCerrado] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  /**
   * ⚠️ Se calcula al pintar, sin efecto ni estado derivado.
   *
   * El orden del `&&` no es casual. `instalada` vale `null` hasta que hidrata,
   * así que en el servidor y en la primera pintada la condición se corta ANTES
   * de llegar a `puedePreguntar`, que lee `localStorage` y ahí no existe. Eso
   * evita de un plumazo las dos trampas: leer el navegador en el servidor, y
   * enseñarle el aviso un fotograma a quien ya tiene la app puesta.
   */
  const visible =
    !cerrado &&
    instalada === false &&
    puedeInstalar &&
    puedePreguntar(CLAVE_APLAZADO, CADENCIA_INSTALAR);

  function noAhora() {
    aplazar(CLAVE_APLAZADO);
    setCerrado(true);
  }

  async function aceptar() {
    if (trabajando) return;
    setTrabajando(true);
    try {
      const resultado = await instalar();
      // Rechazar el diálogo nativo cuenta como aplazar: se respeta el "no" y no
      // se vuelve a insistir hasta pasadas las dos semanas.
      if (resultado !== "aceptada") aplazar(CLAVE_APLAZADO);
    } finally {
      setTrabajando(false);
      setCerrado(true);
    }
  }

  if (!visible) return null;

  return (
    <PanelModal
      titulo={t("title")}
      cuerpo={t("body")}
      textoDescartar={t("later")}
      onDescartar={noAhora}
      accion={{ texto: t("install"), onClick: () => void aceptar(), ocupado: trabajando }}
      icono={
        /* Teléfono con una flecha entrando: instalar en el aparato. */
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17 1H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2Zm-5 20.5a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4ZM17 18H7V4h10Z" />
          <path d="M12 6a.9.9 0 0 1 .9.9v4.7l1.5-1.5a.9.9 0 1 1 1.3 1.3l-3 3a.9.9 0 0 1-1.3 0l-3-3a.9.9 0 0 1 1.3-1.3l1.4 1.5V6.9A.9.9 0 0 1 12 6Z" />
        </svg>
      }
    >
      {/* Qué GANA instalando, no qué es una PWA.
          Van con palomita y no numerados: son tres ventajas sueltas, no un
          procedimiento — numerarlas diría que hay que hacerlas en orden.
          Y las tres son verificables: el service worker precachea de verdad,
          así que lo de arrancar con mala señal no es una promesa vacía. */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 7 }}>
        {[t("benefit1"), t("benefit2"), t("benefit3")].map((ventaja) => (
          <li
            key={ventaja}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              fontSize: 12.5,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.88)",
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#d8b4fe"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ flexShrink: 0, marginTop: 1.5 }}
            >
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
            <span>{ventaja}</span>
          </li>
        ))}
      </ul>
    </PanelModal>
  );
}
