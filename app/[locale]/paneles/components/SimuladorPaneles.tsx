"use client";

/**
 * Banco de trabajo del panel: una pantalla de celular y una de laptop, lado a
 * lado, con el panel REAL dentro de cada una.
 *
 * 🚨 POR QUÉ CADA PANTALLA ES UN <iframe> Y NO UN <div>
 * =====================================================
 * Por dos razones, y las dos son insalvables con un div:
 *
 * 1. EL PANEL SE ESCAPA. `VibraResponsivePanel` se dibuja con `createPortal` a
 *    `document.body`. Metido en un div con aspecto de teléfono, el panel no se
 *    quedaría dentro: saldría a ocupar la ventana entera del navegador.
 *
 * 2. LAS MEDIA QUERIES MIRAN LA VENTANA, NO LA CAJA. El panel decide si es
 *    pestaña inferior o caja centrada con `matchMedia("(max-width: 639px)")`,
 *    que mide la VENTANA. En un div de 390px dentro de una pantalla de 1400
 *    seguiría creyéndose de escritorio, que es justo lo contrario de lo que se
 *    quiere ver.
 *
 * Un iframe es una ventana de verdad: tiene su propio ancho, sus propias media
 * queries y su propio `document.body`. Dentro de uno de 390px el panel se
 * comporta EXACTAMENTE como en un teléfono.
 */

import { useLocale } from "next-intl";
import { useState } from "react";

/** Medidas de pantalla, en px de CSS. */
const CELULAR = { ancho: 390, alto: 844, nombre: "Celular", detalle: "390 × 844" };
const LAPTOP = { ancho: 1280, alto: 800, nombre: "Laptop", detalle: "1280 × 800" };

/* La laptop no cabe a tamaño real en la mayoría de pantallas, así que se dibuja
   a escala. El iframe SIGUE midiendo 1280 por dentro —que es lo que leen sus
   media queries—; solo se encoge al pintarlo. */
const ESCALA_LAPTOP = 0.55;

export default function SimuladorPaneles() {
  const locale = useLocale();
  const lienzo = `/${locale}/paneles/lienzo`;

  /* Recargar los dos marcos a la vez. Al tocar el CSS del panel, Fast Refresh
     no siempre alcanza dentro de un iframe; cambiar la clave los vuelve a
     montar y se ve el cambio sin recargar la página entera. */
  const [clave, setClave] = useState(0);

  return (
    <main style={pagina}>
      <header style={cabecera}>
        <div>
          <h1 style={titulo}>Paneles</h1>
          <p style={subtitulo}>
            El panel real, dentro de una pantalla real. Lo que se ve aquí es lo
            que ve quien usa la aplicación.
          </p>
        </div>

        <button type="button" style={botonRecargar} onClick={() => setClave((k) => k + 1)}>
          Recargar pantallas
        </button>
      </header>

      <div style={fila}>
        <Pantalla
          key={`celular-${clave}`}
          medidas={CELULAR}
          src={lienzo}
          escala={1}
          marco="telefono"
        />

        <Pantalla
          key={`laptop-${clave}`}
          medidas={LAPTOP}
          src={lienzo}
          escala={ESCALA_LAPTOP}
          marco="portatil"
        />
      </div>
    </main>
  );
}

function Pantalla({
  medidas,
  src,
  escala,
  marco,
}: {
  medidas: { ancho: number; alto: number; nombre: string; detalle: string };
  src: string;
  escala: number;
  marco: "telefono" | "portatil";
}) {
  const esTelefono = marco === "telefono";

  return (
    <section style={{ display: "grid", gap: 10, justifyItems: "center" }}>
      <div style={etiquetaPantalla}>
        {medidas.nombre} <span style={detallePantalla}>{medidas.detalle}</span>
      </div>

      {/* La caja exterior reserva el sitio que ocupa el marco YA ESCALADO. Sin
          ella, el hueco seguiría siendo el del tamaño real y quedaría un vacío
          enorme al lado. */}
      <div
        style={{
          width: (medidas.ancho + (esTelefono ? 24 : 32)) * escala,
          height: (medidas.alto + (esTelefono ? 24 : 60)) * escala,
        }}
      >
        <div
          style={{
            width: medidas.ancho + (esTelefono ? 24 : 32),
            height: medidas.alto + (esTelefono ? 24 : 60),
            transform: `scale(${escala})`,
            transformOrigin: "top left",
            borderRadius: esTelefono ? 52 : 18,
            padding: esTelefono ? 12 : "16px 16px 44px",
            boxSizing: "border-box",
            background: "#1c1c20",
            boxShadow:
              "inset 0 0 0 1px rgba(255,255,255,0.10), 0 30px 70px rgba(0,0,0,0.55)",
            position: "relative",
          }}
        >
          <iframe
            src={src}
            title={`Pantalla de ${medidas.nombre}`}
            style={{
              width: medidas.ancho,
              height: medidas.alto,
              border: "none",
              borderRadius: esTelefono ? 40 : 6,
              background: "#000",
              display: "block",
            }}
          />

          {esTelefono ? (
            /* Barra del indicador de inicio, solo decorativa. Ayuda a juzgar
               cuánto aire deja el panel por abajo. */
            <div style={indicadorInicio} aria-hidden="true" />
          ) : (
            <div style={basePortatil} aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}

/* ── Estilos de la página ──────────────────────────────────────────────── */

const pagina: React.CSSProperties = {
  minHeight: "var(--vb-alto-pantalla)",
  background: "#0a0a0c",
  color: "#fff",
  padding: "24px 20px 60px",
  fontFamily: "inherit",
};

const cabecera: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 20,
  flexWrap: "wrap",
  maxWidth: 1400,
  margin: "0 auto 28px",
};

const titulo: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: "-0.02em",
};

const subtitulo: React.CSSProperties = {
  margin: "6px 0 0",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "rgba(255,255,255,0.56)",
  maxWidth: 560,
};

const botonRecargar: React.CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  flexShrink: 0,
};

const fila: React.CSSProperties = {
  display: "flex",
  gap: 40,
  alignItems: "flex-start",
  justifyContent: "center",
  flexWrap: "wrap",
  maxWidth: 1400,
  margin: "0 auto",
};

const etiquetaPantalla: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "rgba(255,255,255,0.72)",
};

const detallePantalla: React.CSSProperties = {
  fontWeight: 500,
  color: "rgba(255,255,255,0.38)",
  marginInlineStart: 6,
};

const indicadorInicio: React.CSSProperties = {
  position: "absolute",
  bottom: 4,
  insetInlineStart: "50%",
  transform: "translateX(-50%)",
  width: 130,
  height: 5,
  borderRadius: 999,
  background: "rgba(255,255,255,0.55)",
};

const basePortatil: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  insetInlineStart: "50%",
  transform: "translateX(-50%)",
  width: 90,
  height: 5,
  borderRadius: 999,
  background: "rgba(255,255,255,0.18)",
};
