"use client";

import { useState } from "react";

import WheelPanel from "./WheelPanel";

/**
 * Campo de opciones con el MISMO panel de tambores que la fecha y la hora.
 *
 * Es una rueda de una sola columna. Sustituye a los `<select>` del sistema en
 * las listas de categorías —sexo, visibilidad, categoría de comunidad, quién
 * puede publicar— para que todos los selectores de Vibra se abran igual: mismo
 * panel, mismo gesto, mismo botón de guardar.
 *
 * El campo enseña lo elegido; al pulsarlo se abre la rueda. Girar no cambia
 * nada hasta confirmar, así que cerrar sin guardar deja la opción como estaba.
 */

export type PanelOption = {
  value: string;
  label: string;
};

export default function OptionWheelPanel({
  value,
  onChange,
  options,
  title,
  confirmLabel,
  closeAriaLabel,
  disabled,
  placeholder,
  zIndexBase,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PanelOption[];
  title: string;
  confirmLabel: string;
  closeAriaLabel: string;
  disabled?: boolean;
  /** Qué se enseña cuando no hay nada elegido. */
  placeholder?: string;
  /** Subir cuando el campo vive dentro de otro modal que ya está más alto. */
  zIndexBase?: number;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Borrador propio, igual que en el panel de fecha: girar la rueda no toca el
   * formulario hasta confirmar. Se rehace al cerrar sin guardar.
   */
  const [draft, setDraft] = useState(value);

  const elegida = options.find((o) => o.value === value);

  function abrir() {
    setDraft(value || options[0]?.value || "");
    setOpen(true);
  }

  function cerrar() {
    setDraft(value);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        disabled={disabled}
        style={{
          width: "100%",
          borderRadius: 12,
          border: "none",
          backgroundColor: "rgba(255,255,255,0.11)",
          color: elegida ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.45)",
          padding: "10px 12px",
          fontSize: 13,
          fontWeight: 400,
          fontFamily: "inherit",
          lineHeight: 1.5,
          textAlign: "start",
          outline: "none",
          boxSizing: "border-box",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.55 : 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {elegida?.label ?? placeholder ?? ""}
      </button>

      <WheelPanel
        open={open}
        onClose={cerrar}
        onConfirm={() => {
          onChange(draft);
          setOpen(false);
        }}
        title={title}
        confirmLabel={confirmLabel}
        closeAriaLabel={closeAriaLabel}
        zIndexBase={zIndexBase}
        columns={[
          {
            key: "option",
            label: title,
            items: options,
            value: draft,
            onChange: setDraft,
          },
        ]}
      />
    </>
  );
}
