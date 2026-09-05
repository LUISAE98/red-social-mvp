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

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

/**
 * Lo que tarda en irse. ⚠️ Tiene que cuadrar con `vbPanelSale` y `vbVeloSale`
 * del CSS de abajo: si el temporizador fuera más corto, el componente se
 * desmontaría a media animación y volvería el corte seco que esto viene a
 * quitar.
 */
const SALIDA_MS = 200;

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

  /**
   * La salida la gobierna el propio modal, no quien lo usa.
   *
   * ⚠️ Antes, descartar ponía a `false` la condición del padre y el componente
   * desaparecía en el mismo fotograma: panel y velo se cortaban en seco. Ahora
   * se enciende `saliendo`, corre la animación, y solo al terminar se avisa al
   * padre para que desmonte. Los tres avisos lo heredan sin tocar nada.
   */
  const [saliendo, setSaliendo] = useState(false);
  const temporizador = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    };
  }, []);

  function cerrarConSalida() {
    // Dos pulsaciones seguidas no encadenan dos temporizadores.
    if (saliendo) return;
    setSaliendo(true);
    temporizador.current = window.setTimeout(onDescartar, SALIDA_MS);
  }

  // Escape cierra, como cualquier diálogo. Sin esto, con teclado no había salida.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarConSalida();
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saliendo, onDescartar]);

  return (
    <div
      className="vb-panel-velo"
      data-saliendo={saliendo ? "" : undefined}
      // Cerrar tocando fuera. Solo si el toque nace Y muere en el velo, para que
      // arrastrar desde dentro del panel hacia fuera no lo cierre sin querer.
      onClick={(e) => {
        if (e.target === e.currentTarget) cerrarConSalida();
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
      <style jsx>{`
        /* Entrada y salida, en animaciones y no en transiciones: una animación
           arranca sola al montar, sin necesidad de un estado "ya monté" que el
           lint de este repo prohíbe escribir dentro de un efecto. */
        .vb-panel-velo {
          animation: vbVeloEntra 220ms var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)) both;
        }
        .vb-panel-velo[data-saliendo] {
          animation: vbVeloSale ${SALIDA_MS}ms var(--ease-smooth, cubic-bezier(0.4, 0, 0.2, 1)) both;
        }
        .vb-panel-caja {
          animation: vbPanelEntra 260ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
        }
        .vb-panel-velo[data-saliendo] .vb-panel-caja {
          animation: vbPanelSale ${SALIDA_MS}ms var(--ease-in, cubic-bezier(0.4, 0, 1, 1)) both;
        }

        @keyframes vbVeloEntra {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes vbVeloSale {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        /* Entra creciendo desde un pelo abajo; sale encogiendo un poco. No al
           revés: agrandar al salir se lee como que algo se rompió. */
        @keyframes vbPanelEntra {
          from { opacity: 0; transform: scale(0.94) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes vbPanelSale {
          from { opacity: 1; transform: scale(1) translateY(0); }
          to { opacity: 0; transform: scale(0.96) translateY(6px); }
        }

        @media (prefers-reduced-motion: reduce) {
          .vb-panel-velo,
          .vb-panel-velo[data-saliendo],
          .vb-panel-caja,
          .vb-panel-velo[data-saliendo] .vb-panel-caja {
            animation: none;
          }
        }
      `}</style>

      <div
        className="vb-panel-caja"
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
            onClick={cerrarConSalida}
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
              onClick={() => { setSaliendo(true); accion.onClick(); }}
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
