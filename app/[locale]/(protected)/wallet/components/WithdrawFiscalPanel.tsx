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
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/i18n/locales";
import { Modal, TextButton } from "@/components/ui";
import { CardsSkeleton } from "@/components/ui/ListSkeleton";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import WithdrawBreakdown, { type DesgloseRetiro } from "./WithdrawBreakdown";
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

type Props = {
  open: boolean;
  onClose: () => void;
  uid: string | null | undefined;
  availableLabel: string; // subtotal (lo que gana el creador)
  ivaLabel: string; // IVA 16% sobre el subtotal
  totalLabel: string; // subtotal + IVA
  /**
   * Desglose de lo que se retira: cuánto sale del saldo, qué se retiene y cuánto llega.
   *
   * Vive aquí y no en la wallet por decisión de producto: el creador ve su 75% íntegro en
   * Finanzas y los descuentos aparecen al pulsar «Retirar». Ver `calcularRetiro`.
   */
  desglose?: DesgloseRetiro | null;
};

/**
 * Las dos pantallas del panel.
 *
 * ⚠️ Hubo una tercera, `method`, que era una elección entre dos formas de facturar. Con el
 * modelo de intermediación una de las dos dejó de existir —el creador no le factura a Vibra,
 * es al revés— y quedó una pantalla con UNA sola tarjeta: un clic que no decidía nada. Se
 * eliminó el 2026-08-28; el desglose que vivía ahí se movió arriba del formulario.
 */
type View = "auto" | "done";

// ── Estilos del sistema (vibra_style.md) ─────────────────────────────────────
const LABEL = { fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.6)", marginBottom: 6 } as const;
const FIELD: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)",
  border: "none", borderRadius: 12, padding: "10px 12px", color: "#fff",
  fontSize: 14, fontFamily: "inherit", lineHeight: 1.5, outline: "none",
};

export default function WithdrawFiscalPanel({
  open,
  onClose,
  uid,
  availableLabel,
  ivaLabel,
  totalLabel,
  desglose,
}: Props) {
  const tWallet = useTranslations("wallet");
  const locale = useLocale();
  const { profile, loading, hasData, csdReady } = useCreatorTaxProfile(uid);
  // El ciclo de vida de la animación, el backdrop, el bloqueo de scroll y el
  // gesto de arrastre los resuelve el primitivo `Modal` (VibraResponsivePanel).

  const [view, setView] = useState<View>("auto");
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useVibraToast();
  useEffect(() => { if (error) showToast(error, "error"); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
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
    if (!/\.cer$/i.test(f.name)) { setCer(null); setCerError(tWallet("fiscalWrongExtension", { ext: ".cer", what: tWallet("fiscalCertificate") })); return; }
    setCerError(null); setCer(f);
  }
  function pickKey(f: File | null) {
    if (!f) return;
    if (!/\.key$/i.test(f.name)) { setKeyFile(null); setKeyError(tWallet("fiscalWrongExtension", { ext: ".key", what: tWallet("fiscalKey") })); return; }
    setKeyError(null); setKeyFile(f);
  }

  // Ruta MANUAL: el creador sube el PDF y el XML de su factura ya emitida.


  useEffect(() => {
    if (!open || loading) return;
    setError(null);
    setCerError(null);
    setKeyError(null);
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
    setView(csdReady ? "done" : "auto");
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
    if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(taxId.trim().toUpperCase())) { setTaxIdError(tWallet("fiscalTaxIdInvalid")); ok = false; } else setTaxIdError(null);
    if (!legalName.trim()) { setLegalNameError(tWallet("fiscalLegalNameMissing")); ok = false; } else setLegalNameError(null);
    if (!taxSystem) { setTaxSystemError(tWallet("fiscalTaxSystemMissing")); ok = false; } else setTaxSystemError(null);
    if (!/^\d{5}$/.test(zip.trim())) { setZipError(tWallet("fiscalZipInvalid")); ok = false; } else setZipError(null);
    return ok;
  }

  async function submitAuto() {
    setError(null);
    if (!validateFiscalFields()) return;
    if (!cer || !keyFile || !csdPass) return setError(tWallet("fiscalUploadCerKey"));
    if (!consent) return setError(tWallet("fiscalAcceptSelfInvoice"));
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


  // Copia TODOS los datos de facturación en texto ordenado (para pegar en WhatsApp, etc.).

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
        <div style={LABEL}>{tWallet("fiscalLegalNameLabel")}</div>
        <input style={FIELD} value={legalName}
          onChange={(e) => { setLegalName(e.target.value); if (legalNameError) setLegalNameError(null); }} />
        {legalNameError && <div style={redNote}>{legalNameError}</div>}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 2, position: "relative" }}>
          <div style={LABEL}>{tWallet("fiscalTaxSystemLabel")}</div>
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
          <div style={LABEL}>{tWallet("fiscalZipLabel")}</div>
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
    // Lo que se pinta es el formulario fiscal, así que el hueco reserva su alto y no el
    // de las dos tarjetas de elegir método, que ya no existen.
    if (loading) return <CardsSkeleton count={1} height={220} gap={8} />;

    if (view === "auto") {
      return (
        <div style={{ display: "grid", gap: 8 }}>
          {/* Cuánto le llega y por qué, cuando viene del botón de retirar.

              No se enseña si llega desde el alta de cobro: ahí está completando su registro,
              no retirando, y un «recibes $X» sobra. Finanzas lo manda solo cuando toca. */}
          {desglose && (
            <div style={{ marginBottom: 6 }}>
              <WithdrawBreakdown desglose={desglose} />
            </div>
          )}

          {hasData && (
            <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", margin: "0 0 6px", lineHeight: 1.5 }}>
              {tWallet("fiscalDataAlreadySaved")}
            </p>
          )}
          {fiscalFields}
          <div style={{ height: 1, background: "rgba(255,255,255,0.1)" }} />
          {/* 🛡️ El escudo va aquí y en ningún otro sitio del panel.

              Subir el .cer y el .key es lo más delicado que se le pide al creador en toda
              la plataforma, y es justo donde duda. El escudo dice «esto está resguardado»
              antes de que lea la frase; repetirlo en otros campos lo volvería decoración. */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#a855f7"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <polyline points="9 12 11 14 15 10" />
            </svg>
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: 0 }}>
              {tWallet("fiscalSealShieldNote")}
            </p>
          </div>

          {/* Subida del .cer: el texto morado ES el botón que abre el explorador. */}
          <div>
            <input ref={cerInputRef} type="file" accept=".cer" style={{ display: "none" }} onChange={(e) => pickCer(e.target.files?.[0] ?? null)} />
            <TextButton tone="brand" size="md" style={{ margin: 0, fontFamily: "inherit", textAlign: "start", display: "inline-flex", alignItems: "center", maxWidth: "100%" }} onClick={() => cerInputRef.current?.click()}>
              {cer ? <FileChosen name={cer.name} /> : tWallet("fiscalUploadCerCta")}
            </TextButton>
            {cerError && <div style={redNote}>{cerError}</div>}
          </div>

          {/* Subida del .key: explicación + texto morado (botón). */}
          <div>
            <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: "0 0 6px" }}>
              {tWallet("fiscalUploadKeyHint")}
            </p>
            <input ref={keyInputRef} type="file" accept=".key" style={{ display: "none" }} onChange={(e) => pickKey(e.target.files?.[0] ?? null)} />
            <TextButton tone="brand" size="md" style={{ margin: 0, fontFamily: "inherit", textAlign: "start", display: "inline-flex", alignItems: "center", maxWidth: "100%" }} onClick={() => keyInputRef.current?.click()}>
              {keyFile ? <FileChosen name={keyFile.name} /> : tWallet("fiscalUploadKeyCta")}
            </TextButton>
            {keyError && <div style={redNote}>{keyError}</div>}
          </div>
          <div>
            <div style={LABEL}>{tWallet("fiscalKeyPasswordLabel")}</div>
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
                aria-label={showPass ? tWallet("fiscalHidePassword") : tWallet("fiscalShowPassword")}
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
              {tWallet("fiscalSelfInvoiceConsent")}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={consent}
              aria-label={tWallet("fiscalSelfInvoiceConsentAria")}
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
            {busy ? tWallet("fiscalValidatingSeal") : tWallet("fiscalActivateAndSave")}
          </button>
        </div>
      );
    }

    // done
    return (
      <div style={{ display: "grid", gap: 14, textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>✅</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{tWallet("fiscalAutoInvoicingActive")}</div>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.5, margin: 0 }}>
          {tWallet("fiscalAutoInvoicingDone")}
          {profile?.csdExpiresAt
            ? " " +
              tWallet("fiscalSealExpiresOn", {
                date: new Date(profile.csdExpiresAt).toLocaleDateString(intlLocale(locale)),
              })
            : ""}
        </p>
        <button type="button" onClick={handleClose} style={primaryBtn(false)}>{tWallet("fiscalDoneCta")}</button>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loading, busy, hasData, taxId, legalName, taxSystem, regimenQuery, regimenOpen, zip, taxIdError, legalNameError, taxSystemError, zipError, cer, keyFile, cerError, keyError, csdPass, showPass, consent, copied, availableLabel, ivaLabel, totalLabel, profile]);


  return (
    <Modal
      open={open}
      onClose={handleClose}
      /* Este panel tiene dos entradas: el botón de «Retirar» y el paso del sello del
         panel de registro. `desglose` solo llega por la primera —Finanzas lo manda cuando
         de verdad va a retirar—, así que sirve para saber cuál de las dos fue y titular en
         consecuencia. «Retirar $0.00» encabezando una subida de archivos no decía nada. */
      title={desglose ? `Retirar ${availableLabel}` : "Sello fiscal"}
      maxWidthDesktop={540}
      contentPadding="16px 18px calc(18px + var(--vb-safe-bottom, 0px))"
    >
      <style>{`@keyframes vibraCheckPop{0%{transform:scale(0)}60%{transform:scale(1.25)}100%{transform:scale(1)}}`}</style>


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

// Fila (botón) para copiar los datos de facturación: centrada, sin fondo.

// Texto morado que actúa como botón de subida de archivo.

// Nota corta en rojo si el archivo no corresponde.
const redNote: React.CSSProperties = {
  marginTop: 4, fontSize: 11.5, color: "#fca5a5", lineHeight: 1.4,
};



