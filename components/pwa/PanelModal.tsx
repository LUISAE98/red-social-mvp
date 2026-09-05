"use client";

/**
 * El marco de los avisos de instalación y de notificaciones.
 *
 * 🚨 Va CENTRADO y con todo el fondo desenfocado, no abajo.
 *
 * Abajo competía con la barra de navegación y con el compositor, y ahí un aviso
 * se lee como algo secundario que se puede ignorar — que es justo lo que pasaba.
 * En el centro, y con la pantalla difuminada detrás, es lo único que hay que
 * atender. Es una decisión deliberada de producto, no un estilo.
 *
 * Vive aparte porque lo comparten los tres avisos y son el mismo objeto con
 * distinto contenido. Duplicar el marco tres veces garantizaba que en el
 * siguiente retoque se quedara uno atrás.
 */

import { useEffect, type ReactNode } from "react";

import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

export type PanelModalProps = {
  /** Icono del encabezado. Va sobre el degradado de marca. */
  icono: ReactNode;
  titulo: string;
  cuerpo: string;
  /** Lo que va entre el texto y los botones. Solo lo usa el instructivo de iOS. */
  children?: ReactNode;
  /** Texto del botón que descarta. */
  textoDescartar: string;
  onDescartar: () => void;
  /** Botón principal. El instructivo de iOS no tiene, porque no hay nada que pulsar. */
  accion?: { texto: string; onClick: () => void; ocupado?: boolean };
};

export default function PanelModal({
  icono,
  titulo,
  cuerpo,
  children,
  textoDescartar,
  onDescartar,
  accion,
}: PanelModalProps) {
  // El fondo no se scrollea por detrás del velo. Es el hook único del proyecto,
  // que cuenta referencias y sabe soltar el bloqueo solo al cerrarse el último.
  useBodyScrollLock(true);

  // Escape cierra, como cualquier diálogo. Sin esto, con teclado no había salida.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDescartar();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onDescartar]);

  return (
    <div
      // Cerrar tocando fuera. Solo si el toque nace Y muere en el velo, para que
      // arrastrar desde dentro del panel hacia fuera no lo cierre sin querer.
      onClick={(e) => {
        if (e.target === e.currentTarget) onDescartar();
      }}
      style={{
        position: "fixed",
        inset: 0,
        // `inset: 0` se resuelve contra el área de dibujo, que en la PWA de
        // iPhone mide menos que la pantalla. Sin el alto, el velo se queda 62px
        // corto: el desenfoque no llega abajo y lo centrado sale desviado.
        height: "var(--vb-alto-pantalla)",
        /**
         * ⚠️ Por encima de la barra inferior (9999). Con un valor menor, la barra
         * se quedaba nítida flotando sobre el fondo ya desenfocado y el efecto se
         * rompía entero.
         */
        zIndex: 10001,
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "rgba(6,4,12,0.55)",
        backdropFilter: "blur(9px)",
        WebkitBackdropFilter: "blur(9px)",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        style={{
          width: "min(360px, 100%)",
          boxSizing: "border-box",
          borderRadius: 20,
          background: "#14101f",
          // Sin borde de color: el contorno tenue y la sombra bastan para
          // despegarlo, y el morado se gasta entero en el icono y el botón.
          boxShadow:
            "0 24px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(168,85,255,0.18)",
          color: "#fff",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 18px 0" }}>
          <span
            aria-hidden="true"
            style={{
              flex: "0 0 auto",
              width: 42,
              height: 42,
              borderRadius: 13,
              display: "grid",
              placeItems: "center",
              // El único sitio donde se gasta color de verdad.
              background: "linear-gradient(140deg, #ec4899, #a855f7)",
              color: "#fff",
            }}
          >
            {icono}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {titulo}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "rgba(255,255,255,0.7)",
                lineHeight: 1.35,
                marginTop: 4,
              }}
            >
              {cuerpo}
            </div>
          </div>
        </div>

        {children ? <div style={{ padding: "12px 18px 0" }}>{children}</div> : null}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "14px 18px 16px",
          }}
        >
          <button
            type="button"
            onClick={onDescartar}
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
            {textoDescartar}
          </button>

          {accion ? (
            <button
              type="button"
              onClick={accion.onClick}
              disabled={accion.ocupado}
              style={{
                appearance: "none",
                border: "none",
                borderRadius: 999,
                background: "linear-gradient(135deg, #ec4899, #a855f7)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "inherit",
                padding: "10px 20px",
                cursor: accion.ocupado ? "default" : "pointer",
                opacity: accion.ocupado ? 0.7 : 1,
              }}
            >
              {accion.texto}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
