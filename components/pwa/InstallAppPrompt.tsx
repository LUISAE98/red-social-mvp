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
import { aplazar, puedePreguntar } from "@/lib/pwa/aplazarAviso";

/** Cuándo se pospuso por última vez y cuántas veces se ha pospuesto ya. */
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
    puedePreguntar(CLAVE_APLAZADO);

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
    <div
      role="dialog"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        // Por encima del de notificaciones, que vive a 86px: si algún día
        // coincidieran, se leerían como dos tarjetas y no como una encima de otra.
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
          }}
        >
          {/* Teléfono con una flecha entrando: instalar en el aparato. */}
          <svg width="20" height="20" viewBox="0 0 24 24" style={{ display: "block" }}>
            <path
              fill="#a855f7"
              d="M17 1H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2Zm-5 20.5a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4ZM17 18H7V4h10Z"
            />
            <path
              fill="#a855f7"
              d="M12 6a.9.9 0 0 1 .9.9v4.7l1.5-1.5a.9.9 0 1 1 1.3 1.3l-3 3a.9.9 0 0 1-1.3 0l-3-3a.9.9 0 0 1 1.3-1.3l1.4 1.5V6.9A.9.9 0 0 1 12 6Z"
            />
          </svg>
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

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
        <button
          type="button"
          onClick={() => void aceptar()}
          disabled={trabajando}
          style={{
            appearance: "none",
            border: "none",
            borderRadius: 10,
            background: "#a855f7",
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: "inherit",
            padding: "8px 16px",
            cursor: trabajando ? "default" : "pointer",
            opacity: trabajando ? 0.7 : 1,
          }}
        >
          {t("install")}
        </button>
      </div>
    </div>
  );
}
