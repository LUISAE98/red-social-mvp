"use client";

import VibraResponsivePanel from "./VibraResponsivePanel";
import WheelColumn, { WHEEL_HEIGHT, type WheelItem } from "./WheelColumn";

/**
 * Panel de tambores genérico: N columnas, las que hagan falta.
 *
 * Es la base de todos los selectores de rueda de Vibra. Quien lo monta decide
 * cuántas columnas hay y qué lleva cada una —fecha, hora, fecha y hora juntas—,
 * así que no sabe nada de días ni de meses; eso vive en quien lo llama.
 *
 * Comparte con el resto de paneles el velo, el arrastre, el bloqueo de scroll,
 * el foco y la salida con Esc, pero se presenta sin caja y sin tache: lo que
 * flota son las ruedas.
 */

export type WheelPanelColumn = {
  key: string;
  /** Encabezado de la columna. */
  label: string;
  items: WheelItem[];
  value: string;
  onChange: (value: string) => void;
  /** La rueda da la vuelta. Solo para listas cíclicas de verdad, como los meses. */
  loop?: boolean;
  /** Peso de la columna dentro de la fila. Por omisión, todas iguales. */
  flex?: number;
};

export default function WheelPanel({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  closeAriaLabel,
  columns,
  confirmDisabled,
  footerNote,
  zIndexBase,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  confirmLabel: string;
  closeAriaLabel: string;
  columns: WheelPanelColumn[];
  /** Para cuando lo elegido todavía no vale (una fecha ya pasada, por ejemplo). */
  confirmDisabled?: boolean;
  /** Aviso corto bajo las ruedas; se usa para decir por qué no se puede guardar. */
  footerNote?: string | null;
  /** Subir cuando el panel se abre desde otro modal que ya esta mas alto. */
  zIndexBase?: number;
}) {
  const template = columns.map((c) => `${c.flex ?? 1}fr`).join(" ");

  return (
    <VibraResponsivePanel
      open={open}
      onClose={onClose}
      title={title}
      closeAriaLabel={closeAriaLabel}
      maxWidthDesktop={columns.length > 3 ? 500 : 420}
      // Sin caja: las ruedas y el botón flotan sobre el velo.
      bareSurface
      // Sin tache: se sale tocando fuera o con Esc.
      hideCloseButton
      /* Centrado también en celular. Los tambores tienen alto fijo y no crecen
         con el contenido, así que una pestaña a media pantalla queda
         desproporcionada. */
      mobileVariant="centered"
      zIndexBase={zIndexBase}
      footer={
        <div style={{ display: "grid", gap: 8, justifyItems: "center" }}>
          {footerNote ? (
            <span
              style={{
                fontSize: 11,
                lineHeight: 1.35,
                color: "rgba(248,113,113,0.92)",
                textAlign: "center",
              }}
            >
              {footerNote}
            </span>
          ) : null}

          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            style={{
              width: "min(240px, 100%)",
              minHeight: 42,
              borderRadius: 5,
              border: "none",
              background: confirmDisabled
                ? "rgba(255,255,255,0.16)"
                : "linear-gradient(100deg, #ff2fb3 0%, #a855f7 35%, #4f46ff 70%)",
              color: confirmDisabled ? "rgba(255,255,255,0.6)" : "#fff",
              fontWeight: 600,
              fontSize: 13,
              fontFamily: "inherit",
              display: "grid",
              placeItems: "center",
              cursor: confirmDisabled ? "default" : "pointer",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: template,
            gap: 4,
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: "0.04em",
            color: "rgba(255,255,255,0.42)",
            textAlign: "center",
          }}
        >
          {columns.map((c) => (
            <span key={c.key}>{c.label}</span>
          ))}
        </div>

        {/* Sin banda en el centro. Lo que marca el valor elegido es el propio
            renglón: va en blanco y más grueso, mientras los de alrededor quedan
            grises y se apagan hacia los extremos. */}
        <div
          style={{
            height: WHEEL_HEIGHT,
            display: "grid",
            gridTemplateColumns: template,
            gap: 4,
          }}
        >
          {columns.map((c) => (
            <WheelColumn
              key={c.key}
              items={c.items}
              value={c.value}
              onChange={c.onChange}
              ariaLabel={c.label}
              loop={c.loop}
            />
          ))}
        </div>
      </div>
    </VibraResponsivePanel>
  );
}
