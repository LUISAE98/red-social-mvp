"use client";

import VibraResponsivePanel from "./VibraResponsivePanel";

/**
 * Panel de confirmación de Vibra. Sustituye a `window.confirm`.
 *
 * Una pregunta no es un aviso: necesita dos botones y una respuesta, así que no
 * cabe en el toast ni bajo un campo. Y el diálogo del sistema operativo rompe el
 * diseño oscuro por completo, además de no dejar cambiar ni el texto de los
 * botones ni el idioma.
 *
 * Formaliza el patrón que ya usaba el diálogo de quitar conversación del chat:
 * cancelar a la izquierda y en gris, confirmar a la derecha y con color. El
 * orden importa — con el destructivo a la derecha, el pulgar que va rápido cae
 * antes en cancelar.
 */

export type ConfirmTone = "danger" | "neutral";

export default function ConfirmPanel({
  open,
  onClose,
  onConfirm,
  title,
  body,
  highlight,
  confirmLabel,
  cancelLabel,
  tone = "danger",
  busy = false,
  zIndexBase,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** La pregunta, corta. Va en la cabecera. */
  title: string;
  /** Qué implica decir que sí. Opcional pero casi siempre vale la pena. */
  body?: string;
  /**
   * Dato que hay que leer sí o sí antes de confirmar: un importe, un nombre.
   * Se destaca aparte porque dentro de una frase se pasa por alto.
   */
  highlight?: string;
  confirmLabel: string;
  cancelLabel: string;
  /**
   * `danger` para lo que destruye o no se puede deshacer —bloquear, banear,
   * expulsar, cerrar sesiones, reembolsar—. `neutral` para el resto.
   */
  tone?: ConfirmTone;
  /** Mientras la acción va en camino: bloquea los dos botones. */
  busy?: boolean;
  /** Subir cuando el panel se abre desde otro modal que ya está más alto. */
  zIndexBase?: number;
}) {
  const buttonBase: React.CSSProperties = {
    flex: 1,
    minHeight: 37,
    borderRadius: 10,
    border: "none",
    fontSize: 14,
    fontFamily: "inherit",
    cursor: busy ? "not-allowed" : "pointer",
  };

  return (
    <VibraResponsivePanel
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      /* Centrado también en celular. Una pestaña a media pantalla para una
         pregunta de dos botones se siente desproporcionada. */
      mobileVariant="centered"
      maxWidthDesktop={420}
      zIndexBase={zIndexBase}
      footer={
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              ...buttonBase,
              background: "rgba(255,255,255,0.10)",
              color: "#fff",
              fontWeight: 500,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              ...buttonBase,
              // Morado liso, no el degradado de marca: ese es del botón que
              // empuja hacia adelante —guardar, publicar—, y aquí la acción es
              // deshacer algo. Mismo peso visual, otra intención.
              background: tone === "danger" ? "#ef4444" : "#a855f7",
              color: "#fff",
              fontWeight: 600,
              opacity: busy ? 0.7 : 1,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 10 }}>
        {body ? (
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.7)",
            }}
          >
            {body}
          </p>
        ) : null}

        {highlight ? (
          <div
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              fontSize: 15,
              fontWeight: 650,
              letterSpacing: "-0.01em",
              textAlign: "center",
            }}
          >
            {highlight}
          </div>
        ) : null}
      </div>
    </VibraResponsivePanel>
  );
}
