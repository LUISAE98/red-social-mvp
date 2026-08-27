"use client";

import { useState, useEffect, useRef } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { useTranslations } from "next-intl";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { getAuth } from "firebase/auth";
import {
  getSuperCommentConfig,
  saveSuperCommentConfig,
  copySuperCommentConfigToLive,
} from "@/lib/liveChat/super-comment-service";
import {
  DEFAULT_SUPER_COMMENT_CONFIG,
  DEFAULT_SUPER_COMMENT_TIERS,
  type SuperCommentConfig,
  type SuperCommentTier,
  aroDegradado,
} from "@/lib/liveChat/types";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import {
  FIXED_SERVICE_FEE_LABEL,
  FIXED_SERVICE_FEE_NOTE,
  SUPER_COMMENT_MIN_PRICE_USD,
} from "@/lib/currency/catalog";
import { formatCurrency, roundReference } from "@/lib/currency/format";

const FONT = "inherit";
const PANEL_CLOSE_THRESHOLD = 130;

type Props = {
  open: boolean;
  onClose: () => void;
  postId: string;
};

/**
 * Skeleton del panel mientras se lee la configuración guardada.
 *
 * Repite la FORMA real —encabezados, aro del nivel, casilla del precio, cargo fijo y
 * caracteres— para que al llegar el contenido nada salte de sitio. Relleno y onda son los
 * canónicos de vibra_style.md (`.vb-skel` + `vbSkelWave`), sin inventar variantes.
 *
 * Sustituye al texto Cargando configuración: la guía pide skeleton, sin spinner ni texto.
 */
function SkeletonNiveles() {
  const fila = (i: number) => (
    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      <div className="vb-skel" style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0 }} />
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div className="vb-skel" style={{ flex: 1, height: 36, borderRadius: 8 }} />
          <div className="vb-skel" style={{ width: 62, height: 11, borderRadius: 6, flexShrink: 0 }} />
        </div>
        <div className="vb-skel" style={{ width: 26, height: 13, borderRadius: 6, margin: "0 auto" }} />
      </div>
    </div>
  );
  return (
    <div>
      {/* Encabezados de las dos columnas. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ width: 16, flexShrink: 0 }} />
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 8 }}>
          <div className="vb-skel" style={{ width: 96, height: 10, borderRadius: 6, margin: "0 auto" }} />
          <div className="vb-skel" style={{ width: 62, height: 10, borderRadius: 6, margin: "0 auto" }} />
        </div>
      </div>
      {[0, 1, 2, 3, 4, 5].map(fila)}
      {/* Las dos leyendas del pie. */}
      <div className="vb-skel" style={{ width: "82%", height: 10, borderRadius: 6, marginBottom: 8 }} />
      <div className="vb-skel" style={{ width: "64%", height: 10, borderRadius: 6 }} />
      <style jsx>{`
        .vb-skel {
          background: linear-gradient(
            100deg,
            rgba(255, 255, 255, 0.05) 30%,
            rgba(255, 255, 255, 0.11) 50%,
            rgba(255, 255, 255, 0.05) 70%
          );
          background-size: 300% 100%;
          animation: vbSkelWave 1.6s ease-in-out infinite;
        }
        @keyframes vbSkelWave {
          0% {
            background-position: 180% 0;
          }
          100% {
            background-position: -80% 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .vb-skel {
            animation: none;
            background: rgba(255, 255, 255, 0.07);
          }
        }
      `}</style>
    </div>
  );
}
export default function SuperCommentConfigPanel({ open, onClose, postId }: Props) {
  const tLive = useTranslations("live");
  const tCommon = useTranslations("common");
  const pf = usePriceFormat();
  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  const [scConfig, setScConfig] = useState<SuperCommentConfig>(DEFAULT_SUPER_COMMENT_CONFIG);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartOffset = useRef(0);
  const panelCloseOffsetRef = useRef(
    typeof window === "undefined" ? 900 : window.innerHeight,
  );

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const update = () => setIsDesktop(window.innerWidth >= 768);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setConfigSaved(false);
      if (!isDesktop) {
        setIsPanelDragging(false);
        setPanelOffsetY(panelCloseOffsetRef.current);
        const f = window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => setPanelOffsetY(0));
        });
        return () => window.cancelAnimationFrame(f);
      }
      return;
    }
    if (!isDesktop) {
      setIsPanelDragging(false);
      setPanelOffsetY(panelCloseOffsetRef.current);
      const t = window.setTimeout(() => setShouldRender(false), 260);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(() => setShouldRender(false), 180);
    return () => window.clearTimeout(t);
  }, [open, isDesktop]);

  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    setLoadingConfig(true);
    getSuperCommentConfig(uid)
      .then((cfg) => {
        // ⚠️ Se recorre la lista POR DEFECTO, no la guardada, y de cada nivel se rescata el
        // precio que el creador hubiera puesto. Antes se recorría la guardada, así que un
        // nivel NUEVO no le llegaba jamás a quien ya hubiera guardado su configuración
        // alguna vez: se quedaba con los que había el día que guardó.
        //
        // De paso, esto hace que quitar un nivel del catálogo lo quite también de las
        // configuraciones viejas, en vez de dejarlo colgando.
        //
        // Nombre, color, degradado y caracteres NO son editables: siempre salen del
        // catálogo. Lo único del creador es el precio.
        const preciosGuardados = new Map(cfg.tiers.map((t) => [t.id, t.price]));
        setScConfig({
          ...cfg,
          tiers: DEFAULT_SUPER_COMMENT_TIERS.map((base) => {
            const guardado = preciosGuardados.get(base.id);
            // ⚠️ El precio guardado NO se convierte: vive en la moneda de liquidación, igual
            // que el campo. Antes se leía con la moneda del documento —que podía ser "MXN"
            // de antes del corte— y se pasaba a la de quien mira, así que al reabrir la
            // configuración el creador se encontraba números distintos de los que puso.
            return {
              ...base,
              price:
                typeof guardado === "number" && guardado > 0
                  ? Math.round(guardado * 100) / 100
                  : base.price,
            };
          }),
        });
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
    // Se carga una sola vez al abrir; toDisplayForInput es estable dentro de esa sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function updateTierField(tierId: string, field: keyof SuperCommentTier, rawValue: string) {
    setScConfig((prev) => ({
      ...prev,
      tiers: prev.tiers.map((t) => {
        if (t.id !== tierId) return t;
        const numericFields: (keyof SuperCommentTier)[] = ["maxChars", "price", "displaySeconds"];
        return {
          ...t,
          [field]: numericFields.includes(field) ? (rawValue === "" ? 0 : Number(rawValue)) : rawValue,
        };
      }),
    }));
    setConfigSaved(false);
  }

  async function handleSaveConfig() {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    setSavingConfig(true);
    setConfigSaved(false);
    try {
      // El creador teclea en la moneda de liquidación y se guarda TAL CUAL. Es la base: el
      // fan paga base + cargo fijo + conversión + impuesto, y el creador recibe el 75% de
      // la base.
      const configToSave: SuperCommentConfig = {
        ...scConfig,
        currency: SETTLEMENT_CURRENCY,
        tiers: scConfig.tiers.map((t) => ({ ...t, price: t.price })),
      };
      await saveSuperCommentConfig(uid, configToSave);
      await copySuperCommentConfigToLive(postId, configToSave);
      setConfigSaved(true);
      setTimeout(() => onClose(), 2000);
    } catch {
      // silencioso
    } finally {
      setSavingConfig(false);
    }
  }

  function applyPanelOffset(raw: number): number {
    if (raw >= 0) return Math.min(panelCloseOffsetRef.current, raw);
    return raw * 0.2;
  }

  function handleDragStart(e: React.PointerEvent) {
    setIsPanelDragging(true);
    dragStartY.current = e.clientY;
    dragStartOffset.current = panelOffsetY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleDragMove(e: React.PointerEvent) {
    if (!isPanelDragging) return;
    const delta = e.clientY - dragStartY.current;
    setPanelOffsetY(applyPanelOffset(dragStartOffset.current + delta));
  }

  function handleDragEnd() {
    if (!isPanelDragging) return;
    setIsPanelDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      onClose();
    } else {
      setPanelOffsetY(0);
    }
  }

  if (!mounted || !shouldRender) return null;

  const formContent = (
    <div style={{ padding: "20px 20px 16px" }}>
      {/* Tiers */}
      {loadingConfig ? (
        <SkeletonNiveles />
      ) : (
        <>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              {/* Spacer del aro del tier (alinea con el aro de los renglones). */}
              <div style={{ width: 16, flexShrink: 0 }} />
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 8 }}>
                {/* Col 1: "Fan paga" centrado SOBRE el input (spacer invisible del ancho del cargo fijo). */}
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "rgba(255,255,255,0.35)", fontFamily: FONT, textAlign: "center" as const }}>
                    {/* ⚠️ La moneda del CAMPO, no la de quien mira. Antes salía la del
                        visor: el encabezado decía «Fan paga (MXN)» sobre unas casillas
                        donde el creador teclea dólares. */}
                    {tLive("scConfigFanPays", { currency: SETTLEMENT_CURRENCY })}
                  </span>
                  <span aria-hidden="true" style={{ visibility: "hidden" as const, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" as const, fontFamily: FONT }}>{FIXED_SERVICE_FEE_LABEL}</span>
                </div>
                {/* Col 2: "Caracteres por mensaje" en DOS renglones, centrado sobre el número. */}
                <span style={{ display: "block", maxWidth: 74, margin: "0 auto", fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: "0.05em", color: "rgba(255,255,255,0.35)", fontFamily: FONT, textAlign: "center" as const, lineHeight: 1.25 }}>
                  {tLive("scConfigCharsPerMsg")}
                </span>
              </div>
            </div>
            {scConfig.tiers.map((tier) => {
              // `tier.price` es la BASE del creador, en la moneda de liquidación.
              const base = tier.price > 0 ? tier.price : 0;
              const belowMin = base > 0 && base < SUPER_COMMENT_MIN_PRICE_USD;
              const earningsVisible = base >= SUPER_COMMENT_MIN_PRICE_USD;
              // ⚠️ NO se usa `formatMoney` (= `pf.format`): ese calcula el precio del
              // COMPRADOR —convierte, suma el 2% y redondea al paso—, así que la ganancia
              // del creador salía convertida e inflada.
              const creatorEarns = formatCurrency(base * WALLET_NET_RATE, SETTLEMENT_CURRENCY, pf.locale, { code: true });
              // Lo que gana, en SU moneda. Null si ya mira en la de liquidación: repetir
              // la misma cifra dos veces no informa de nada.
              const netoLocal = pf.currency === SETTLEMENT_CURRENCY ? null : pf.fromAnchor(base * WALLET_NET_RATE);
              const refNivel =
                netoLocal == null
                  ? null
                  : formatCurrency(roundReference(netoLocal, pf.currency), pf.currency, pf.locale, { code: true, approx: true });
              const collapse = "max-height 220ms ease, opacity 220ms ease, transform 220ms ease";
              return (
                <div key={tier.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Aro del color del tier al inicio del renglón (como en el panel de compra). */}
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                      boxSizing: "border-box" as const,
                      border: `2.5px solid ${tier.gradient ? "transparent" : tier.color}`,
                      ...(tier.gradient ? aroDegradado(tier.gradient) : {}),
                    }} />
                    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 8, alignItems: "center" }}>
                      {/* Col 1: Precio (editable) + el cargo fijo al final. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <input
                          type="number" min={1} value={tier.price || ""}
                          onChange={(e) => updateTierField(tier.id, "price", e.target.value)}
                          placeholder="0.00"
                          style={{
                            flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 8,
                            border: "none",
                            background: "rgba(255,255,255,0.06)",
                            color: "#ffffff",
                            fontSize: 13, fontFamily: FONT, textAlign: "center" as const, outline: "none",
                            boxSizing: "border-box" as const,
                          }}
                        />
                        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" as const, fontFamily: FONT }}>{FIXED_SERVICE_FEE_LABEL}</span>
                      </div>
                      {/* Col 2: Caracteres FIJOS (no editables): solo el número, sin caja, centrado. */}
                      <div style={{ textAlign: "center" as const, color: "rgba(255,255,255,0.55)", fontSize: 13, fontFamily: FONT }}>
                        {tier.maxChars}
                      </div>
                    </div>
                  </div>

                  {/* Aviso mínimo (rojo) — colapsa suave. */}
                  <div style={{ maxHeight: belowMin ? 22 : 0, opacity: belowMin ? 1 : 0, transform: belowMin ? "translateY(0)" : "translateY(4px)", overflow: "hidden", transition: collapse }}>
                    <p style={{ margin: "5px 0 0", fontSize: 10.5, color: "#f87171", fontFamily: FONT, lineHeight: 1.4 }}>
                      {tCommon("priceMin", { min: SUPER_COMMENT_MIN_PRICE_USD })}
                    </p>
                  </div>

                  {/* Cuánto cobra el creador (75% de la base) y, debajo, la referencia en
                      su moneda — mismo estilo que en la configuración de saludos y consejos.
                      El alto crece cuando hay referencia: si no, el colapso la recortaría. */}
                  <div style={{ maxHeight: earningsVisible ? (refNivel ? 48 : 28) : 0, opacity: earningsVisible ? 1 : 0, transform: earningsVisible ? "translateY(0)" : "translateY(4px)", overflow: "hidden", transition: collapse }}>
                    {/* El texto va en blanco y el IMPORTE en el color del nivel: así el
                        color identifica de qué nivel se habla sin teñir la frase entera. */}
                    <p style={{ margin: "5px 0 0", fontSize: 10.5, color: "rgba(255,255,255,0.85)", fontFamily: FONT, lineHeight: 1.4 }}>
                      {tLive("scConfigEarnNote")}{" "}
                      <span
                        style={{
                          color: tier.color,
                          fontWeight: 600,
                          ...(tier.gradient
                            ? {
                                backgroundImage: tier.gradient,
                                WebkitBackgroundClip: "text" as const,
                                backgroundClip: "text" as const,
                                WebkitTextFillColor: "transparent",
                              }
                            : {}),
                        }}
                      >
                        {creatorEarns}
                      </span>
                    </p>
                    {refNivel && (
                      <p style={{ margin: "2px 0 0", color: "rgba(255,255,255,0.45)", fontSize: 12, fontFamily: FONT, lineHeight: 1.45 }}>
                        {tLive("approximately")} <span style={{ fontWeight: 500 }}>{refNivel}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Leyenda del cargo fijo de Stripe (aplica a todos los tiers). */}
          <div style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: FONT, marginBottom: 12, lineHeight: 1.5 }}>
            {FIXED_SERVICE_FEE_NOTE}
          </div>

          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: FONT, lineHeight: 1.5 }}>
            {tLive("scConfigSavedNote")}
          </div>
        </>
      )}
    </div>
  );

  // Footer FIJO (fuera del scroll) con el botón de guardar cambios.
  const saveFooter = (
    <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
      <style>{`
        @keyframes scSaveCheckIn {
          from { transform: scale(0.3); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
      `}</style>
      {savingConfig ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 44 }}>
          <div className="vibraPullRefreshSpinner refreshing" style={{ width: 32, height: 32 }} />
        </div>
      ) : configSaved ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 44 }}>
          <svg
            width="36" height="36" viewBox="0 0 28 28" fill="none"
            style={{ animation: "scSaveCheckIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards" }}
          >
            <circle cx="14" cy="14" r="14" fill="#22c55e" />
            <path d="M8 14l4.5 4.5 7.5-8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleSaveConfig}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 10,
            background: "linear-gradient(135deg,rgba(168,85,255,0.9),rgba(124,58,237,0.9))",
            color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: FONT,
            cursor: "pointer", border: "none",
          }}
        >
          {tLive("scConfigSaveButton")}
        </button>
      )}
    </div>
  );

  if (isDesktop) {
    return createPortal(
      <div
        style={{
          position: "fixed", inset: 0, zIndex: 999999,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.72)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        }}
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <section style={{
          width: "min(100%, 440px)", maxHeight: "min(88vh, 600px)",
          display: "flex", flexDirection: "column",
          borderRadius: 18, background: "#0a0a0a",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff", overflow: "hidden",
          animation: open
            ? "scConfigIn 180ms ease-out"
            : "scConfigOut 180ms ease-in forwards",
        }}>
          <style>{`
            @keyframes scConfigIn {
              from { opacity: 0; transform: scale(0.94) translateY(10px); }
              to   { opacity: 1; transform: scale(1)    translateY(0); }
            }
            @keyframes scConfigOut {
              from { opacity: 1; transform: scale(1)    translateY(0); }
              to   { opacity: 0; transform: scale(0.94) translateY(10px); }
            }
          `}</style>
          <header style={{
            height: 56, display: "grid",
            gridTemplateColumns: "48px 1fr 48px",
            alignItems: "center", padding: "0 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            flexShrink: 0,
          }}>
            <div />
            <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", textAlign: "center", letterSpacing: "-0.02em" }}>
              {tLive("superComments")}
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            {formContent}
          </div>
          {saveFooter}
        </section>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 999999,
        display: "flex", alignItems: "flex-end",
        padding: 0,
        background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* panel-outer */}
      <div style={{
        width: "100%", maxHeight: "calc(100dvh - 72px)",
        display: "flex", flexDirection: "column",
        background: "rgba(8,9,11,0.96)",
        paddingBottom: "var(--vb-safe-bottom, 0px)",
        transform: open ? `translateY(${Math.max(0, panelOffsetY)}px)` : "translateY(100%)",
        transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        willChange: "transform",
      }}>
        {/* section-wrapper */}
        <div style={{
          transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
          transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}>
          <section style={{
            maxHeight: "calc(100dvh - 72px)", borderRadius: "22px 22px 0 0",
            background: "rgba(8,9,11,0.96)", boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
            color: "#fff", overflow: "hidden", display: "flex", flexDirection: "column",
          }}>
            <header
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              style={{
                height: 56, display: "grid",
                gridTemplateColumns: "72px 1fr 72px",
                alignItems: "center", padding: "0 12px",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
                flexShrink: 0, touchAction: "none",
                userSelect: "none", WebkitUserSelect: "none",
              }}
            >
              <div aria-hidden="true" />
              <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
                {tLive("superComments")}
              </h3>
              <button
                type="button"
                onClick={onClose}
                style={{ width: 40, height: 40, border: "none", background: "transparent", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 300, lineHeight: 1, justifySelf: "end" }}
              >
                ×
              </button>
            </header>
            <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              {formContent}
            </div>
            {saveFooter}
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
