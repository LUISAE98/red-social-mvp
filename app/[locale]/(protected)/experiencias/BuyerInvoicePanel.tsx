"use client";

// Panel de facturación del COMPRADOR. Se abre desde /experiencias → Entregados →
// Todo, tras seleccionar los movimientos a facturar y dar "Listo".
// Estilo: panel base de vibra_style.md (backdrop 0.88, contenedor #0a0a0a r18,
// header 56px con título centrado + X, botón primario #a855f7 r5).
//
// Muestra los conceptos seleccionados y el desglose fiscal (Subtotal = base del
// creador, IVA 16% = impuesto cobrado encima, Total = lo que pagó el comprador).
// El timbrado real del CFDI (Facturapi) se conecta en el siguiente bloque.

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

export type InvoiceConcept = {
  id: string;
  name: string; // creador o comunidad
  typeLabel: string; // etiqueta i18n del tipo de servicio
  base: number; // grossAmount (base, sin IVA)
  tax: number; // taxAmount (IVA cobrado encima)
};

type Props = {
  open: boolean;
  onClose: () => void;
  concepts: InvoiceConcept[];
  formatMoney: (n: number) => string;
  onConfirm?: () => void;
};

const DIVIDER = "1px solid rgba(255,255,255,0.12)";

export default function BuyerInvoicePanel({ open, onClose, concepts, formatMoney, onConfirm }: Props) {
  // Desmontado diferido para animar la SALIDA (vibra_style.md).
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  useBodyScrollLock(rendered);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return;
    }
    setClosing(true);
    const t = window.setTimeout(() => setRendered(false), 180);
    return () => window.clearTimeout(t);
  }, [open]);

  const totals = useMemo(() => {
    const subtotal = concepts.reduce((a, c) => a + (c.base || 0), 0);
    const iva = concepts.reduce((a, c) => a + (c.tax || 0), 0);
    return { subtotal, iva, total: subtotal + iva };
  }, [concepts]);

  if (!rendered) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 999999,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "rgba(0,0,0,0.88)", fontFamily: "inherit",
        animation: closing ? "vibraInvoiceBackdropOut 180ms ease-in forwards" : "vibraInvoiceBackdropIn 180ms ease-out",
      }}
    >
      <style>{`@keyframes vibraInvoicePanelIn{from{opacity:0;transform:scale(0.94) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes vibraInvoicePanelOut{from{opacity:1;transform:scale(1) translateY(0)}to{opacity:0;transform:scale(0.94) translateY(10px)}}@keyframes vibraInvoiceBackdropIn{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,0.88)}}@keyframes vibraInvoiceBackdropOut{from{background:rgba(0,0,0,0.88)}to{background:rgba(0,0,0,0)}}`}</style>
      <section
        style={{
          width: "min(100%, 540px)", maxHeight: "min(88vh, 680px)", display: "flex", flexDirection: "column",
          borderRadius: 18, background: "#0a0a0a",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff", overflow: "hidden",
          animation: closing ? "vibraInvoicePanelOut 180ms ease-in forwards" : "vibraInvoicePanelIn 180ms ease-out",
        }}
      >
        {/* Header: [vacío | título centrado | X] */}
        <div style={{ height: 56, display: "grid", gridTemplateColumns: "48px 1fr 48px", alignItems: "center", padding: "0 12px", borderBottom: DIVIDER, flexShrink: 0 }}>
          <div aria-hidden="true" />
          <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
            Facturar
          </span>
          <button
            type="button" onClick={onClose} aria-label="Cerrar"
            style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Contenido con scroll */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 550, color: "rgba(254,254,254,0.4)", letterSpacing: 0.65, marginBottom: 10 }}>
            Conceptos ({concepts.length})
          </div>

          {/* Lista de conceptos: tipo + creador/comunidad · monto pagado (base + IVA) */}
          <div style={{ display: "grid", gap: 2 }}>
            {concepts.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "8px 0" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.typeLabel}
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </div>
                </div>
                <span style={{ flexShrink: 0, color: "#fff", fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {formatMoney(c.base + c.tax)}
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "12px 0" }} />

          {/* Desglose fiscal: Subtotal (base) + IVA 16% = Total */}
          <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            <Row k="Subtotal" v={formatMoney(totals.subtotal)} />
            <Row k="IVA (16%)" v={formatMoney(totals.iva)} />
            <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, fontWeight: 700 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Total a facturar</span>
              <span style={{ color: "#fff" }}>{formatMoney(totals.total)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onConfirm}
            style={{
              marginTop: 18, width: "100%", height: 42, borderRadius: 5, border: "none",
              background: "#a855f7", color: "rgba(255,255,255,0.98)",
              fontSize: 17, fontWeight: 500, fontFamily: "inherit", letterSpacing: "-0.02em",
              cursor: "pointer", display: "grid", placeItems: "center",
            }}
          >
            Generar factura
          </button>
        </div>
      </section>
    </div>,
    document.body
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>{k}</span>
      <span style={{ color: "#fff", fontWeight: 600, textAlign: "right" }}>{v}</span>
    </div>
  );
}
