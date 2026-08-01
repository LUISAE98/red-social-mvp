"use client";

// Pasarela de pago de Vibra — STRIPE (Elements por CDN).
//
// MISMO diseño que la de Mercado Pago (`ServicePaymentModal`), motor Stripe:
//   Izquierda → "¿Cómo quieres pagar?": acordeón (crédito/débito nuevos + guardadas).
//   Derecha   → creador + servicio + total (Subtotal/IVA/Total) + "Pagar" + éxito verde.
// Tarjeta NUEVA → Card Elements (número/exp/CVC, iframes PCI). Guardada → un clic sin
// CVV (Stripe off-session; el cobro de guardadas se conecta en S3c).

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { loadStripe, type StripeLike, type StripeElement } from "@/lib/stripe/loadStripe";

export type SavedCard = { id: string; brand?: string; brandName?: string; lastFour?: string };

type Props = {
  open: boolean;
  amount: number | null; // MXN base (sin IVA)
  /** Crea el PaymentIntent y devuelve su client_secret. */
  createIntent: (args: { amount: number; saveCard: boolean }) => Promise<{ clientSecret: string }>;
  amountEditable?: boolean;
  priceLabel?: string;
  pricePeriodLabel?: string;
  productType?: string;
  providerName?: string;
  avatarUrl?: string | null;
  description?: string | null;
  successMessage?: string | null;
  durationMinutes?: number | null;
  locale?: string;
  presentation?: "dialog" | "sheet";
  container?: HTMLElement | null;
  /** Fuerza el layout apilado (vista celular) aunque la ventana sea ancha. Para el simulador. */
  forceStacked?: boolean;
  hideBuyerGreeting?: boolean;
  paymentHeading?: string;
  payButtonLabel?: string;
  savedCards?: SavedCard[];
  onClose: () => void;
  onPaid: () => void;
};

const ID_NUMBER = "vibra-stripe-card-number";
const ID_EXP = "vibra-stripe-card-exp";
const ID_CVC = "vibra-stripe-card-cvc";

const BLUE = "#009ee3";
const GREEN = "#00a650";
const DONATION_PRESETS_USD = [2, 5, 10, 20];

const STRIPE_STYLE = {
  base: { fontSize: "15px", color: "#3a3f4a", fontFamily: "inherit", "::placeholder": { color: "#9aa0a8" } },
  invalid: { color: "#c0392b" },
};

export default function StripePaymentModal({
  open,
  amount,
  createIntent,
  amountEditable = false,
  priceLabel,
  pricePeriodLabel,
  productType,
  providerName,
  avatarUrl,
  description,
  successMessage,
  durationMinutes,
  locale = "es-MX",
  presentation = "dialog",
  container,
  forceStacked = false,
  hideBuyerGreeting = false,
  paymentHeading = "¿Cómo quieres pagar?",
  payButtonLabel = "Pagar",
  savedCards = [],
  onClose,
  onPaid,
}: Props) {
  const isSheet = presentation === "sheet";
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [paid, setPaid] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [chosenAmount, setChosenAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [cardName, setCardName] = useState("");
  const [saveCard, setSaveCard] = useState(true);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [renderedMethod, setRenderedMethod] = useState<string | null>(null);
  const [cardValid, setCardValid] = useState({ number: false, exp: false, cvc: false });
  const [isNarrow, setIsNarrow] = useState(false);
  const stacked = isNarrow || isSheet || forceStacked;
  const [buyer, setBuyer] = useState<{ name: string; photo: string | null } | null>(null);
  const [render, setRender] = useState(false);
  const [entered, setEntered] = useState(false);

  const pf = usePriceFormat();

  const isNewCard = selectedMethod === "credit" || selectedMethod === "debit";
  const savedCardId = selectedMethod?.startsWith("saved:") ? selectedMethod.slice(6) : null;
  const mxnAmount = amountEditable ? chosenAmount : (amount ?? null);

  const amountOk = !amountEditable || (chosenAmount != null && chosenAmount > 0);
  const canPay =
    amountOk &&
    (isNewCard
      ? cardValid.number && cardValid.exp && cardValid.cvc && cardName.trim().length > 0
      : savedCardId
        ? true // guardada = un clic (sin CVV con Stripe off-session)
        : false);

  const stripeRef = useRef<StripeLike | null>(null);
  const numberElRef = useRef<StripeElement | null>(null);
  const onPaidRef = useRef(onPaid);
  const createIntentRef = useRef(createIntent);
  useEffect(() => {
    onPaidRef.current = onPaid;
    createIntentRef.current = createIntent;
  }, [onPaid, createIntent]);

  const amountInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && entered && amountEditable && !showSuccess && !isSheet) {
      const t = window.setTimeout(() => amountInputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, entered, amountEditable, showSuccess, isSheet]);

  useEffect(() => {
    setMounted(true);
    const check = () => setIsNarrow(window.innerWidth <= 720);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Entrada/salida animada.
  useEffect(() => {
    if (open) {
      setRender(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setEntered(false);
    const t = window.setTimeout(() => setRender(false), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  useBodyScrollLock(open && !isSheet);

  // Perfil del comprador (saludo).
  useEffect(() => {
    if (!open) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { setBuyer(null); return; }
    let cancelled = false;
    getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const d = snap.data();
        setBuyer({
          name: (typeof d?.displayName === "string" && d.displayName) || (typeof d?.firstName === "string" && d.firstName) || "",
          photo: typeof d?.photoURL === "string" ? d.photoURL : null,
        });
      })
      .catch(() => { if (!cancelled) setBuyer(null); });
    return () => { cancelled = true; };
  }, [open]);

  // (A) Al abrir: carga Stripe.js.
  useEffect(() => {
    if (!open) return;
    if (!amount || amount <= 0) { setError("No se pudo determinar el precio."); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSdkReady(false);
    setSelectedMethod(null);
    setPaid(false);
    setShowSuccess(false);
    setChosenAmount(amountEditable ? null : amount ?? null);
    setCustomAmount("");
    setSelectedPreset(null);

    loadStripe()
      .then((s) => { if (cancelled) return; stripeRef.current = s; setSdkReady(true); setLoading(false); })
      .catch(() => { if (cancelled) return; setError("No se pudo cargar el pago. Intenta de nuevo."); setLoading(false); });

    return () => { cancelled = true; };
  }, [open, amount, amountEditable]);

  // (B) Monta los Card Elements de la tarjeta nueva.
  useEffect(() => {
    if (!open || !sdkReady || !isNewCard) return;
    const stripe = stripeRef.current;
    if (!stripe) return;
    setCardValid({ number: false, exp: false, cvc: false });
    const elements = stripe.elements();
    const numberEl = elements.create("cardNumber", { style: STRIPE_STYLE, placeholder: "1234 1234 1234 1234", showIcon: true });
    const expEl = elements.create("cardExpiry", { style: STRIPE_STYLE });
    const cvcEl = elements.create("cardCvc", { style: STRIPE_STYLE });
    numberElRef.current = numberEl;

    const complete = (e: unknown) => (e as { complete?: boolean } | null)?.complete === true;
    numberEl.on("change", (e) => setCardValid((v) => ({ ...v, number: complete(e) })));
    expEl.on("change", (e) => setCardValid((v) => ({ ...v, exp: complete(e) })));
    cvcEl.on("change", (e) => setCardValid((v) => ({ ...v, cvc: complete(e) })));

    // rAF: espera a que el contenedor esté en el DOM (dentro del acordeón).
    const raf = requestAnimationFrame(() => {
      try {
        numberEl.mount(`#${ID_NUMBER}`);
        expEl.mount(`#${ID_EXP}`);
        cvcEl.mount(`#${ID_CVC}`);
      } catch {
        setError("No se pudo cargar el formulario. Intenta de nuevo.");
      }
    });

    return () => {
      cancelAnimationFrame(raf);
      for (const el of [numberEl, expEl, cvcEl]) { try { el.destroy(); } catch { /* no-op */ } }
      if (numberElRef.current === numberEl) numberElRef.current = null;
    };
    // selectedMethod: al cambiar entre crédito/débito re-monta en el contenedor nuevo.
  }, [open, sdkReady, isNewCard, selectedMethod]);

  // Mantiene el cuerpo del acordeón ~320ms al cerrar (para animar la altura).
  useEffect(() => {
    if (selectedMethod) { setRenderedMethod(selectedMethod); return; }
    const t = window.setTimeout(() => setRenderedMethod(null), 320);
    return () => window.clearTimeout(t);
  }, [selectedMethod]);

  function toggleMethod(id: string) {
    setSelectedMethod((prev) => (prev === id ? null : id));
    setError(null);
  }

  async function handlePay() {
    if (submitting) return;
    if (!selectedMethod) { setError("Elige un método de pago."); return; }
    const stripe = stripeRef.current;
    if (!stripe) return;
    const payAmount = (amountEditable ? chosenAmount : amount) ?? null;
    if (payAmount == null || payAmount <= 0) { setError("Monto inválido."); return; }

    setSubmitting(true);
    setError(null);
    try {
      if (savedCardId) {
        // El cobro de tarjeta guardada (off-session, un clic) se conecta en S3c.
        setError("El cobro con tarjeta guardada se conecta en el siguiente paso (S3c).");
        setSubmitting(false);
        return;
      }
      // Tarjeta nueva.
      if (!cardName.trim()) throw new Error("no_name");
      const numberEl = numberElRef.current;
      if (!numberEl) throw new Error("no_element");

      const { clientSecret } = await createIntentRef.current({ amount: payAmount, saveCard });
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: numberEl, billing_details: { name: cardName.trim() } },
      });
      if (result.error) {
        setError(result.error.message || "No se pudo procesar el pago.");
        setSubmitting(false);
        return;
      }
      if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") {
        if (successMessage) {
          setPaid(true);
          onPaidRef.current();
          window.setTimeout(() => setShowSuccess(true), 300);
        } else {
          onPaidRef.current();
        }
        return;
      }
      throw new Error("rejected");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(
        code === "no_name" ? "Escribe el nombre como aparece en la tarjeta."
          : code === "no_element" ? "Recarga el formulario de tarjeta."
          : "No se pudo procesar el pago. Revisa los datos e intenta de nuevo."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !render) return null;

  // ── Estilos (panel claro) ──
  const label: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "#5b616e", marginBottom: 6, display: "block" };
  const box: React.CSSProperties = { height: 40, borderRadius: 10, border: "1px solid #e3e6ea", background: "#fff", padding: "0 12px", display: "flex", alignItems: "center", boxSizing: "border-box" };
  // Contenedor de los Card Elements de Stripe: bloque simple (SIN flex/alto fijo), el
  // iframe de Stripe lo llena; el padding vertical le da la altura (~40px).
  const stripeBox: React.CSSProperties = { borderRadius: 10, border: "1px solid #e3e6ea", background: "#fff", padding: "12px 12px", boxSizing: "border-box" };
  const textInput: React.CSSProperties = { ...box, width: "100%", color: "#3a3f4a", fontSize: 15, outline: "none", fontFamily: "inherit" };
  const cardIcon = (active: boolean) => (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={active ? BLUE : "#8a8f99"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2.5" /><path d="M2 10h20" />
    </svg>
  );
  const radio = (active: boolean) => (
    <span style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${active ? BLUE : "#b8bcc4"}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
      {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: BLUE }} />}
    </span>
  );

  const cardFields = (
    <div style={{ display: "grid", gap: 14, padding: "6px 2px 18px" }}>
      <div>
        <label style={label}>Número de tarjeta</label>
        <div id={ID_NUMBER} style={stripeBox} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={label}>Vencimiento</label><div id={ID_EXP} style={stripeBox} /></div>
        <div><label style={label}>CVC</label><div id={ID_CVC} style={stripeBox} /></div>
      </div>
      <div>
        <label style={label}>Nombre en la tarjeta</label>
        <style>{`.vibra-pay-input::placeholder{color:#9aa0a8;opacity:1}`}</style>
        <input className="vibra-pay-input" value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Como aparece en la tarjeta" autoComplete="cc-name" disabled={submitting} style={textInput} />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
        <span style={{ fontSize: 13, color: "#8a8f99", fontWeight: 500 }}>Guardar tarjeta para futuras compras</span>
        <button type="button" role="switch" aria-checked={saveCard} aria-label="Guardar tarjeta" onClick={() => setSaveCard((v) => !v)} disabled={submitting}
          style={{ position: "relative", width: 40, height: 22, borderRadius: 999, border: "none", padding: 0, flexShrink: 0, cursor: submitting ? "not-allowed" : "pointer", background: saveCard ? BLUE : "#d4d7dc", transition: "background 180ms ease" }}>
          <span style={{ position: "absolute", top: 2, left: saveCard ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 180ms ease", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
        </button>
      </div>
    </div>
  );

  const rowButton: React.CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "15px 2px", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" };
  const rowDivider: React.CSSProperties = { borderBottom: "1px solid #eceef1" };

  function newCardRow(kind: "credit" | "debit", title: string) {
    const active = selectedMethod === kind;
    return (
      <div key={kind} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(kind)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>{title}</span>
          {radio(active)}
        </button>
        <div style={{ display: "grid", gridTemplateRows: active ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
          <div style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}>
            {(active || renderedMethod === kind) && cardFields}
          </div>
        </div>
      </div>
    );
  }

  function savedCardRow(card: SavedCard) {
    const id = `saved:${card.id}`;
    const active = selectedMethod === id;
    const brandLabel = card.brandName ? card.brandName : card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : "Tarjeta";
    return (
      <div key={id} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(id)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>{brandLabel} ···· {card.lastFour ?? "••••"}</span>
          {radio(active)}
        </button>
      </div>
    );
  }

  const leftColumn = (
    <div style={{ position: "relative", padding: stacked ? "24px 18px 4px" : "28px 24px 24px", minWidth: 0 }}>
      <button type="button" onClick={() => { if (!submitting) onClose(); }} aria-label="Cerrar"
        style={{ position: "absolute", top: 8, right: 10, zIndex: 2, border: "none", background: "none", color: "#9aa0a8", cursor: submitting ? "not-allowed" : "pointer", fontSize: 26, lineHeight: 1, padding: 4 }}>×</button>

      {!hideBuyerGreeting && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#e6e8ec" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {buyer?.photo ? <img src={buyer.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#9aa0a8" }}>Bienvenido</div>
            {buyer?.name && <div style={{ fontSize: 15, fontWeight: 600, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{buyer.name}</div>}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#3a3f4a" }}>{paymentHeading}</h4>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#9aa0a8", fontWeight: 400 }}>Elige tu forma de pago</p>
      </div>

      {loading ? (
        <p style={{ color: "#8a8f99", fontSize: 14 }}>Cargando pago seguro…</p>
      ) : (
        <div style={{ display: "grid" }}>
          {newCardRow("credit", "Tarjeta de crédito")}
          {newCardRow("debit", "Tarjeta de débito")}
          {savedCards.map((c) => savedCardRow(c))}
        </div>
      )}
    </div>
  );

  const effectiveAmount = amountEditable ? chosenAmount : amount;
  const isNonAnchor = pf.currency !== "USD";
  const totalLabel = effectiveAmount != null ? `${pf.format(effectiveAmount)} ${pf.currency}` : priceLabel ?? "";
  const taxed = effectiveAmount != null ? pf.formatWithTax(effectiveAmount) : null;

  const rightColumn = (
    <div style={{ position: "relative", padding: stacked ? "16px 18px 20px" : "48px 24px 24px", background: "#fff", borderLeft: stacked ? "none" : "1px solid #eaecef", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, minWidth: 0 }}>
      {/* Creador */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 48, height: 48, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#e6e8ec" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {avatarUrl ? <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
        </div>
        <div style={{ minWidth: 0 }}>
          {providerName && <div style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{providerName}</div>}
          {productType && <div style={{ fontSize: 12.5, color: "#6b7280" }}>{productType}</div>}
        </div>
      </div>

      {durationMinutes ? (
        <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.4 }}><strong style={{ fontWeight: 600, color: "#3a3f4a" }}>Duración:</strong> {durationMinutes} minutos</span>
            <span style={{ fontSize: 12.5, color: "#5b616e", lineHeight: 1.4 }}><strong style={{ fontWeight: 600, color: "#3a3f4a" }}>Modalidad:</strong> En línea, desde cualquier parte del mundo</span>
          </div>
        </div>
      ) : description ? (
        <div style={{ display: "grid", gap: 10, marginTop: 2 }}>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          <p style={{ margin: 0, fontSize: 12.5, color: "#5b616e", lineHeight: 1.5 }}>{description}</p>
        </div>
      ) : null}

      {amountEditable ? (
        <>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
            {DONATION_PRESETS_USD.map((usd) => {
              const selected = selectedPreset === usd;
              return (
                <button key={usd} type="button"
                  onClick={() => { setSelectedPreset(usd); setChosenAmount(usd); setCustomAmount(String(Math.round(pf.toDisplayForInput(usd, "USD")))); }}
                  style={{ padding: "9px 2px", borderRadius: 10, border: "none", background: selected ? "#eaf6fd" : "transparent", color: selected ? BLUE : "#3a3f4a", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {pf.format(usd, { code: true })}
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gap: 6, justifyItems: "center", marginTop: 2 }}>
            <span style={{ fontSize: 12.5, color: "#6b7280", fontWeight: 600 }}>Otro monto</span>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: "#3a3f4a" }}>$</span>
              <input ref={amountInputRef} type="number" inputMode="decimal" min={1} className="vibra-amount-input" value={customAmount}
                onChange={(e) => {
                  const v = e.target.value; setCustomAmount(v); setSelectedPreset(null);
                  const n = Math.floor(Number(v));
                  if (Number.isFinite(n) && n > 0) { const mxn = isNonAnchor ? pf.toAnchor(n) : n; setChosenAmount(mxn != null ? Math.round(mxn) : null); }
                  else setChosenAmount(null);
                }}
                placeholder="0" style={{ width: 120, border: "none", borderBottom: "1px solid #eceef1", background: "transparent", fontSize: 22, fontWeight: 700, color: "#3a3f4a", textAlign: "center", outline: "none", fontFamily: "inherit", padding: "0 2px 4px" }} />
              <span style={{ fontSize: 13, color: "#9aa0a8", fontWeight: 600 }}>{pf.currency}</span>
            </div>
          </div>
          {taxed?.applies && chosenAmount != null && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #e6e8ec", display: "grid", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>Subtotal</span><span>{taxed.base} {taxed.currency}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>{taxed.taxName} ({Math.round(taxed.rate * 100)}%)</span><span>{taxed.tax} {taxed.currency}</span></div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}><span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Total a pagar</span><span style={{ fontSize: 16, fontWeight: 600, color: "#3a3f4a" }}>{taxed.total} {taxed.currency}</span></div>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ height: 1, background: "#e6e8ec" }} />
          {taxed?.applies ? (
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>Subtotal</span><span>{taxed.base} {taxed.currency}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#8a8f99" }}><span>{taxed.taxName} ({Math.round(taxed.rate * 100)}%)</span><span>{taxed.tax} {taxed.currency}</span></div>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{pricePeriodLabel ? "Cobro mensual" : "Total a pagar"}</span>
                <span style={{ fontSize: 17, fontWeight: 600, color: "#3a3f4a" }}>{taxed.total} {taxed.currency}{pricePeriodLabel ? ` / ${pricePeriodLabel}` : ""}</span>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>{pricePeriodLabel ? "Cobro mensual" : "Total a pagar"}</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: "#3a3f4a" }}>{totalLabel}{pricePeriodLabel ? ` / ${pricePeriodLabel}` : ""}</span>
            </div>
          )}
        </>
      )}

      {error && <p style={{ margin: 0, color: "#c0392b", fontSize: 11, textAlign: "center" }}>{error}</p>}

      <button type="button" onClick={handlePay} disabled={submitting || loading || !canPay}
        style={{ position: "relative", overflow: "hidden", height: 40, borderRadius: 10, border: "none", background: loading || (!canPay && !submitting) ? "#9fd8f2" : BLUE, color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "inherit", cursor: submitting || loading || !canPay ? "not-allowed" : "pointer" }}>
        {submitting && <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.28)", transformOrigin: "left center", animation: "vibraBtnFill 2400ms ease-out forwards" }} />}
        <span style={{ position: "relative" }}>{submitting ? "Procesando…" : payButtonLabel}</span>
      </button>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 11, color: "#8a8f99", marginTop: -6 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={BLUE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3z" /><path d="M9 12l2 2 4-4" />
        </svg>
        <span>Pago protegido y cifrado</span>
      </div>
    </div>
  );

  const purchaseDate = new Date().toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const successView = (
    <div style={{ height: stacked ? 480 : 440, display: "flex", flexDirection: "column", position: "relative" }}>
      <button type="button" onClick={onClose} aria-label="Cerrar" style={{ position: "absolute", top: 10, right: 16, zIndex: 2, border: "none", background: "transparent", color: "#fff", fontSize: 32, lineHeight: 1, padding: 2, cursor: "pointer" }}>×</button>
      <div style={{ position: "absolute", top: 16, left: 0, right: 0, zIndex: 2, textAlign: "center", color: "rgba(255,255,255,0.85)", fontSize: 13, fontWeight: 500, pointerEvents: "none", animation: "vibraFade 300ms ease both" }}>{purchaseDate}</div>
      <div style={{ flex: 2, background: GREEN, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 7, padding: "88px 24px 14px", animation: "vibraFade 300ms ease both" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {avatarUrl ? <img src={avatarUrl} alt={providerName ?? ""} style={{ width: 128, height: 128, borderRadius: "50%", objectFit: "cover", boxShadow: "0 8px 24px rgba(0,0,0,0.18)", animation: "vibraPop 460ms cubic-bezier(0.2,0.9,0.2,1.2) both", animationDelay: "120ms" }} /> : null}
        {providerName ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ color: "#fff", fontSize: 20, fontWeight: 600, textAlign: "center", animation: "vibraFade 360ms ease both", animationDelay: "260ms" }}>{providerName}</span>
            {productType ? <span style={{ color: "rgba(255,255,255,0.75)", fontSize: 15, fontWeight: 500, textAlign: "center", animation: "vibraFade 360ms ease both", animationDelay: "340ms" }}>{productType}</span> : null}
          </div>
        ) : null}
      </div>
      <div style={{ flex: 1, background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "18px 28px 26px" }}>
        <p style={{ margin: 0, fontSize: 13.5, color: "#5b616e", textAlign: "center", lineHeight: 1.5, maxWidth: 380, animation: "vibraFadeUp 420ms ease both", animationDelay: "420ms" }}>{successMessage}</p>
        <div style={{ width: 38, height: 38, borderRadius: "50%", background: GREEN, display: "flex", alignItems: "center", justifyContent: "center", animation: "vibraPop 480ms cubic-bezier(0.2,0.9,0.2,1.25) both", animationDelay: "560ms" }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" /></svg>
        </div>
      </div>
    </div>
  );

  const keyframes = `
    @keyframes vibraPop { 0% { transform: scale(0); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes vibraFade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes vibraFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes vibraBtnFill { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }
    .vibra-amount-input::-webkit-outer-spin-button, .vibra-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    .vibra-amount-input { -moz-appearance: textfield; appearance: textfield; }
  `;

  return createPortal(
    <div role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
      style={isSheet
        ? { position: "absolute", inset: 0, zIndex: 60, display: "flex", alignItems: "stretch", justifyContent: "stretch", background: "transparent" }
        : { position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.55)", opacity: entered ? 1 : 0, transition: "opacity 220ms ease", willChange: "opacity" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={isSheet
          ? { position: "relative", width: "100%", height: "100%", boxSizing: "border-box", overflowY: "auto", background: "#fff", color: "#3a3f4a", paddingBottom: "var(--vb-safe-bottom, 0px)", transform: entered ? "translateY(0)" : "translateY(100%)", transition: "transform 240ms cubic-bezier(0.2,0.8,0.2,1)", willChange: "transform" }
          : { position: "relative", width: isNarrow || forceStacked ? "min(100%, 440px)" : "min(100%, 660px)", maxHeight: "92vh", overflowY: "auto", background: "#fff", borderRadius: 16, boxShadow: "0 24px 72px rgba(0,0,0,0.4)", color: "#3a3f4a", opacity: entered ? 1 : 0, transform: entered ? "translateY(0) scale(1)" : "translateY(10px) scale(0.985)", transition: "opacity 220ms ease, transform 240ms cubic-bezier(0.2,0.8,0.2,1)", willChange: "opacity, transform" }}>
        <style>{keyframes}</style>
        {showSuccess ? successView : (
          <div style={{ opacity: paid ? 0 : 1, transition: "opacity 280ms ease" }}>
            <div style={{ display: "grid", gridTemplateColumns: stacked ? "1fr" : "1.05fr 1fr", alignItems: "stretch" }}>
              {leftColumn}
              {rightColumn}
            </div>
          </div>
        )}
      </div>
    </div>,
    (isSheet ? container : null) ?? document.body
  );
}
