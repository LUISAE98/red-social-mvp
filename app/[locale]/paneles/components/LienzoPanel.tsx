"use client";

/**
 * El contenido de cada pantalla del banco de trabajo.
 *
 * Pinta un fondo que imita una pantalla de la aplicación —hay que ver el panel
 * SOBRE algo, no sobre un vacío gris— y encima monta el panel REAL.
 *
 * El panel se abre solo y no se puede cerrar desde aquí: no se está probando la
 * interacción, se está mirando la superficie. Cerrarlo dejaría la pantalla vacía
 * y habría que recargar el marco para volver a verlo.
 */

import { useState } from "react";

import VibraResponsivePanel from "@/components/ui/VibraResponsivePanel";

export default function LienzoPanel() {
  /* Se abre en el primer render y ahí se queda. El estado existe porque el
     panel lo pide, no porque aquí se vaya a cerrar. */
  const [abierto] = useState(true);

  return (
    <div style={fondo}>
      {/* Contenido de mentira, solo para que el panel tenga algo debajo y se
          aprecie el velo y el desenfoque. Sin esto el panel flota sobre negro y
          no se distingue una superficie translúcida de una opaca. */}
      <div style={cabecera}>Vibra</div>

      <div style={rejillaFondo}>
        {MUESTRAS.map((color, i) => (
          <div key={i} style={{ ...tarjetaFondo, background: color }} />
        ))}
      </div>

      <VibraResponsivePanel
        open={abierto}
        onClose={() => {}}
        title="Título del panel"
        closeAriaLabel="Cerrar"
        footer={
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" style={botonSecundario}>
              Cancelar
            </button>
            <button type="button" style={botonPrincipal}>
              Confirmar
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 14 }}>
          <p style={parrafo}>
            Este es el cuerpo del panel. Sirve para ver cómo caen el texto, los
            campos y los botones dentro de la superficie que estamos diseñando.
          </p>

          <input style={campo} placeholder="Un campo de texto" readOnly />

          <div style={fila}>
            <span style={etiqueta}>Una opción</span>
            <span style={valor}>Su valor</span>
          </div>

          <div style={fila}>
            <span style={etiqueta}>Otra opción</span>
            <span style={valor}>Otro valor</span>
          </div>

          {/* Bastante alto para que el panel llegue a tener scroll: así se ve
              cómo se comporta el borde superior al desplazar el contenido. */}
          <div style={{ height: 220, ...bloqueRelleno }} />
        </div>
      </VibraResponsivePanel>
    </div>
  );
}

/* ── Fondo de mentira ──────────────────────────────────────────────────── */

const MUESTRAS = [
  "linear-gradient(135deg, #7c3aed, #ec4899)",
  "linear-gradient(135deg, #0ea5e9, #22c55e)",
  "linear-gradient(135deg, #f59e0b, #ef4444)",
  "linear-gradient(135deg, #6366f1, #06b6d4)",
  "linear-gradient(135deg, #ec4899, #f59e0b)",
  "linear-gradient(135deg, #22c55e, #a855f7)",
];

const fondo: React.CSSProperties = {
  minHeight: "100dvh",
  background: "#000",
  color: "#fff",
  fontFamily: "inherit",
};

const cabecera: React.CSSProperties = {
  padding: "14px 16px",
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: "-0.02em",
  background: "linear-gradient(90deg, #a855f7, #ec4899)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  color: "transparent",
};

const rejillaFondo: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
  gap: 8,
  padding: "0 12px 24px",
};

const tarjetaFondo: React.CSSProperties = {
  height: 150,
  borderRadius: 14,
};

/* ── Contenido del panel ───────────────────────────────────────────────── */

const parrafo: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.5,
  color: "rgba(255,255,255,0.72)",
};

const campo: React.CSSProperties = {
  width: "100%",
  height: 42,
  borderRadius: 12,
  border: "none",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  fontSize: 13,
  padding: "0 12px",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const fila: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "11px 0",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const etiqueta: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "rgba(255,255,255,0.58)",
};

const valor: React.CSSProperties = {
  fontSize: 13.5,
  fontWeight: 600,
  color: "rgba(255,255,255,0.92)",
};

const bloqueRelleno: React.CSSProperties = {
  borderRadius: 12,
  background:
    "repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0 10px, rgba(255,255,255,0.06) 10px 20px)",
};

const botonSecundario: React.CSSProperties = {
  flex: 1,
  height: 42,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

const botonPrincipal: React.CSSProperties = {
  flex: 1,
  height: 42,
  borderRadius: 12,
  border: "none",
  background: "#a855f7",
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  fontFamily: "inherit",
  cursor: "pointer",
};
