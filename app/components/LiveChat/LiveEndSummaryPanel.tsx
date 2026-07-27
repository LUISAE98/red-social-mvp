"use client";

import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useTranslations } from "next-intl";
import VibraToast from "@/app/components/VibraToast/VibraToast";
import { useVibraToast } from "@/lib/hooks/useVibraToast";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
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
  const tLive = useTranslations("live");
  const { resolveStoredPrice, toDisplayForInput, currency: displayCurrency, formatAnchor } =
    usePriceFormat();
  const liveData = post.liveData;
  const defaultPaid = liveData?.accessType === "paid";
  // El precio guardado está en MXN (ancla); lo mostramos en la moneda del creador.
  const defaultPrice = liveData?.ticketPrice
    ? String(Math.round(toDisplayForInput(liveData.ticketPrice, "MXN") * 100) / 100)
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
    // El creador teclea en su moneda; validamos y GUARDAMOS en MXN (ancla).
    const typedPrice = vodAvailable && vodPaid ? (parseFloat(priceInput) || null) : null;
    if (vodAvailable && vodPaid && (!typedPrice || typedPrice <= 0)) {
      showSummaryToast(tLive("invalidPrice"), "error");
      return;
    }
    const price =
      typedPrice != null && typedPrice > 0 ? resolveStoredPrice(typedPrice).price : null;
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
      showSummaryToast(tLive("saveFailed"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (!mounted) return null;

  // ── Toggle helper ──────────────────────────────────────────────────────────
  function Toggle({ value, onChange, labelOn, labelOff }: { value: boolean; onChange: (v: boolean) => void; labelOn: string; labelOff: string }) {
    return (
      <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: BORDER, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => onChange(true)}
          style={{
            padding: "7px 14px", border: "none", cursor: "pointer", fontFamily: FONT,
            fontSize: 13, fontWeight: value ? 600 : 400,
            background: value ? "#a855ff" : "transparent",
            color: value ? "#fff" : "rgba(255,255,255,0.45)",
            transition: "background 0.15s, color 0.15s",
          }}
        >{labelOn}</button>
        <button
          type="button"
          onClick={() => onChange(false)}
          style={{
            padding: "7px 14px", border: "none", cursor: "pointer", fontFamily: FONT,
            fontSize: 13, fontWeight: !value ? 600 : 400,
            background: !value ? "#a855ff" : "transparent",
            color: !value ? "#fff" : "rgba(255,255,255,0.45)",
            transition: "background 0.15s, color 0.15s",
          }}
        >{labelOff}</button>
      </div>
    );
  }

  function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 0", borderBottom: BORDER }}>
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
      <Row label={tLive("makeVodAvailable")} description={tLive("makeVodAvailableDesc")}>
        <Toggle value={vodAvailable} onChange={setVodAvailable} labelOn={tCommon("yes")} labelOff={tCommon("no")} />
      </Row>

      {/* Las opciones de fijar y ticket solo aparecen si el VOD quedará disponible */}
      {vodAvailable && (
        <>
          <Row label={tLive("pinVodInFeed")} description={tLive("pinVodInFeedDesc")}>
            <Toggle value={keepPinned} onChange={setKeepPinned} labelOn={tCommon("yes")} labelOff={tCommon("no")} />
          </Row>

          <Row label={tLive("accessTicket")} description={tLive("accessTicketDesc")}>
            <Toggle value={vodPaid} onChange={setVodPaid} labelOn={tLive("charge")} labelOff={tLive("free")} />
          </Row>

          {vodPaid && (
            <div style={{ paddingTop: 2, paddingBottom: 14 }}>
              <label style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: FONT, display: "block", marginBottom: 8 }}>
                Precio del ticket
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", fontFamily: FONT }}>$</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  placeholder={defaultPrice || "0"}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(255,255,255,0.06)", color: "#fff",
                    fontSize: 15, fontFamily: FONT, outline: "none",
                  }}
                />
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: FONT }}>{displayCurrency}</span>
              </div>
              {displayCurrency !== "USD" &&
              priceInput !== "" &&
              Number(priceInput) > 0 ? (
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", fontFamily: FONT, marginTop: 6 }}>
                  = {formatAnchor(resolveStoredPrice(Number(priceInput)).price)}
                </div>
              ) : null}
            </div>
          )}
        </>
      )}

      <VibraToast toast={summaryToast} />
    </>
  );

  // ── MOBILE bottom sheet ────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{
          position: "fixed", inset: 0, width: "100vw", height: "100dvh",
          zIndex: 999999, display: "flex", alignItems: "flex-end", justifyContent: "center",
          padding: "0 0 env(safe-area-inset-bottom)",
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
                  Resumen del live
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
                background: saving ? "rgba(255,255,255,0.1)" : "#a855ff",
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
        position: "fixed", inset: 0, width: "100vw", height: "100dvh",
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
            Resumen del live
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon("closeAriaLabel")}
            style={{ border: "none", background: "none", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center", justifySelf: "end", padding: 4 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
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
              background: saving ? "rgba(255,255,255,0.1)" : "#a855ff",
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
