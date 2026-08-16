"use client";

// Panel fiscal del retiro (creador MEXICANO). Se abre al dar "Retirar".
// Estilo: primitivo canónico `Modal` (= VibraResponsivePanel, vibra_style.md):
// en celular es la PESTAÑA deslizable desde abajo (bottom sheet, arrastre para
// cerrar) y en laptop el panel centrado. Los dos niveles del flujo (elegir cómo
// facturar → llenar la ruta elegida) viven en la MISMA pestaña: solo cambia el
// cuerpo, con una fila "Regresar" arriba para volver a la elección.
//
// Flujo (docs/legal/fiscal-iva-isr-plataforma.md §0.7):
//   1. PRIMERO las dos opciones: AUTOMÁTICO (CSD → self-billing) o MANUAL.
//   2. Cada ruta pide lo suyo (datos fiscales prellenados si ya existen).
// El creador EXTRANJERO no ve este panel: pasa directo a pago (impuestos aparte).

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { intlLocale } from "@/i18n/locales";
import { Modal } from "@/components/ui";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
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
  name: "María Guadalupe Espinosa Rojas", // 🔁 cambiar a la razón social moral cuando exista
  zip: "54769",
  usoCfdi: "G03 · Gastos en general",
};

type Props = {
  open: boolean;
  onClose: () => void;
  uid: string | null | undefined;
  availableLabel: string; // subtotal (lo que gana el creador)
  ivaLabel: string; // IVA 16% sobre el subtotal
  totalLabel: string; // subtotal + IVA
};

type View = "method" | "auto" | "manual" | "done";

// ── Estilos del sistema (vibra_style.md) ─────────────────────────────────────
const LABEL = { fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", marginBottom: 6 } as const;
const FIELD: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)",
  border: "none", borderRadius: 12, padding: "10px 12px", color: "#fff",
  fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, outline: "none",
};

export default function WithdrawFiscalPanel({ open, onClose, uid, availableLabel, ivaLabel, totalLabel }: Props) {
  const locale = useLocale();
  const { profile, loading, hasData, csdReady } = useCreatorTaxProfile(uid);
  // El ciclo de vida de la animación, el backdrop, el bloqueo de scroll y el
  // gesto de arrastre los resuelve el primitivo `Modal` (VibraResponsivePanel).

  const [view, setView] = useState<View>("method");
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (error) showToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [manualSaved, setManualSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const [taxId, setTaxId] = useState("");
  const [legalName, setLegalName] = useState("");
  const [taxSystem, setTaxSystem] = useState("");
  const [regimenQuery, setRegimenQuery] = useState(""); // texto visible del buscador de régimen
  const [regimenOpen, setRegimenOpen] = useState(false);
  const [zip, setZip] = useState("");
  // Errores de validación POR CAMPO (texto rojo bajo cada campo, sin contenedor).
  const [taxIdError, setTaxIdError] = useState<string | null>(null);
  const [legalNameError, setLegalNameError] = useState<string | null>(null);
  const [taxSystemError, setTaxSystemError] = useState<string | null>(null);
  const [zipError, setZipError] = useState<string | null>(null);
  const cpRef = useRef<HTMLInputElement>(null);

  const [cer, setCer] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [cerError, setCerError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [csdPass, setCsdPass] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [consent, setConsent] = useState(false);
  const cerInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  function pickCer(f: File | null) {
    if (!f) return;
    if (!/\.cer$/i.test(f.name)) { setCer(null); setCerError("Ese no es un archivo .cer. Sube el certificado con extensión .cer."); return; }
    setCerError(null); setCer(f);
  }
  function pickKey(f: File | null) {
    if (!f) return;
    if (!/\.key$/i.test(f.name)) { setKeyFile(null); setKeyError("Ese no es un archivo .key. Sube la llave con extensión .key."); return; }
    setKeyError(null); setKeyFile(f);
  }

  // Ruta MANUAL: el creador sube el PDF y el XML de su factura ya emitida.
  const [pdf, setPdf] = useState<File | null>(null);
  const [xml, setXml] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [xmlError, setXmlError] = useState<string | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);

  function pickPdf(f: File | null) {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name)) { setPdf(null); setPdfError("Ese no es un archivo .pdf. Sube el PDF de tu factura."); return; }
    setPdfError(null); setPdf(f);
  }
  function pickXml(f: File | null) {
    if (!f) return;
    if (!/\.xml$/i.test(f.name)) { setXml(null); setXmlError("Ese no es un archivo .xml. Sube el XML de tu factura."); return; }
    setXmlError(null); setXml(f);
  }

  useEffect(() => {
    if (!open || loading) return;
    setError(null);
    setManualSaved(false);
    setCerError(null);
    setKeyError(null);
    setPdf(null);
    setXml(null);
    setPdfError(null);
    setXmlError(null);
    setShowPass(false);
    setCopied(false);
    setTaxIdError(null);
    setLegalNameError(null);
    setTaxSystemError(null);
    setZipError(null);
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
    setView(csdReady ? "done" : "method");
  }, [open, loading, csdReady, profile]);

  // "Copiado" vuelve a su estado normal a los 2s.
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const canClose = !busy;
  function handleClose() {
    if (canClose) onClose();
  }

  // Valida los campos fiscales y pone el error rojo DEBAJO de cada uno. Devuelve ok.
  function validateFiscalFields(): boolean {
    let ok = true;
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(taxId.trim().toUpperCase())) { setTaxIdError("RFC inválido."); ok = false; } else setTaxIdError(null);
    if (!legalName.trim()) { setLegalNameError("Falta tu nombre o razón social."); ok = false; } else setLegalNameError(null);
    if (!taxSystem) { setTaxSystemError("Selecciona tu régimen fiscal."); ok = false; } else setTaxSystemError(null);
    if (!/^\d{5}$/.test(zip.trim())) { setZipError("CP inválido (5 dígitos)."); ok = false; } else setZipError(null);
    return ok;
  }

  async function submitAuto() {
    setError(null);
    if (!validateFiscalFields()) return;
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

  function submitManualInvoice() {
    setError(null);
    if (!pdf || !xml) return setError("Sube el PDF y el XML de tu factura.");
    // El envío/validación real (leer el XML, cotejar receptor y montos) es del Bloque 3.
    setManualSaved(true);
  }

  // Copia TODOS los datos de facturación en texto ordenado (para pegar en WhatsApp, etc.).
  async function handleCopyBilling() {
    const text = [
      "Datos de facturación (Vibra)",
      `RFC: ${VIBRA_RECEPTOR.rfc}`,
      `Razón social: ${VIBRA_RECEPTOR.name}`,
      `CP: ${VIBRA_RECEPTOR.zip}`,
      `Uso de CFDI: ${VIBRA_RECEPTOR.usoCfdi}`,
      `Subtotal: ${availableLabel}`,
      `IVA (16%): ${ivaLabel}`,
      `Total a facturar: ${totalLabel}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
      } catch {
        setError("No se pudo copiar, copia los datos manualmente.");
      }
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
        <input style={FIELD} value={taxId} maxLength={13}
          onChange={(e) => { setTaxId(e.target.value); if (taxIdError) setTaxIdError(null); }} />
        {taxIdError && <div style={redNote}>{taxIdError}</div>}
      </div>
      <div>
        <div style={LABEL}>Nombre o razón social (como en tu Constancia)</div>
        <input style={FIELD} value={legalName}
          onChange={(e) => { setLegalName(e.target.value); if (legalNameError) setLegalNameError(null); }} />
        {legalNameError && <div style={redNote}>{legalNameError}</div>}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 2, position: "relative" }}>
          <div style={LABEL}>Régimen fiscal</div>
          <input
            style={FIELD}
            value={regimenQuery}
            autoComplete="off"
            onChange={(e) => { setRegimenQuery(e.target.value); setTaxSystem(""); setRegimenOpen(true); if (taxSystemError) setTaxSystemError(null); }}
            onFocus={() => setRegimenOpen(true)}
            onBlur={() => window.setTimeout(() => setRegimenOpen(false), 150)}
          />
          {regimenOpen && regimenMatches.length > 0 && (
            <div style={SUGGEST_BOX}>
              {regimenMatches.map((r) => (
                <div
                  key={r.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setTaxSystem(r.value); setRegimenQuery(r.label); setRegimenOpen(false); setTaxSystemError(null); }}
                  style={SUGGEST_ITEM}
                >
                  {r.label}
                </div>
              ))}
            </div>
          )}
          {taxSystemError && <div style={redNote}>{taxSystemError}</div>}
        </div>
        <div style={{ flex: 1 }}>
          <div style={LABEL}>CP fiscal</div>
          <input
            ref={cpRef}
            style={FIELD}
            value={zip}
            maxLength={5}
            inputMode="numeric"
            onChange={(e) => { setZip(e.target.value); if (zipError) setZipError(null); }}
            onFocus={() => window.setTimeout(() => cpRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50)}
          />
          {zipError && <div style={redNote}>{zipError}</div>}
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
            Sube tu Certificado de Sello Digital (CSD). Se guarda seguro en nuestro proveedor de facturación, nunca en la plataforma.
          </p>

          {/* Subida del .cer: el texto morado ES el botón que abre el explorador. */}
          <div>
            <input ref={cerInputRef} type="file" accept=".cer" style={{ display: "none" }} onChange={(e) => pickCer(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => cerInputRef.current?.click()} style={uploadLink}>
              {cer ? <FileChosen name={cer.name} /> : "Da clic aquí para subir tu archivo .cer"}
            </button>
            {cerError && <div style={redNote}>{cerError}</div>}
          </div>

          {/* Subida del .key: explicación + texto morado (botón). */}
          <div>
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: "0 0 6px" }}>
              Ahora sube tu archivo .key (la llave privada de tu CSD).
            </p>
            <input ref={keyInputRef} type="file" accept=".key" style={{ display: "none" }} onChange={(e) => pickKey(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => keyInputRef.current?.click()} style={uploadLink}>
              {keyFile ? <FileChosen name={keyFile.name} /> : "Da clic aquí para subir tu archivo .key"}
            </button>
            {keyError && <div style={redNote}>{keyError}</div>}
          </div>
          <div>
            <div style={LABEL}>Contraseña de la clave privada</div>
            <div style={{ position: "relative" }}>
              <input
                style={{ ...FIELD, paddingInlineEnd: 42 }}
                type={showPass ? "text" : "password"}
                value={csdPass}
                onChange={(e) => setCsdPass(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
                style={{
                  position: "absolute", top: "50%", insetInlineEnd: 10, transform: "translateY(-50%)",
                  background: "none", border: "none", padding: 4, cursor: "pointer",
                  color: "rgba(255,255,255,0.55)", display: "grid", placeItems: "center", lineHeight: 0,
                }}
              >
                {showPass ? EYE_ICON : EYE_OFF_ICON}
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
              Autorizo a Vibra a emitir mis CFDIs por mi cuenta (auto-facturación).
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={consent}
              aria-label="Autorizo la auto-facturación"
              onClick={() => setConsent((v) => !v)}
              style={{
                position: "relative", width: 40, height: 22, borderRadius: 999, border: "none",
                padding: 0, flexShrink: 0, cursor: "pointer",
                background: consent ? "#a855f7" : "rgba(255,255,255,0.2)",
                transition: "background 180ms ease",
              }}
            >
              <span
                style={{
                  position: "absolute", top: 2, insetInlineStart: consent ? 20 : 2, width: 18, height: 18,
                  borderRadius: "50%", background: "#fff", transition: "left 180ms ease",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
                }}
              />
            </button>
          </div>
          <button type="button" onClick={submitAuto} disabled={busy} style={primaryBtn(busy)}>
            {busy ? "Validando CSD…" : "Activar y guardar"}
          </button>
        </div>
      );
    }

    if (view === "manual") {
      return (
        <div style={{ display: "grid", gap: 14 }}>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: 0, textAlign: "center" }}>
            Genera tu factura (CFDI) a nombre de Vibra con estos datos y sube el PDF y el XML
          </p>

          {/* Copiar TODOS los datos de facturación (texto ordenado, para WhatsApp, etc.). */}
          <button type="button" onClick={handleCopyBilling} style={copyRow}>
            <span style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.4, color: copied ? "#86efac" : "#c084fc" }}>
              {copied ? "¡Información copiada!" : "Da clic aquí para copiar la información al portapapeles"}
            </span>
            <span style={{ display: "inline-flex", flexShrink: 0, color: copied ? "#22c55e" : "#c084fc" }}>
              {copied ? CHECK_ICON : COPY_ICON}
            </span>
          </button>

          <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
            <Row k="Receptor (RFC)" v={VIBRA_RECEPTOR.rfc} />
            <Row k="Razón social" v={VIBRA_RECEPTOR.name} />
            <Row k="CP" v={VIBRA_RECEPTOR.zip} />
            <Row k="Uso de CFDI" v={VIBRA_RECEPTOR.usoCfdi} />
          </div>

          {/* Importe, desglosado clarito: subtotal + IVA = total. (Sin retenciones aún.) */}
          <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
            <Row k="Subtotal" v={availableLabel} />
            <Row k="IVA (16%)" v={ivaLabel} />
            <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5, fontWeight: 700 }}>
              <span style={{ color: "rgba(255,255,255,0.85)" }}>Total a facturar</span>
              <span style={{ color: "#fff" }}>{totalLabel}</span>
            </div>
          </div>

          {/* Subida del PDF (texto morado = botón). */}
          <div>
            <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }} onChange={(e) => pickPdf(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => pdfInputRef.current?.click()} style={uploadLink}>
              {pdf ? <FileChosen name={pdf.name} /> : "Da clic aquí para subir el PDF de tu factura"}
            </button>
            {pdfError && <div style={redNote}>{pdfError}</div>}
          </div>

          {/* Subida del XML (texto morado = botón). */}
          <div>
            <input ref={xmlInputRef} type="file" accept=".xml,text/xml,application/xml" style={{ display: "none" }} onChange={(e) => pickXml(e.target.files?.[0] ?? null)} />
            <button type="button" onClick={() => xmlInputRef.current?.click()} style={uploadLink}>
              {xml ? <FileChosen name={xml.name} /> : "Da clic aquí para subir el XML de tu factura"}
            </button>
            {xmlError && <div style={redNote}>{xmlError}</div>}
          </div>

          {manualSaved && (
            <div style={{ fontSize: 12.5, color: "#86efac", background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.25)", borderRadius: 12, padding: "10px 12px" }}>
              ✓ Archivos listos. La validación de tu factura y el pago se habilitan en el siguiente bloque.
            </div>
          )}

          <button type="button" onClick={submitManualInvoice} disabled={busy} style={primaryBtn(busy)}>
            Enviar factura
          </button>
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
          {profile?.csdExpiresAt ? ` Tu CSD vence el ${new Date(profile.csdExpiresAt).toLocaleDateString(intlLocale(locale))}.` : ""}
        </p>
        <button type="button" onClick={handleClose} style={primaryBtn(false)}>Listo</button>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loading, busy, hasData, manualSaved, taxId, legalName, taxSystem, regimenQuery, regimenOpen, zip, taxIdError, legalNameError, taxSystemError, zipError, cer, keyFile, cerError, keyError, pdf, xml, pdfError, xmlError, csdPass, showPass, consent, copied, availableLabel, ivaLabel, totalLabel, profile]);

  const isSecondLevel = view === "auto" || view === "manual";

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Retirar ${availableLabel}`}
      maxWidthDesktop={540}
      contentPadding="16px 18px calc(18px + var(--vb-safe-bottom, 0px))"
    >
      <style>{`@keyframes vibraCheckPop{0%{transform:scale(0)}60%{transform:scale(1.25)}100%{transform:scale(1)}}`}</style>

      {/* Nivel 2 (auto/manual): fila para volver a la elección de método. El
          header del primitivo solo trae la X, así que el "Regresar" vive aquí. */}
      {isSecondLevel && (
        <button
          type="button" onClick={() => setView("method")} disabled={busy}
          style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
            border: "none", background: "none", padding: 0, fontFamily: "inherit",
            fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.6)",
            cursor: busy ? "default" : "pointer",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Regresar
        </button>
      )}

      {body}

      <VibraToast toast={toast} />
    </Modal>
  );
}

// Ojo (contraseña visible) y ojo tachado (oculta). Trazo currentColor.
const EYE_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EYE_OFF_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-6.5 0-10-8-10-8a18.5 18.5 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </svg>
);

// Archivo elegido: nombre en morado + paloma blanca en círculo verde (pop).
function FileChosen({ name }: { name: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>{name}</span>
      <span
        style={{
          flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, borderRadius: "50%", background: "#16a34a",
          animation: "vibraCheckPop 260ms cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    </span>
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

// Botón primario del panel base (vibra_style.md): #a855f7, alto 42, radio 5.
function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    width: "100%", height: 42, borderRadius: 5, border: "none",
    background: busy ? "rgba(255,255,255,0.1)" : "#a855f7",
    color: busy ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
    fontSize: 17, fontWeight: 500, fontFamily: "inherit", letterSpacing: "-0.02em",
    cursor: busy ? "not-allowed" : "pointer", display: "grid", placeItems: "center",
  };
}

// Card de método: fila [ícono morado | texto]. Contorno gris MUY ligero para que
// se note que son botones; el ícono va centrado a la altura total (alignItems: center).
const methodCard: React.CSSProperties = {
  display: "flex", gap: 12, alignItems: "center", textAlign: "start", width: "100%",
  border: "1px solid rgba(255,255,255,0.09)", borderRadius: 12,
  background: "transparent", cursor: "pointer", fontFamily: "inherit",
  padding: "12px 14px",
};

// Desplegable del buscador de régimen (aparece bajo el campo al escribir).
const SUGGEST_BOX: React.CSSProperties = {
  position: "absolute", top: "100%", insetInlineStart: 0, insetInlineEnd: 0, marginTop: 4, zIndex: 5,
  background: "#141419", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 12,
  maxHeight: 220, overflowY: "auto", boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
};
const SUGGEST_ITEM: React.CSSProperties = {
  padding: "9px 12px", fontSize: 12.5, color: "rgba(255,255,255,0.85)",
  cursor: "pointer", lineHeight: 1.35,
};

// Ícono de copiar (dos hojas) y paloma, en currentColor.
const COPY_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const CHECK_ICON = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// Fila (botón) para copiar los datos de facturación: centrada, sin fondo.
const copyRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  background: "none", border: "none", padding: 0, cursor: "pointer",
  fontFamily: "inherit", width: "100%",
};

// Texto morado que actúa como botón de subida de archivo.
const uploadLink: React.CSSProperties = {
  background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer",
  fontFamily: "inherit", fontSize: 14, fontWeight: 500, color: "#c084fc",
  textAlign: "start", display: "inline-flex", alignItems: "center", maxWidth: "100%",
};

// Nota corta en rojo si el archivo no corresponde.
const redNote: React.CSSProperties = {
  marginTop: 4, fontSize: 11.5, color: "#fca5a5", lineHeight: 1.4,
};

const ICON_WRAP: React.CSSProperties = { flexShrink: 0, lineHeight: 0 };

// Íconos diseñados en morado (sin emojis). Trazo #a855f7.
const AUTO_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
);

const MANUAL_ICON = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </svg>
);
