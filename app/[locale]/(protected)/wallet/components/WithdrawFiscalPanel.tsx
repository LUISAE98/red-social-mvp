"use client";

// Panel fiscal del retiro (creador MEXICANO). Se abre al dar "Retirar".
// Estilo: panel base de vibra_style.md (backdrop 0.88, contenedor #0a0a0a r18,
// header 56px con título centrado + X, botón primario #a855ff r5).
//
// Flujo (docs/legal/fiscal-iva-isr-plataforma.md §0.7):
//   1. PRIMERO las dos opciones: AUTOMÁTICO (CSD → self-billing) o MANUAL.
//   2. Cada ruta pide lo suyo (datos fiscales prellenados si ya existen).
// El creador EXTRANJERO no ve este panel: pasa directo a pago (impuestos aparte).

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import {
  useCreatorTaxProfile,
  saveCreatorTaxProfile,
  uploadCreatorCsd,
  fileToBase64,
} from "@/lib/facturacion/creatorFiscal";

// Catálogo oficial completo del SAT (c_RegimenFiscal, CFDI 4.0).
const REGIMENES: Array<{ value: string; label: string }> = [
  { value: "601", label: "601 · General de Ley Personas Morales" },
  { value: "603", label: "603 · Personas Morales con Fines no Lucrativos" },
  { value: "605", label: "605 · Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { value: "606", label: "606 · Arrendamiento" },
  { value: "607", label: "607 · Régimen de Enajenación o Adquisición de Bienes" },
  { value: "608", label: "608 · Demás ingresos" },
  { value: "610", label: "610 · Residentes en el Extranjero sin Establecimiento Permanente" },
  { value: "611", label: "611 · Ingresos por Dividendos (socios y accionistas)" },
  { value: "612", label: "612 · Personas Físicas con Actividades Empresariales y Profesionales" },
  { value: "614", label: "614 · Ingresos por intereses" },
  { value: "615", label: "615 · Régimen de los ingresos por obtención de premios" },
  { value: "616", label: "616 · Sin obligaciones fiscales" },
  { value: "620", label: "620 · Sociedades Cooperativas de Producción que difieren ingresos" },
  { value: "621", label: "621 · Incorporación Fiscal" },
  { value: "622", label: "622 · Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { value: "623", label: "623 · Opcional para Grupos de Sociedades" },
  { value: "624", label: "624 · Coordinados" },
  { value: "625", label: "625 · Actividades Empresariales con ingresos por Plataformas Tecnológicas" },
  { value: "626", label: "626 · Régimen Simplificado de Confianza (RESICO)" },
];

// Datos de Vibra como RECEPTOR (ruta manual). 🔁 mover a config al confirmar la
// entidad fiscal definitiva (persona física → moral).
const VIBRA_RECEPTOR = {
  rfc: "EIRG710515LI9",
  name: "Vibra",
  zip: "54769",
  usoCfdi: "G03 · Gastos en general",
};

type Props = {
  open: boolean;
  onClose: () => void;
  uid: string | null | undefined;
  availableLabel: string;
};

type View = "method" | "auto" | "manual" | "done";

// ── Estilos del sistema (vibra_style.md) ─────────────────────────────────────
const DIVIDER = "1px solid rgba(255,255,255,0.12)";
const LABEL = { fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", marginBottom: 6 } as const;
const FIELD: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)",
  border: "none", borderRadius: 12, padding: "10px 12px", color: "#fff",
  fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, outline: "none",
};
const CARD_BG = "rgba(255,255,255,0.04)";

export default function WithdrawFiscalPanel({ open, onClose, uid, availableLabel }: Props) {
  const { profile, loading, hasData, csdReady } = useCreatorTaxProfile(uid);
  useBodyScrollLock(open);

  const [view, setView] = useState<View>("method");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);

  const [taxId, setTaxId] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxSystem, setTaxSystem] = useState("");
  const [regimenQuery, setRegimenQuery] = useState(""); // texto visible del buscador de régimen
  const [regimenOpen, setRegimenOpen] = useState(false);
  const [zip, setZip] = useState("");

  const [cer, setCer] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [csdPass, setCsdPass] = useState("");
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    if (!open || loading) return;
    setError(null);
    setManualSaved(false);
    if (profile) {
      setTaxId(profile.taxId ?? "");
      setLegalName(profile.legalName ?? "");
      const code = profile.taxSystem ?? "";
      setTaxSystem(code);
      setRegimenQuery(REGIMENES.find((r) => r.value === code)?.label ?? "");
      setZip(profile.zip ?? "");
      setConsent(profile.selfBillingConsent?.accepted ?? false);
    }
    setRegimenOpen(false);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(csdReady ? "done" : "method");
  }, [open, loading, csdReady, profile]);

  const canClose = !busy;
  function handleClose() {
    if (canClose) onClose();
  }

  function validateData(): string | null {
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(taxId.trim().toUpperCase())) return "RFC inválido.";
    if (!legalName.trim()) return "Falta tu nombre o razón social.";
    if (!taxSystem) return "Selecciona tu régimen fiscal.";
    if (!/^\d{5}$/.test(zip.trim())) return "CP fiscal inválido (5 dígitos).";
    return null;
  }

  async function submitAuto() {
    setError(null);
    const dv = validateData();
    if (dv) return setError(dv);
    if (!cer || !keyFile || !csdPass) return setError("Sube tu .cer, tu .key y escribe la contraseña.");
    if (!consent) return setError("Debes aceptar la auto-facturación para usar la opción automática.");
    setBusy(true);
    try {
      await saveCreatorTaxProfile({ taxId: taxId.trim().toUpperCase(), legalName: legalName.trim(), taxSystem, zip: zip.trim() });
      const [cerBase64, keyBase64] = await Promise.all([fileToBase64(cer), fileToBase64(keyFile)]);
      await uploadCreatorCsd({ cerBase64, keyBase64, password: csdPass, acceptSelfBilling: consent });
      setCsdPass("");
      setView("done");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitManualData() {
    setError(null);
    const dv = validateData();
    if (dv) return setError(dv);
    setBusy(true);
    try {
      await saveCreatorTaxProfile({ taxId: taxId.trim().toUpperCase(), legalName: legalName.trim(), taxSystem, zip: zip.trim() });
      setManualSaved(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Régimen: coincidencias que se muestran conforme la persona escribe.
  const regimenQ = regimenQuery.trim().toLowerCase();
  const regimenMatches = regimenQ
    ? REGIMENES.filter((r) => r.label.toLowerCase().includes(regimenQ) || r.value.includes(regimenQ))
    : REGIMENES;

  const fiscalFields = (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={LABEL}>RFC</div>
        <input style={FIELD} value={taxId} onChange={(e) => setTaxId(e.target.value)} maxLength={13} />
      </div>
      <div>
        <div style={LABEL}>Nombre o razón social (como en tu Constancia)</div>
        <input style={FIELD} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 2, position: "relative" }}>
          <div style={LABEL}>Régimen fiscal</div>
          <input
            style={FIELD}
            value={regimenQuery}
            autoComplete="off"
            onChange={(e) => { setRegimenQuery(e.target.value); setTaxSystem(""); setRegimenOpen(true); }}
            onFocus={() => setRegimenOpen(true)}
            onBlur={() => window.setTimeout(() => setRegimenOpen(false), 150)}
          />
          {regimenOpen && regimenMatches.length > 0 && (
            <div style={SUGGEST_BOX}>
              {regimenMatches.map((r) => (
                <div
                  key={r.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setTaxSystem(r.value); setRegimenQuery(r.label); setRegimenOpen(false); }}
                  style={SUGGEST_ITEM}
                >
                  {r.label}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={LABEL}>CP fiscal</div>
          <input style={FIELD} value={zip} onChange={(e) => setZip(e.target.value)} maxLength={5} inputMode="numeric" />
        </div>
      </div>
    </div>
  );

  const body = useMemo(() => {
    if (loading) return <p style={{ color: "rgba(255,255,255,0.6)" }}>Cargando…</p>;

    if (view === "method") {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={() => setView("auto")} style={methodCard}>
            <span style={ICON_WRAP}>{AUTO_ICON}</span>
            <span style={{ display: "grid", gap: 3 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>Que Vibra facture por ti</span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: "#d8b4fe", background: "rgba(168,85,255,0.16)", borderRadius: 999, padding: "2px 8px" }}>Recomendado</span>
              </span>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
                La forma más fácil, subes tu Sello Digital (CSD) una sola vez y de ahí en
                adelante, nosotros generamos tu factura solitos cada vez que retires. Sin
                trámites y tu dinero te llega más rápido.
              </span>
            </span>
          </button>
          <button type="button" onClick={() => setView("manual")} style={methodCard}>
            <span style={ICON_WRAP}>{MANUAL_ICON}</span>
            <span style={{ display: "grid", gap: 3 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: "#fff" }}>Yo emito mi factura</span>
              <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>
                Te damos los datos exactos para facturar, tú (o tu contador) la emites, la
                subes y la revisamos antes de pagarte. Ideal si prefieres llevar el control.
              </span>
            </span>
          </button>
          {hasData && (
            <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", margin: "4px 0 0", lineHeight: 1.5 }}>
              Ya guardamos tus datos fiscales, así que solo tienes que elegir cómo facturar.
            </p>
          )}
        </div>
      );
    }

    if (view === "auto") {
      return (
        <div style={{ display: "grid", gap: 14 }}>
          {fiscalFields}
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: 0 }}>
            Sube tu Certificado de Sello Digital (CSD). Se guarda seguro en nuestro proveedor de facturación, nunca en la app.
          </p>
          <div>
            <div style={LABEL}>Archivo .cer</div>
            <input type="file" accept=".cer" onChange={(e) => setCer(e.target.files?.[0] ?? null)} style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }} />
          </div>
          <div>
            <div style={LABEL}>Archivo .key</div>
            <input type="file" accept=".key" onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)} style={{ color: "rgba(255,255,255,0.7)", fontSize: 13 }} />
          </div>
          <div>
            <div style={LABEL}>Contraseña de la clave privada</div>
            <input style={FIELD} type="password" value={csdPass} onChange={(e) => setCsdPass(e.target.value)} placeholder="••••••••" />
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 12.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Autorizo a Vibra a emitir mis CFDIs por mi cuenta (auto-facturación).</span>
          </label>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setView("method")} disabled={busy} style={secondaryBtn}>Atrás</button>
            <button type="button" onClick={submitAuto} disabled={busy} style={primaryBtn(busy)}>
              {busy ? "Validando CSD…" : "Activar y guardar"}
            </button>
          </div>
        </div>
      );
    }

    if (view === "manual") {
      return (
        <div style={{ display: "grid", gap: 14 }}>
          {fiscalFields}
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: 0 }}>
            Emite tu CFDI a Vibra con estos datos:
          </p>
          <div style={{ background: CARD_BG, border: DIVIDER, borderRadius: 12, padding: 14, display: "grid", gap: 6, fontSize: 12.5 }}>
            <Row k="Receptor (RFC)" v={VIBRA_RECEPTOR.rfc} />
            <Row k="Razón social" v={VIBRA_RECEPTOR.name} />
            <Row k="CP" v={VIBRA_RECEPTOR.zip} />
            <Row k="Uso de CFDI" v={VIBRA_RECEPTOR.usoCfdi} />
            <Row k="Importe" v={`${availableLabel} (subtotal + IVA − retenciones)`} />
          </div>
          {manualSaved && (
            <div style={{ fontSize: 12.5, color: "#86efac", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 12, padding: "10px 12px" }}>
              ✓ Datos guardados. La subida y validación de tu CFDI se habilita en el siguiente bloque.
            </div>
          )}
          <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.42)", lineHeight: 1.5, margin: 0 }}>
            Los montos exactos (IVA y retenciones) según tu régimen se muestran aquí cuando quede confirmado el cálculo fiscal.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setView("method")} disabled={busy} style={secondaryBtn}>Atrás</button>
            <button type="button" onClick={submitManualData} disabled={busy} style={primaryBtn(busy)}>
              {busy ? "Guardando…" : "Guardar datos"}
            </button>
          </div>
        </div>
      );
    }

    // done
    return (
      <div style={{ display: "grid", gap: 14, textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>✅</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>Facturación automática activada</div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
          Tus facturas hacia Vibra se generarán solas en cada retiro.
          {profile?.csdExpiresAt ? ` Tu CSD vence el ${new Date(profile.csdExpiresAt).toLocaleDateString("es-MX")}.` : ""}
        </p>
        <button type="button" onClick={handleClose} style={primaryBtn(false)}>Listo</button>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loading, busy, hasData, manualSaved, taxId, legalName, taxSystem, regimenQuery, regimenOpen, zip, cer, keyFile, csdPass, consent, availableLabel, profile]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
      style={{
        position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: 999999,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
        background: "rgba(0,0,0,0.88)", fontFamily: "inherit",
      }}
    >
      <style>{`@keyframes vibraFiscalPanelIn{from{opacity:0;transform:scale(0.94) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}`}</style>
      <section
        style={{
          width: "min(100%, 540px)", maxHeight: "min(88vh, 680px)", display: "flex", flexDirection: "column",
          borderRadius: 18, background: "#0a0a0a",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff", overflow: "hidden", animation: "vibraFiscalPanelIn 180ms ease-out",
        }}
      >
        {/* Header: [vacío | título centrado | X] */}
        <div style={{ height: 56, display: "grid", gridTemplateColumns: "48px 1fr 48px", alignItems: "center", padding: "0 12px", borderBottom: DIVIDER, flexShrink: 0 }}>
          <div aria-hidden="true" />
          <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
            Retirar {availableLabel}
          </span>
          <button
            type="button" onClick={handleClose} disabled={!canClose} aria-label="Cerrar"
            style={{ border: "none", background: "none", color: "#fff", cursor: canClose ? "pointer" : "default", display: "grid", placeItems: "center", justifySelf: "end", padding: 4 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Contenido con scroll */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 20px" }}>
          {error && (
            <div style={{ marginBottom: 14, borderRadius: 13, border: "1px solid rgba(255,90,90,0.24)", background: "rgba(120,18,18,0.28)", color: "#ffdada", padding: "10px 12px", fontSize: 13, lineHeight: 1.4 }}>
              {error}
            </div>
          )}
          {body}
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

function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/^FirebaseError:\s*/, "").replace(/\(functions\/[^)]+\)\s*/, "");
}

// Botón primario del panel base (vibra_style.md): #a855ff, alto 42, radio 5.
function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    flex: 1, height: 42, borderRadius: 5, border: "none",
    background: busy ? "rgba(255,255,255,0.1)" : "#a855ff",
    color: busy ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
    fontSize: 17, fontWeight: 500, fontFamily: "inherit", letterSpacing: "-0.02em",
    cursor: busy ? "not-allowed" : "pointer", display: "grid", placeItems: "center",
  };
}

const secondaryBtn: React.CSSProperties = {
  height: 42, borderRadius: 5, border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)", color: "#fff",
  fontSize: 15, fontWeight: 500, fontFamily: "inherit",
  cursor: "pointer", padding: "0 18px", whiteSpace: "nowrap",
};

// Card de método: fila [ícono morado | texto]. Contorno gris MUY ligero para que
// se note que son botones; el ícono va centrado a la altura total (alignItems: center).
const methodCard: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "center", textAlign: "left", width: "100%",
  border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12,
  background: "transparent", cursor: "pointer", fontFamily: "inherit",
  padding: "12px 14px",
};

// Desplegable del buscador de régimen (aparece bajo el campo al escribir).
const SUGGEST_BOX: React.CSSProperties = {
  position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, zIndex: 5,
  background: "#141419", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12,
  maxHeight: 220, overflowY: "auto", boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
};
const SUGGEST_ITEM: React.CSSProperties = {
  padding: "9px 12px", fontSize: 12.5, color: "rgba(255,255,255,0.85)",
  cursor: "pointer", lineHeight: 1.35,
};

const ICON_WRAP: React.CSSProperties = { flexShrink: 0, lineHeight: 0 };

// Íconos diseñados en morado (sin emojis). Trazo #a855ff.
const AUTO_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855ff" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
);

const MANUAL_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855ff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </svg>
);
