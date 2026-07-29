"use client";

// Panel fiscal del retiro (creador MEXICANO). Se abre al dar "Retirar".
//
// Flujo (ver docs/legal/fiscal-iva-isr-plataforma.md §0.7):
//   1. Datos fiscales (una vez): RFC / razón social / régimen / CP + consentimiento.
//   2. Elegir cómo factura: AUTOMÁTICO (sube CSD → self-billing) o MANUAL.
//   3. Auto: sube CSD (cer/key/password) → sus facturas se generan solas.
//      Manual: se le muestran los datos a facturar y sube su CFDI (Bloque 3).
//
// El creador EXTRANJERO no ve este panel: pasa directo a pago (sus impuestos se
// manejan aparte). Esa ramificación vive en la página de finanzas.

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import {
  useCreatorTaxProfile,
  saveCreatorTaxProfile,
  uploadCreatorCsd,
  fileToBase64,
} from "@/lib/facturacion/creatorFiscal";

// Regímenes SAT más comunes para creadores (personas físicas + RESICO + moral).
const REGIMENES: Array<{ value: string; label: string }> = [
  { value: "626", label: "626 · RESICO (Simplificado de Confianza)" },
  { value: "612", label: "612 · Actividades Empresariales y Profesionales" },
  { value: "625", label: "625 · Ingresos por plataformas tecnológicas" },
  { value: "606", label: "606 · Arrendamiento" },
  { value: "608", label: "608 · Demás ingresos" },
  { value: "605", label: "605 · Sueldos y Salarios" },
  { value: "601", label: "601 · Persona Moral (General de Ley)" },
];

// Datos de Vibra como RECEPTOR (para la ruta manual). 🔁 mover a config cuando se
// confirme la entidad fiscal definitiva (persona física → moral).
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
  /** Monto disponible ya formateado (para mostrar en el encabezado). */
  availableLabel: string;
};

type View = "data" | "method" | "auto" | "manual" | "done";

const CARD_BG = "rgba(255,255,255,0.04)";
const BORDER = "1px solid rgba(255,255,255,0.12)";
const LABEL = { fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", marginBottom: 6 } as const;
const INPUT: React.CSSProperties = {
  width: "100%", borderRadius: 10, border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)", color: "#fff", padding: "10px 12px",
  fontSize: 14, fontFamily: "inherit", boxSizing: "border-box", outline: "none",
};

export default function WithdrawFiscalPanel({ open, onClose, uid, availableLabel }: Props) {
  const { profile, loading, hasData, csdReady } = useCreatorTaxProfile(uid);
  useBodyScrollLock(open);

  const [view, setView] = useState<View>("method");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Datos fiscales (formulario).
  const [taxId, setTaxId] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxSystem, setTaxSystem] = useState("626");
  const [zip, setZip] = useState("");
  const [consent, setConsent] = useState(false);

  // CSD (ruta auto).
  const [cer, setCer] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [csdPass, setCsdPass] = useState("");

  // Al abrir, decide la vista inicial y siembra el formulario con lo ya guardado.
  useEffect(() => {
    if (!open || loading) return;
    setError(null);
    if (profile) {
      setTaxId(profile.taxId ?? "");
      setLegalName(profile.legalName ?? "");
      setTaxSystem(profile.taxSystem ?? "626");
      setZip(profile.zip ?? "");
      setConsent(profile.selfBillingConsent?.accepted ?? false);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(csdReady ? "done" : hasData ? "method" : "data");
  }, [open, loading, hasData, csdReady, profile]);

  const canClose = !busy;
  function handleClose() {
    if (canClose) onClose();
  }

  async function submitData() {
    setError(null);
    if (!consent) {
      setError("Debes aceptar la auto-facturación para poder cobrar.");
      return;
    }
    setBusy(true);
    try {
      await saveCreatorTaxProfile({
        taxId: taxId.trim().toUpperCase(),
        legalName: legalName.trim(),
        taxSystem,
        zip: zip.trim(),
        acceptSelfBilling: consent,
      });
      setView("method");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitCsd() {
    setError(null);
    if (!cer || !keyFile || !csdPass) {
      setError("Sube tu .cer, tu .key y escribe la contraseña.");
      return;
    }
    setBusy(true);
    try {
      const [cerBase64, keyBase64] = await Promise.all([fileToBase64(cer), fileToBase64(keyFile)]);
      await uploadCreatorCsd({ cerBase64, keyBase64, password: csdPass });
      setCsdPass("");
      setView("done");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const body = useMemo(() => {
    if (loading) return <p style={{ color: "rgba(255,255,255,0.6)" }}>Cargando…</p>;

    if (view === "data") {
      return (
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
            Para pagarte necesitamos tus datos fiscales (los usamos para tu factura hacia Vibra).
          </p>
          <div>
            <div style={LABEL}>RFC</div>
            <input style={INPUT} value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="XAXX010101000" maxLength={13} />
          </div>
          <div>
            <div style={LABEL}>Nombre o razón social (como en tu Constancia)</div>
            <input style={INPUT} value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="NOMBRE APELLIDO APELLIDO" />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 2 }}>
              <div style={LABEL}>Régimen fiscal</div>
              <select style={INPUT} value={taxSystem} onChange={(e) => setTaxSystem(e.target.value)}>
                {REGIMENES.map((r) => (
                  <option key={r.value} value={r.value} style={{ color: "#000" }}>{r.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={LABEL}>CP fiscal</div>
              <input style={INPUT} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="00000" maxLength={5} inputMode="numeric" />
            </div>
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 12.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Autorizo a Vibra a emitir mis CFDIs por mi cuenta (auto-facturación) cuando use la opción automática.</span>
          </label>
          <button type="button" onClick={submitData} disabled={busy} style={primaryBtn(busy)}>
            {busy ? "Guardando…" : "Continuar"}
          </button>
        </div>
      );
    }

    if (view === "method") {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
            ¿Cómo quieres facturarnos tu pago?
          </p>
          <button type="button" onClick={() => setView("auto")} style={methodCard}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>⚡ Automático (recomendado)</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
              Sube tu CSD una vez y tus facturas se generan solas en cada retiro. Pago rápido.
            </div>
          </button>
          <button type="button" onClick={() => setView("manual")} style={methodCard}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>🧾 Manual</div>
            <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
              Te decimos qué facturar y tú subes tu CFDI. Requiere revisión.
            </div>
          </button>
        </div>
      );
    }

    if (view === "auto") {
      return (
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
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
            <input style={INPUT} type="password" value={csdPass} onChange={(e) => setCsdPass(e.target.value)} placeholder="••••••••" />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setView("method")} disabled={busy} style={ghostBtn}>Atrás</button>
            <button type="button" onClick={submitCsd} disabled={busy} style={primaryBtn(busy)}>
              {busy ? "Validando CSD…" : "Subir y activar"}
            </button>
          </div>
        </div>
      );
    }

    if (view === "manual") {
      return (
        <div style={{ display: "grid", gap: 12 }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
            Emite tu CFDI a Vibra con estos datos y luego súbelo:
          </p>
          <div style={{ background: CARD_BG, border: BORDER, borderRadius: 12, padding: 14, display: "grid", gap: 6, fontSize: 12.5 }}>
            <Row k="Receptor (RFC)" v={VIBRA_RECEPTOR.rfc} />
            <Row k="Razón social" v={VIBRA_RECEPTOR.name} />
            <Row k="CP" v={VIBRA_RECEPTOR.zip} />
            <Row k="Uso de CFDI" v={VIBRA_RECEPTOR.usoCfdi} />
            <Row k="Importe" v={`${availableLabel} (subtotal + IVA − retenciones)`} />
          </div>
          <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.42)", lineHeight: 1.5, margin: 0 }}>
            Los montos exactos (IVA y retenciones) según tu régimen se muestran aquí cuando quede
            confirmado el cálculo fiscal. La subida y validación del CFDI se habilita en el siguiente bloque.
          </p>
          <button type="button" onClick={() => setView("method")} style={ghostBtn}>Atrás</button>
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
  }, [view, loading, busy, taxId, legalName, taxSystem, zip, consent, cer, keyFile, csdPass, availableLabel, profile]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={handleClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.78)",
        display: "grid", placeItems: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(460px, 100%)", maxHeight: "calc(100dvh - 32px)", overflowY: "auto",
          background: "linear-gradient(180deg, rgba(20,20,26,0.98), rgba(10,10,14,0.98))",
          border: BORDER, borderRadius: 18, padding: "20px 20px 22px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.7)", color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Retirar {availableLabel}</div>
          <button type="button" onClick={handleClose} disabled={!canClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 22, cursor: canClose ? "pointer" : "default", lineHeight: 1 }}>×</button>
        </div>

        {error && (
          <div style={{ fontSize: 12.5, color: "#fca5a5", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
            {error}
          </div>
        )}

        {body}
      </div>
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

function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    width: "100%", border: "none", borderRadius: 12, padding: "12px 16px",
    fontSize: 14, fontWeight: 700, fontFamily: "inherit",
    color: "#052e16", background: busy ? "rgba(74,222,128,0.5)" : "linear-gradient(135deg, #4ade80, #16a34a)",
    cursor: busy ? "not-allowed" : "pointer",
  };
}

const ghostBtn: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.18)", borderRadius: 12, padding: "12px 16px",
  fontSize: 14, fontWeight: 600, fontFamily: "inherit", color: "#fff",
  background: "rgba(255,255,255,0.06)", cursor: "pointer", whiteSpace: "nowrap",
};

const methodCard: React.CSSProperties = {
  textAlign: "left", border: BORDER, borderRadius: 14, padding: 14,
  background: CARD_BG, cursor: "pointer", fontFamily: "inherit",
};
