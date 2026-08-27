"use client";

import { useEffect, useRef, useState } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { IconButton } from "@/components/ui";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { WALLET_NET_RATE } from "@/lib/wallet/walletFinances";
import {
  FIXED_SERVICE_FEE_LABEL,
  FIXED_SERVICE_FEE_NOTE,
  PREMIUM_MIN_PRICE_USD,
} from "@/lib/currency/catalog";
import { formatCurrency } from "@/lib/currency/format";
import { LocalPriceHint } from "@/components/services/config/serviceConfigKit";
import type { Post } from "@/lib/posts/types";
import { finalizeVodSettings } from "@/lib/posts/post-service";

type Props = {
  open: boolean;
  onClose: () => void;
  post: Post;
};

const FONT = "inherit";
const BORDER = "1px solid rgba(255,255,255,0.12)";
const PANEL_CLOSE_THRESHOLD = 130;

function applyPanelOffset(raw: number): number {
  if (raw >= 0) return Math.min(window.innerHeight, raw);
  return raw * 0.2;
}

export default function LiveEndSummaryPanel({ open, onClose, post }: Props) {
  const tCommon = useTranslations("common");
  const tWallet = useTranslations("wallet");
  const tLive = useTranslations("live");
  const priceFmt = usePriceFormat();
  const liveData = post.liveData;
  const defaultPaid = liveData?.accessType === "paid";
  // ⚠️ NO se convierte. El precio guardado y el campo viven los DOS en la moneda de
  // liquidación. Antes se leía como si fuera MXN y se pasaba a la moneda de quien mira:
  // al reabrir el panel, el creador veía un número que no era el que había puesto.
  const defaultPrice = liveData?.ticketPrice
    ? String(Math.round(liveData.ticketPrice * 100) / 100)
    : "";

  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  const [keepPinned, setKeepPinned] = useState(true);
  const [vodAvailable, setVodAvailable] = useState(true);
  const [vodPaid, setVodPaid] = useState(defaultPaid);
  const [priceInput, setPriceInput] = useState(defaultPrice);
  const [saving, setSaving] = useState(false);
  const { toast: summaryToast, showToast: showSummaryToast } = useVibraToast();

  // Precio del VOD, en la moneda de liquidación. Mismo sistema que experiencias, premium
  // y ticket: mínimo en rojo, cuánto ganas (75%) y la leyenda del cargo fijo.
  const vodPriceNum = parseFloat(priceInput);
  const vodHasValidPrice =
    priceInput.trim() !== "" && Number.isFinite(vodPriceNum) && vodPriceNum > 0;
  const vodBelowMin = vodHasValidPrice && vodPriceNum < PREMIUM_MIN_PRICE_USD;
  const vodEarnings = vodHasValidPrice ? vodPriceNum * WALLET_NET_RATE : null;
  const vodEarningsVisible = vodEarnings != null && vodEarnings > 0 && !vodBelowMin;

  // Mobile swipe state
  const [panelOffsetY, setPanelOffsetY] = useState(0);
  const [isPanelDragging, setIsPanelDragging] = useState(false);
  const pointerStartY = useRef(0);
  const pointerStartOffset = useRef(0);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), isMobile ? 260 : 180);
      return () => clearTimeout(t);
    }
  }, [open, isMobile]);

  useBodyScrollLock(open);

  function handlePanelPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    setIsPanelDragging(true);
    pointerStartY.current = e.clientY;
    pointerStartOffset.current = panelOffsetY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePanelPointerMove(e: React.PointerEvent) {
    if (!isPanelDragging) return;
    const delta = e.clientY - pointerStartY.current;
    setPanelOffsetY(applyPanelOffset(pointerStartOffset.current + delta));
  }

  function handlePanelPointerUp() {
    if (!isPanelDragging) return;
    setIsPanelDragging(false);
    if (panelOffsetY >= PANEL_CLOSE_THRESHOLD) {
      setPanelOffsetY(0);
      onClose();
    } else {
      setPanelOffsetY(0);
    }
  }

  async function handleConfirm() {
    if (saving) return;
    // El creador teclea en la moneda de liquidación y se guarda TAL CUAL. Es la base: el
    // backend le suma el cargo fijo, la conversión y el impuesto (VOD = post premium).
    const typedPrice = vodAvailable && vodPaid ? (parseFloat(priceInput) || null) : null;
    if (vodAvailable && vodPaid && (!typedPrice || typedPrice <= 0)) {
      showSummaryToast(tWallet("payErrorInvalidAmount"), "error");
      return;
    }
    if (vodAvailable && vodPaid && typedPrice != null && typedPrice < PREMIUM_MIN_PRICE_USD) {
      showSummaryToast(tCommon("priceMin", { min: PREMIUM_MIN_PRICE_USD }), "error");
      return;
    }
    const price = typedPrice;
    setSaving(true);
    try {
      await finalizeVodSettings(post.id, {
        keepPinned: vodAvailable ? keepPinned : false,
        vodHidden: !vodAvailable,
        vodPaid: vodAvailable ? vodPaid : false,
        vodPrice: price,
        vodTitle: liveData?.title ?? null,
        vodDescription: liveData?.description ?? null,
      });
      onClose();
    } catch {
      showSummaryToast(tLive("saveLiveError"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  // Switch canónico (estilo vibra_style.md / serviceConfigKit): pill 36×20, morado
  // al activar, perilla blanca deslizante.
  function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        style={{
          position: "relative",
          width: 36, minWidth: 36, height: 20, minHeight: 20,
          borderRadius: 999, border: "none",
          background: checked ? "#a855f7" : "rgba(255,255,255,0.10)",
          padding: 0, cursor: "pointer", transition: "all 0.2s ease",
          flexShrink: 0, boxSizing: "border-box",
        }}
      >
        <span
          style={{
            position: "absolute", top: 2, insetInlineStart: checked ? 18 : 2,
            width: 14, height: 14, borderRadius: "50%", background: "#fff",
            transition: "all 0.2s ease",
          }}
        />
      </button>
    );
  }

  function Row({ label, description, children, last = false }: { label: string; description?: string; children: React.ReactNode; last?: boolean }) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderBottom: last ? "none" : BORDER }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "#fff", fontFamily: FONT }}>{label}</div>
          {description && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginTop: 2, fontFamily: FONT }}>{description}</div>}
        </div>
        {children}
      </div>
    );
  }

  const content = (
    <>
      <style>{`
        @keyframes vibraLiveEndIn { from { opacity:0; transform:scale(0.94) translateY(10px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes vibraLiveEndOut { from { opacity:1; transform:scale(1) translateY(0); } to { opacity:0; transform:scale(0.94) translateY(10px); } }
        .vibra-lep-scroll::-webkit-scrollbar { width:7px; }
        .vibra-lep-scroll::-webkit-scrollbar-track { background:transparent; }
        .vibra-lep-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.18); border-radius:999px; }
      `}</style>

      {/* Row: disponible — primera decisión */}
      <Row label={tLive("makeVodAvailable")} description={tLive("makeVodAvailableDesc")} last={!vodAvailable}>
        <Switch checked={vodAvailable} onChange={setVodAvailable} />
      </Row>

      {/* Fijar + ticket: aparecen/desaparecen SUAVE (colapso) al activar/desactivar VOD. */}
      <div
        style={{
          maxHeight: vodAvailable ? 700 : 0,
          opacity: vodAvailable ? 1 : 0,
          overflow: "hidden",
          transition: "max-height 320ms ease, opacity 260ms ease",
        }}
      >
          <Row label={tLive("pinVodInFeed")} description={tLive("pinVodInFeedDesc")}>
            <Switch checked={keepPinned} onChange={setKeepPinned} />
          </Row>

          <Row label={tLive("accessTicket")} description={tLive("accessTicketDesc")} last>
            <Switch checked={vodPaid} onChange={setVodPaid} />
          </Row>

          {/* El precio se DESLIZA suave al activar "cobrar" y se colapsa suave al cambiar a
              gratis (no aparece/desaparece de golpe). Mismo estilo que experiencias/premium. */}
          <div
            style={{
              maxHeight: vodPaid ? 280 : 0,
              opacity: vodPaid ? 1 : 0,
              overflow: "hidden",
              transition: "max-height 300ms ease, opacity 240ms ease",
            }}
          >
            <div style={{ paddingTop: 2, paddingBottom: 14 }}>
              {/* Campo canónico vibra_style.md; el cargo fijo y la moneda van FUERA del placeholder. */}
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  placeholder={defaultPrice || "0.00"}
                  style={{
                    flex: "1 1 160px", minWidth: 0,
                    padding: "10px 12px", borderRadius: 12,
                    border: "none",
                    background: "rgba(255,255,255,0.06)", color: "#fff",
                    fontSize: 15, fontFamily: FONT, outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", fontFamily: FONT }}>{FIXED_SERVICE_FEE_LABEL}</span>
                <span style={{ color: "#a855f7", fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap", fontFamily: FONT }}>{SETTLEMENT_CURRENCY}</span>
              </div>

              {/* 3 leyendas que COLAPSAN suave: mínimo rojo / cuánto ganas (75%) / cargo Stripe. */}
              <div style={{ marginTop: 8 }}>
                <div style={{ maxHeight: vodBelowMin ? 24 : 0, opacity: vodBelowMin ? 1 : 0, transform: vodBelowMin ? "translateY(0)" : "translateY(4px)", overflow: "hidden", transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease" }}>
                  <span style={{ display: "block", color: "#f87171", fontSize: 12, lineHeight: 1.45, fontFamily: FONT }}>{tCommon("priceMin", { min: PREMIUM_MIN_PRICE_USD })}</span>
                </div>
                <div style={{ maxHeight: vodEarningsVisible ? 24 : 0, opacity: vodEarningsVisible ? 1 : 0, transform: vodEarningsVisible ? "translateY(0)" : "translateY(4px)", overflow: "hidden", transition: "max-height 220ms ease, opacity 220ms ease, transform 220ms ease" }}>
                  <span style={{ display: "block", color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 1.45, fontFamily: FONT }}>
                    {tLive("youEarn")} <strong style={{ color: "#a855f7", fontWeight: 700 }}>{formatCurrency(vodEarnings ?? 0, SETTLEMENT_CURRENCY, priceFmt.locale, { code: true })}</strong> {tLive("perUnlock")}
                  </span>
                </div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, lineHeight: 1.4, fontFamily: FONT, marginTop: 3 }}>
                  {FIXED_SERVICE_FEE_NOTE}
                </div>
                {/* Referencia en la moneda del creador, el mismo componente que usan las
                    experiencias y el composer premium. El precio SIEMPRE se fija en la de
                    liquidación; esto solo lo ayuda a ubicarse. */}
                <LocalPriceHint value={vodHasValidPrice ? vodPriceNum : null} netRate={WALLET_NET_RATE} />
              </div>
            </div>
          </div>
      </div>

      <VibraToast toast={summaryToast} />
    </>
  );

  // ── MOBILE bottom sheet ────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{
          position: "fixed", inset: 0,
          zIndex: 999999, display: "flex", alignItems: "flex-end", justifyContent: "center",
          padding: 0,
          background: "rgba(0,0,0,0.52)", backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)", fontFamily: FONT,
          opacity: visible ? 1 : 0, transition: "opacity 260ms",
        }}
      >
        {/* panel-outer */}
        <div style={{
          width: "100%", maxHeight: "calc(100dvh - 72px)",
          display: "flex", flexDirection: "column",
          background: "rgba(8,9,11,0.96)",
          paddingBottom: "var(--vb-safe-bottom, 0px)",
          transform: visible ? `translateY(${Math.max(0, panelOffsetY)}px)` : "translateY(100%)",
          transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22,1,0.36,1)",
          willChange: "transform",
        }}>
          {/* section-wrapper (rubber band) */}
          <div style={{
            transform: `translateY(${Math.min(0, panelOffsetY)}px)`,
            transition: isPanelDragging ? "none" : "transform 260ms cubic-bezier(0.22,1,0.36,1)",
          }}>
            <section style={{
              maxHeight: "calc(100dvh - 140px)",
              borderRadius: "22px 22px 0 0",
              background: "rgba(8,9,11,0.96)",
              boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
              color: "#fff", overflow: "hidden",
              display: "flex", flexDirection: "column",
            }}>
              <header
                onPointerDown={handlePanelPointerDown}
                onPointerMove={handlePanelPointerMove}
                onPointerUp={handlePanelPointerUp}
                onPointerCancel={handlePanelPointerUp}
                style={{
                  height: 56, display: "grid", gridTemplateColumns: "72px 1fr 72px",
                  alignItems: "center", padding: "0 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.07)",
                  flexShrink: 0, touchAction: "none",
                  userSelect: "none", WebkitUserSelect: "none",
                }}
              >
                <div aria-hidden="true" />
                <h3 style={{ margin: 0, textAlign: "center", fontSize: 17, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1.2, color: "#fff" }}>
                  {tLive("broadcastSummary")}
                </h3>
                <button
                  type="button"
                  onClick={onClose}
                  style={{ width: 40, height: 40, border: "none", background: "transparent", color: "rgba(255,255,255,0.86)", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 32, fontWeight: 300, lineHeight: 1, justifySelf: "end" }}
                >×</button>
              </header>

              <div className="vibra-lep-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "12px 16px 8px" }}>
                {content}
              </div>
            </section>
          </div>

          {/* footer anclado — fuera del rubber band */}
          <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,0.07)", padding: "10px 16px 14px", background: "rgba(8,9,11,0.96)" }}>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving}
              style={{
                width: "100%", height: 42, borderRadius: 5, border: "none",
                background: saving ? "rgba(255,255,255,0.1)" : "#a855f7",
                color: saving ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
                fontSize: 17, fontWeight: 500, fontFamily: FONT,
                cursor: saving ? "not-allowed" : "pointer",
                letterSpacing: "-0.02em", display: "grid", placeItems: "center",
              }}
            >
              {saving ? tCommon("saving") : tCommon("confirm")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── DESKTOP modal ──────────────────────────────────────────────────────────
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0,
        zIndex: 999999, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24, background: "rgba(0,0,0,0.88)", fontFamily: FONT,
      }}
    >
      <section style={{
        width: "min(100%, 540px)", maxHeight: "min(88vh, 680px)",
        display: "flex", flexDirection: "column", borderRadius: 18,
        background: "#0a0a0a",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
        color: "#fff", overflow: "hidden",
        animation: visible ? "vibraLiveEndIn 180ms ease-out" : "vibraLiveEndOut 180ms ease-in forwards",
      }}>
        {/* Header */}
        <div style={{
          height: 56, display: "grid", gridTemplateColumns: "48px 1fr 48px",
          alignItems: "center", padding: "0 12px",
          borderBottom: BORDER, flexShrink: 0,
        }}>
          <div aria-hidden="true" />
          <span style={{ fontSize: 17, fontWeight: 500, color: "#fff", lineHeight: 1.2, textAlign: "center", letterSpacing: "-0.02em" }}>
            {tLive("broadcastSummary")}
          </span>
          <IconButton label={tCommon("closeAriaLabel")} size="sm" tone="bare" shape="square" style={{ placeItems: "center", justifySelf: "end" }} onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </IconButton>
        </div>

        {/* Content */}
        <div className="vibra-lep-scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px 8px" }}>
          {content}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px 18px", borderTop: BORDER }}>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            style={{
              width: "100%", height: 42, borderRadius: 5, border: "none",
              background: saving ? "rgba(255,255,255,0.1)" : "#a855f7",
              color: saving ? "rgba(255,255,255,0.36)" : "rgba(255,255,255,0.98)",
              fontSize: 17, fontWeight: 500, fontFamily: FONT,
              cursor: saving ? "not-allowed" : "pointer",
              letterSpacing: "-0.02em", display: "grid", placeItems: "center",
            }}
          >
            {saving ? tCommon("saving") : tCommon("confirm")}
          </button>
        </div>
      </section>
    </div>
  );
}
