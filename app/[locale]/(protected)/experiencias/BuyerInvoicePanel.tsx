"use client";

// Panel de facturación del COMPRADOR. Se abre desde /experiencias → Entregados →
// Todo, tras seleccionar los movimientos a facturar y dar "Listo".
// Estilo: panel base de vibra_style.md (backdrop 0.88, contenedor #0a0a0a r18,
// header 56px con título centrado + X, botón primario #a855f7 r5).
//
// Arriba: DATOS DE FACTURACIÓN (a quién le facturamos). Se presentan como
// contenedores tipo "tarjetas guardadas" (como una pasarela de pago): el comprador
// elige un perfil guardado o captura otros datos, con un switch para guardarlos y
// no volver a teclearlos. En medio: conceptos (con scroll, ~5 visibles). Abajo: el
// desglose fiscal (Subtotal = base, IVA 16%, Total) y "Generar factura".
// El timbrado real del CFDI (Facturapi) se conecta en el siguiente bloque.

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { REGIMENES, USOS_CFDI, type SatEntry } from "@/lib/facturacion/satCatalogs";
import type { PriceFormatOptions } from "@/lib/currency/usePriceFormat";
import {
  useBuyerBillingProfiles,
  saveBuyerBillingProfile,
  generateBuyerInvoice,
  downloadBuyerInvoice,
  type BuyerBillingProfile,
} from "@/lib/facturacion/buyerFiscal";

export type InvoiceConcept = {
  id: string;
  name: string; // creador o comunidad
  typeLabel: string; // etiqueta i18n del tipo de servicio
  base: number; // grossAmount (base, sin IVA)
  tax: number; // taxAmount (IVA cobrado encima)
  currency?: string; // moneda del cargo original (propagada); el CFDI es MXN
};

type Props = {
  open: boolean;
  onClose: () => void;
  uid: string | null | undefined;
  concepts: InvoiceConcept[];
  formatMoney: (n: number, opts?: PriceFormatOptions) => string;
  onConfirm?: () => void;
};

const DIVIDER = "1px solid rgba(255,255,255,0.12)";
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const ZIP_RE = /^\d{5}$/;

const LABEL = { fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", marginBottom: 6 } as const;
const FIELD: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)",
  border: "none", borderRadius: 12, padding: "10px 12px", color: "#fff",
  fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, outline: "none",
};
const SUGGEST_BOX: React.CSSProperties = {
  position: "absolute", top: "100%", insetInlineStart: 0, insetInlineEnd: 0, marginTop: 4, zIndex: 5,
  background: "#141419", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12,
  maxHeight: 220, overflowY: "auto", boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
};
const SUGGEST_ITEM: React.CSSProperties = {
  padding: "9px 12px", fontSize: 12.5, color: "rgba(255,255,255,0.85)", cursor: "pointer", lineHeight: 1.35,
};
const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 550, color: "rgba(254,254,254,0.4)", letterSpacing: 0.65, marginBottom: 10,
};

export default function BuyerInvoicePanel({ open, onClose, uid, concepts, formatMoney, onConfirm }: Props) {
  // Desmontado diferido para animar la SALIDA (vibra_style.md).
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);
  useBodyScrollLock(rendered);

  const { profiles } = useBuyerBillingProfiles(uid);

  // Selección de datos fiscales: un perfil guardado o "otros datos" (formulario).
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [usingNew, setUsingNew] = useState(false);
  const [saveForNext, setSaveForNext] = useState(false);

  // Campos del formulario (captura de "otros datos").
  const [taxId, setTaxId] = useState("");
  const [legalName, setLegalName] = useState("");
  const [zip, setZip] = useState("");
  const [taxSystem, setTaxSystem] = useState("");
  const [usoCfdi, setUsoCfdi] = useState("");
  const [email, setEmail] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resultado del timbrado (vista de éxito con el folio fiscal + correo de envío).
  const [doneInfo, setDoneInfo] = useState<{ invoiceId: string; uuid: string | null; total: number | null; email: string | null } | null>(null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      // Reset al abrir.
      setSelectedProfileId(null);
      setUsingNew(false);
      setSaveForNext(false);
      setError(null);
      setBusy(false);
      setDoneInfo(null);
      setTaxId(""); setLegalName(""); setZip(""); setTaxSystem(""); setUsoCfdi(""); setEmail("");
      return;
    }
    setClosing(true);
    const t = window.setTimeout(() => setRendered(false), 180);
    return () => window.clearTimeout(t);
  }, [open]);

  // Sin perfiles guardados → el formulario es el único camino.
  const formMode = usingNew || profiles.length === 0;
  // Perfil activo (cuando se factura con datos guardados): el elegido, o el primero.
  const activeProfileId = selectedProfileId ?? profiles[0]?.id ?? null;

  // El formulario se expande/colapsa con animación (grid-template-rows). Mientras
  // anima necesita `overflow: hidden` para recortar; una vez abierto del todo lo
  // pasamos a `visible` para que los dropdowns de los comboboxes no se corten.
  const [formExpanded, setFormExpanded] = useState(false);
  useEffect(() => {
    if (!formMode) {
      setFormExpanded(false);
      return;
    }
    const t = window.setTimeout(() => setFormExpanded(true), 320);
    return () => window.clearTimeout(t);
  }, [formMode]);

  const totals = useMemo(() => {
    const subtotal = concepts.reduce((a, c) => a + (c.base || 0), 0);
    const iva = concepts.reduce((a, c) => a + (c.tax || 0), 0);
    return { subtotal, iva, total: subtotal + iva };
  }, [concepts]);

  function validForm(): boolean {
    return (
      RFC_RE.test(taxId.trim().toUpperCase()) &&
      !!legalName.trim() &&
      !!taxSystem &&
      ZIP_RE.test(zip.trim()) &&
      !!usoCfdi
    );
  }

  async function handleSubmit() {
    setError(null);
    if (concepts.length === 0) {
      setError("No hay movimientos que facturar.");
      return;
    }

    // 1) Resolver el perfil de facturación a usar (customer de Facturapi).
    let profileId = activeProfileId;
    setBusy(true);
    if (formMode) {
      if (!validForm()) {
        setError("Completa tus datos de facturación (RFC, nombre, régimen, CP y uso de CFDI).");
        setBusy(false);
        return;
      }
      try {
        const r = await saveBuyerBillingProfile({
          taxId: taxId.trim().toUpperCase(),
          legalName: legalName.trim(),
          taxSystem,
          zip: zip.trim(),
          usoCfdi,
          email: email.trim() || undefined,
        });
        profileId = r.id;
      } catch (e) {
        setError(errMsg(e));
        setBusy(false);
        return;
      }
    } else if (!profileId) {
      setError("Elige o captura los datos de facturación.");
      setBusy(false);
      return;
    }

    // 2) Timbrar el CFDI (Vibra → comprador) con los movimientos seleccionados.
    try {
      const r = await generateBuyerInvoice({
        purchaseIds: concepts.map((c) => c.id),
        billingProfileId: profileId!,
      });
      onConfirm?.();
      setDoneInfo({ invoiceId: r.invoiceId, uuid: r.uuid, total: r.total, email: r.email });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Descarga el PDF de la factura (base64 → blob) y cierra el panel.
  async function handleDownload() {
    if (!doneInfo?.invoiceId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await downloadBuyerInvoice(doneInfo.invoiceId);
      const bytes = Uint8Array.from(atob(r.pdfBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  if (!rendered) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 999999,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "rgba(0,0,0,0.88)", fontFamily: "inherit",
        animation: closing ? "vibraInvoiceBackdropOut 180ms ease-in forwards" : "vibraInvoiceBackdropIn 180ms ease-out",
      }}
    >
      <style>{`@keyframes vibraInvoicePanelIn{from{opacity:0;transform:scale(0.94) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes vibraInvoicePanelOut{from{opacity:1;transform:scale(1) translateY(0)}to{opacity:0;transform:scale(0.94) translateY(10px)}}@keyframes vibraInvoiceBackdropIn{from{background:rgba(0,0,0,0)}to{background:rgba(0,0,0,0.88)}}@keyframes vibraInvoiceBackdropOut{from{background:rgba(0,0,0,0.88)}to{background:rgba(0,0,0,0)}}.vibraInvoiceScroll::-webkit-scrollbar{width:7px}.vibraInvoiceScroll::-webkit-scrollbar-track{background:transparent}.vibraInvoiceScroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:999px}`}</style>
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
            type="button" onClick={() => { if (!busy) onClose(); }} aria-label="Cerrar"
            style={{ border: "none", background: "none", color: "#fff", cursor: busy ? "default" : "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Contenido con scroll */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 20px" }} className="vibraInvoiceScroll">
          {doneInfo ? (
            <div style={{ display: "grid", gap: 14, textAlign: "center", padding: "16px 0" }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#16a34a", display: "grid", placeItems: "center", margin: "0 auto" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Factura generada</div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
                {doneInfo.email
                  ? <>Tu factura ha sido enviada a <span style={{ color: "#fff", fontWeight: 600 }}>{doneInfo.email}</span></>
                  : "Tu CFDI se timbró correctamente."}
              </p>
              {doneInfo.uuid && (
                <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", lineHeight: 1.5, wordBreak: "break-all" }}>
                  Folio fiscal (UUID)
                  <div style={{ color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{doneInfo.uuid}</div>
                </div>
              )}
              <button type="button" onClick={onClose} disabled={busy} style={{ marginTop: 6, width: "100%", height: 42, borderRadius: 5, border: "none", background: "#a855f7", color: "rgba(255,255,255,0.98)", fontSize: 17, fontWeight: 500, fontFamily: "inherit", letterSpacing: "-0.02em", cursor: busy ? "default" : "pointer", display: "grid", placeItems: "center" }}>Listo</button>

              {/* Descargar el PDF de la factura y cerrar. 🔁 CUTOVER: hoy es CFDI de
                  PRUEBA (llave sk_test), aún no fiscal; en producción será el CFDI real. */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={busy}
                style={{
                  background: "none", border: "none", padding: 0, margin: 0,
                  color: "#c084fc", cursor: busy ? "default" : "pointer",
                  fontSize: 13, fontWeight: 600, fontFamily: "inherit", lineHeight: 1.4,
                }}
              >
                {busy ? "Descargando…" : "Da clic aquí para descargar tu factura"}
              </button>
            </div>
          ) : (
          <>
          {error && (
            <div style={{ marginBottom: 14, borderRadius: 13, border: "1px solid rgba(255,90,90,0.24)", background: "rgba(120,18,18,0.28)", color: "#ffdada", padding: "10px 12px", fontSize: 13, lineHeight: 1.4 }}>
              {error}
            </div>
          )}

          {/* ── DATOS DE FACTURACIÓN (a quién facturamos) ── */}
          <div style={SECTION_LABEL}>Datos de facturación</div>

          <div style={{ display: "grid", gap: 0, marginBottom: 18 }}>
            {/* Tarjetas de datos guardados (seleccionables). Divisor entre filas. */}
            {profiles.map((p, i) => (
              <ProfileCard
                key={p.id}
                profile={p}
                divider={i > 0}
                selected={!formMode && p.id === activeProfileId}
                onSelect={() => { setSelectedProfileId(p.id); setUsingNew(false); setError(null); }}
              />
            ))}

            {/* "Usar otros datos" (abre el formulario). Solo si ya hay guardados. */}
            {profiles.length > 0 && (
              <button
                type="button"
                onClick={() => { setUsingNew(true); setSelectedProfileId(null); setError(null); }}
                style={{ ...CARD_ROW, borderTop: DIVIDER_LINE }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 500, color: "#fff", flex: 1, textAlign: "start" }}>Usar otros datos</span>
                <Radio checked={usingNew} />
              </button>
            )}

            {/* Formulario de captura: se expande/colapsa con animación. Queda
                siempre montado para poder animar el cierre (no aparece de golpe). */}
            <div
              style={{
                display: "grid",
                gridTemplateRows: formMode ? "1fr" : "0fr",
                opacity: formMode ? 1 : 0,
                transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1), opacity 220ms ease",
              }}
            >
              <div style={{ overflow: formExpanded ? "visible" : "hidden" }}>
                <div style={{ display: "grid", gap: 12, paddingTop: profiles.length > 0 ? 12 : 0 }}>
                  <input style={FIELD} value={taxId} maxLength={13} placeholder="RFC"
                    autoComplete="off"
                    onChange={(e) => { setTaxId(e.target.value.toUpperCase()); if (error) setError(null); }} />
                  <input style={FIELD} value={legalName} placeholder="Nombre o razón social (como en tu Constancia)"
                    onChange={(e) => { setLegalName(e.target.value); if (error) setError(null); }} />
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 2, minWidth: 0 }}>
                      <FiscalCombobox options={REGIMENES} value={taxSystem} placeholder="Régimen fiscal"
                        onChange={(v) => { setTaxSystem(v); if (error) setError(null); }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <input style={FIELD} value={zip} maxLength={5} inputMode="numeric" placeholder="CP fiscal"
                        onChange={(e) => { setZip(e.target.value); if (error) setError(null); }} />
                    </div>
                  </div>
                  <FiscalCombobox options={USOS_CFDI} value={usoCfdi} placeholder="Uso de CFDI"
                    onChange={(v) => { setUsoCfdi(v); if (error) setError(null); }} />
                  <input style={FIELD} value={email} type="email" placeholder="Correo para enviar la factura (opcional)"
                    autoComplete="off"
                    onChange={(e) => setEmail(e.target.value)} />

                  {/* Switch: guardar estos datos para no volver a capturarlos. */}
                  <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                    <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
                      Guardar estos datos para la próxima
                    </span>
                    <Switch checked={saveForNext} onToggle={() => setSaveForNext((v) => !v)} label="Guardar mis datos de facturación" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── CONCEPTOS (con scroll, ~5 visibles) ── */}
          <div style={SECTION_LABEL}>Conceptos ({concepts.length})</div>
          <div className="vibraInvoiceScroll" style={{ maxHeight: 224, overflowY: "auto", display: "grid", gap: 2, marginBottom: 4, background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "4px 12px" }}>
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
                  {formatMoney(c.base + c.tax, { baseCurrency: "MXN" })}
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,0.1)", margin: "12px 0" }} />

          {/* ── DESGLOSE FISCAL ── */}
          <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            <Row k="Subtotal" v={formatMoney(totals.subtotal, { baseCurrency: "MXN" })} />
            <Row k="IVA (16%)" v={formatMoney(totals.iva, { baseCurrency: "MXN" })} />
            <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14, fontWeight: 700 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Total a facturar</span>
              <span style={{ color: "#fff" }}>{formatMoney(totals.total, { baseCurrency: "MXN" })}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            style={{
              marginTop: 18, width: "100%", height: 42, borderRadius: 5, border: "none",
              background: busy ? "rgba(255,255,255,0.1)" : "#a855f7",
              color: busy ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
              fontSize: 17, fontWeight: 500, fontFamily: "inherit", letterSpacing: "-0.02em",
              cursor: busy ? "not-allowed" : "pointer", display: "grid", placeItems: "center",
            }}
          >
            {busy ? "Generando factura…" : "Generar factura"}
          </button>
          </>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
}

// ── Tarjeta de datos guardados (seleccionable, tipo tarjeta de pago) ──────────
function ProfileCard({ profile, selected, divider, onSelect }: { profile: BuyerBillingProfile; selected: boolean; divider: boolean; onSelect: () => void }) {
  const regimen = REGIMENES.find((r) => r.value === profile.taxSystem)?.value ?? profile.taxSystem;
  return (
    <button type="button" onClick={onSelect} style={{ ...CARD_ROW, borderTop: divider ? DIVIDER_LINE : "none" }}>
      <span style={{ display: "grid", gap: 2, minWidth: 0, textAlign: "start", flex: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {profile.legalName}
        </span>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.55)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {profile.taxId} · {regimen}
        </span>
      </span>
      <Radio checked={selected} />
    </button>
  );
}

// Línea sutil que separa una fila de la siguiente (se pone como borderTop inline;
// no se usa CSS porque el `border:none` inline le ganaría a la hoja de estilos).
const DIVIDER_LINE = "1px solid rgba(255,255,255,0.08)";

// Fila de datos fiscales SIN contenedor (sin borde ni relleno): el radio a la
// DERECHA y el contenido a la izquierda. La selección la indica el radio, no el fondo.
const CARD_ROW: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between",
  width: "100%", border: "none", background: "transparent",
  cursor: "pointer", fontFamily: "inherit", padding: "12px 2px",
};

// Punto de radio (relleno morado al seleccionar, con transición).
function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0, width: 18, height: 18, borderRadius: "50%",
        border: checked ? "2px solid #a855f7" : "2px solid rgba(255,255,255,0.28)",
        display: "grid", placeItems: "center", transition: "border-color 160ms ease",
      }}
    >
      <span style={{
        width: 9, height: 9, borderRadius: "50%", background: "#a855f7",
        transform: checked ? "scale(1)" : "scale(0)", transition: "transform 180ms cubic-bezier(0.34,1.56,0.64,1)",
      }} />
    </span>
  );
}

// Switch estilo vibra_style.md (morado activo, a la derecha).
function Switch({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} onClick={onToggle}
      style={{
        position: "relative", width: 40, height: 22, borderRadius: 999, border: "none",
        padding: 0, flexShrink: 0, cursor: "pointer",
        background: checked ? "#a855f7" : "rgba(255,255,255,0.2)", transition: "background 180ms ease",
      }}
    >
      <span style={{
        position: "absolute", top: 2, insetInlineStart: checked ? 20 : 2, width: 18, height: 18,
        borderRadius: "50%", background: "#fff", transition: "left 180ms ease",
        boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
      }} />
    </button>
  );
}

// Combobox buscable (régimen / uso CFDI): filtra conforme escribes; al cerrar
// muestra la etiqueta elegida. Mismo patrón que el buscador de régimen del retiro.
function FiscalCombobox({ options, value, onChange, placeholder }: {
  options: SatEntry[]; value: string; onChange: (value: string) => void; placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? "";
  const display = open ? query : selectedLabel;
  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
  return (
    <div style={{ position: "relative" }}>
      <input
        style={FIELD}
        value={display}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { setQuery(e.target.value); setOpen(true); onChange(""); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div style={SUGGEST_BOX} className="vibraInvoiceScroll">
          {matches.map((o) => (
            <div
              key={o.value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(o.value); setQuery(""); setOpen(false); }}
              style={SUGGEST_ITEM}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "rgba(255,255,255,0.55)" }}>{k}</span>
      <span style={{ color: "#fff", fontWeight: 600, textAlign: "end" }}>{v}</span>
    </div>
  );
}

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^FirebaseError:\s*/, "").replace(/\(functions\/[^)]+\)\s*/, "");
}
