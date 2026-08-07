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
import { doc, getDoc, collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { FIXED_SERVICE_FEE_MXN } from "@/lib/currency/catalog";
import { loadStripe, type StripeLike, type StripeElement } from "@/lib/stripe/loadStripe";
import VibraPayBrand from "./VibraPayBrand";
import PaymentSuccessCard from "./PaymentSuccessCard";
import { getGuestNickname, setGuestNickname, GUEST_NICKNAME_MAX } from "@/lib/guest/guestNickname";

export type SavedCard = { id: string; brand?: string; brandName?: string; lastFour?: string; stripePaymentMethodId?: string };

type Props = {
  open: boolean;
  amount: number | null; // monto base (sin IVA), en la moneda `amountCurrency`
  /** Moneda del `amount`: "MXN" (precios de servicios) o "USD" (ancla legacy). Default MXN
   *  (todo el dinero de Vibra es MXN; poner "USD" trataría el monto como dólares → ×FX). */
  amountCurrency?: "USD" | "MXN";
  /** Crea el PaymentIntent y devuelve su client_secret. `taxCountry` = país fiscal del comprador (por IP).
   *  Si `savedPaymentMethodId` viene, el cobro es "un clic" off-session (sin CVV): se confirma
   *  server-side y la respuesta trae `status` ("succeeded" = cobrado). */
  createIntent: (args: { amount: number; saveCard: boolean; taxCountry: string | null; savedPaymentMethodId?: string; nickname?: string | null }) => Promise<{ clientSecret?: string; status?: string }>;
  /** Invitado (sin login): en el saludo "Bienvenido" muestra un input de APODO editable
   *  (placeholder), cacheado por dispositivo y enviado en `createIntent`. */
  collectNickname?: boolean;
  amountEditable?: boolean;
  /** Montos sugeridos de DONACIÓN (base MXN). Si no se pasan, usa los defaults. */
  donationPresets?: number[];
  /** Si true, el monto CUSTOM que teclea el donante ya es el TOTAL (incluye $3 + IVA);
   *  se despeja la base = total/(1+iva) − $3. Los presets siguen siendo base. Para live donation. */
  donationCustomInclusive?: boolean;
  /** Mínimo de la BASE (monto del creador) en donación editable. El modal comunica el
   *  total mínimo (base + $3 + IVA) y deshabilita pagar por debajo. 0 = sin mínimo. */
  minBaseAmount?: number;
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
  /** Si se pasa (>0), el panel de éxito se cierra solo tras estos ms (p. ej. 4000). */
  autoCloseMs?: number;
  onClose: () => void;
  onPaid: () => void;
};

const ID_NUMBER = "vibra-stripe-card-number";
const ID_EXP = "vibra-stripe-card-exp";
const ID_CVC = "vibra-stripe-card-cvc";

const BLUE = "#009ee3";
const DEFAULT_DONATION_PRESETS_MXN = [50, 120, 250, 490];

const STRIPE_STYLE = {
  base: { fontSize: "15px", color: "#3a3f4a", fontFamily: "inherit", "::placeholder": { color: "#9aa0a8" } },
  invalid: { color: "#c0392b" },
};

export default function StripePaymentModal({
  open,
  amount,
  amountCurrency = "MXN",
  createIntent,
  amountEditable = false,
  donationPresets,
  donationCustomInclusive = false,
  minBaseAmount = 0,
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
  collectNickname = false,
  paymentHeading = "¿Cómo quieres pagar?",
  payButtonLabel = "Pagar",
  savedCards = [],
  autoCloseMs,
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
  // En celular (y no ya en modo sheet embebido), la pasarela se presenta como
  // bottom-sheet: sube al abrir y baja al cerrar. En laptop queda como diálogo centrado.
  const mobileSheet = stacked && !isSheet;
  const [buyer, setBuyer] = useState<{ name: string; photo: string | null } | null>(null);
  // Apodo del invitado (se pre-llena de la caché del dispositivo y es editable).
  const [nickname, setNickname] = useState("");
  // Invitado = sesión anónima. Para un invitado, una tarjeta guardada NO cobra un-clic:
  // re-pide el CVV (se recolecta con un Element solo-CVC y se confirma on-session).
  const [isGuest, setIsGuest] = useState(false);
  const [savedCvcValid, setSavedCvcValid] = useState(false);
  const savedCvcElRef = useRef<StripeElement | null>(null);
  const [render, setRender] = useState(false);
  const [entered, setEntered] = useState(false);
  // Tarjetas guardadas del comprador (Stripe). Se suscribe internamente para que CUALQUIER
  // pasarela las ofrezca, aunque el servicio no las pase como prop. Una tarjeta guardada en
  // un servicio queda disponible en todos (cobro "un clic" off-session, sin CVV).
  const [subscribedCards, setSubscribedCards] = useState<SavedCard[]>([]);
  const effectiveSavedCards = savedCards.length ? savedCards : subscribedCards;

  const pf = usePriceFormat();

  const isNewCard = selectedMethod === "credit" || selectedMethod === "debit";
  const savedCardId = selectedMethod?.startsWith("saved:") ? selectedMethod.slice(6) : null;
  const mxnAmount = amountEditable ? chosenAmount : (amount ?? null);

  // Donación editable: la base elegida debe alcanzar el mínimo (si el servicio lo exige).
  const belowMin = amountEditable && minBaseAmount > 0 && chosenAmount != null && chosenAmount < minBaseAmount;
  const amountOk = !amountEditable || (chosenAmount != null && chosenAmount > 0 && !belowMin);
  const canPay =
    amountOk &&
    (isNewCard
      ? cardValid.number && cardValid.exp && cardValid.cvc && cardName.trim().length > 0
      : savedCardId
        ? (isGuest ? savedCvcValid : true) // invitado re-pide CVV; cuenta real = un-clic off-session
        : false);

  const stripeRef = useRef<StripeLike | null>(null);
  const numberElRef = useRef<StripeElement | null>(null);
  const onPaidRef = useRef(onPaid);
  const createIntentRef = useRef(createIntent);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onPaidRef.current = onPaid;
    createIntentRef.current = createIntent;
    onCloseRef.current = onClose;
  }, [onPaid, createIntent, onClose]);

  // Cierre automático del panel de éxito cuando se pide (supercomentario / donación).
  useEffect(() => {
    if (showSuccess && autoCloseMs && autoCloseMs > 0) {
      const t = window.setTimeout(() => onCloseRef.current(), autoCloseMs);
      return () => window.clearTimeout(t);
    }
  }, [showSuccess, autoCloseMs]);

  const amountInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && entered && amountEditable && !showSuccess && !isSheet) {
      const t = window.setTimeout(() => amountInputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open, entered, amountEditable, showSuccess, isSheet]);

  // Contenedor scrolleable del modal: al pasar al panel de éxito lo llevamos al TOPE
  // para que la X de cerrar sea visible (si venía scrolleado desde el formulario).
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (showSuccess) scrollRef.current?.scrollTo({ top: 0 });
  }, [showSuccess]);

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

  // Invitado: pre-llena el apodo desde la caché del dispositivo al abrir.
  useEffect(() => {
    if (open && collectNickname) setNickname(getGuestNickname());
  }, [open, collectNickname]);

  // ¿La sesión es un invitado (anónima)? Determina si una tarjeta guardada re-pide CVV.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsGuest(!!auth.currentUser?.isAnonymous);
    const unsub = auth.onAuthStateChanged((u) => setIsGuest(!!u?.isAnonymous));
    return () => unsub();
  }, [open]);

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

  // Suscripción a las tarjetas guardadas de Stripe del comprador (solo docs con
  // `stripePaymentMethodId`; descarta legacy de MP). Habilita el cobro "un clic".
  useEffect(() => {
    if (!open) { setSubscribedCards([]); return; }
    const uid = auth.currentUser?.uid;
    if (!uid) { setSubscribedCards([]); return; }
    const unsub = onSnapshot(
      collection(db, "users", uid, "paymentMethods"),
      (snap) => setSubscribedCards(
        snap.docs
          .filter((d) => typeof d.data().stripePaymentMethodId === "string")
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              brand: typeof data.brand === "string" ? data.brand : undefined,
              brandName: typeof data.brandName === "string" ? data.brandName : undefined,
              lastFour: typeof data.lastFour === "string" ? data.lastFour : undefined,
              stripePaymentMethodId: typeof data.stripePaymentMethodId === "string" ? data.stripePaymentMethodId : undefined,
            };
          })
      ),
      () => setSubscribedCards([])
    );
    return () => unsub();
  }, [open]);

  // (B2) Invitado + tarjeta guardada seleccionada → monta un Element solo-CVC para
  // recolectar el CVV y confirmar on-session (no off-session). Espeja el montaje de la
  // tarjeta nueva pero solo con el campo CVC.
  useEffect(() => {
    if (!open || !sdkReady || !isGuest || !savedCardId) return;
    const stripe = stripeRef.current;
    if (!stripe) return;
    setSavedCvcValid(false);
    const elements = stripe.elements();
    const cvcEl = elements.create("cardCvc", { style: STRIPE_STYLE });
    savedCvcElRef.current = cvcEl;
    cvcEl.on("change", (e) => setSavedCvcValid((e as { complete?: boolean } | null)?.complete === true));
    const raf = requestAnimationFrame(() => {
      try { cvcEl.mount(`#vibra-saved-cvc-${savedCardId}`); } catch { /* no-op */ }
    });
    return () => {
      cancelAnimationFrame(raf);
      try { cvcEl.destroy(); } catch { /* no-op */ }
      if (savedCvcElRef.current === cvcEl) savedCvcElRef.current = null;
    };
  }, [open, sdkReady, isGuest, savedCardId]);

  // (A) Al abrir: carga Stripe.js.
  useEffect(() => {
    if (!open) return;
    // En donación (amountEditable) el monto es dinámico (se elige adentro) → NO exigir `amount`.
    if (!amountEditable && (!amount || amount <= 0)) { setError("No se pudo determinar el precio."); setLoading(false); return; }
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
        // IDs únicos por método: se monta SIEMPRE en el contenedor del método activo
        // (evita montar en un contenedor duplicado que se va a colapsar → campos muertos).
        numberEl.mount(`#${ID_NUMBER}-${selectedMethod}`);
        expEl.mount(`#${ID_EXP}-${selectedMethod}`);
        cvcEl.mount(`#${ID_CVC}-${selectedMethod}`);
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
    // Marca el pago como exitoso (pantalla verde o cierre, según successMessage).
    const markPaid = () => {
      if (successMessage) {
        setPaid(true);
        onPaidRef.current();
        window.setTimeout(() => setShowSuccess(true), 300);
      } else {
        onPaidRef.current();
      }
    };
    try {
      if (savedCardId) {
        const res = await createIntentRef.current({ amount: payAmount, saveCard: false, taxCountry: pf.buyerCountry ?? null, savedPaymentMethodId: savedCardId, nickname: collectNickname ? (nickname.trim() || null) : null });
        if (isGuest) {
          // Invitado: NO hay un-clic. El callable devolvió un clientSecret y aquí se confirma
          // ON-SESSION con la PM guardada + el CVV recolectado (Element solo-CVC). Así, en un
          // dispositivo compartido, sin la tarjeta física no se puede cobrar.
          const cvcEl = savedCvcElRef.current;
          const pmId = effectiveSavedCards.find((c) => c.id === savedCardId)?.stripePaymentMethodId;
          if (!res.clientSecret || !cvcEl || !pmId) throw new Error("no_secret");
          const result = await stripe.confirmCardPayment(res.clientSecret, {
            payment_method: pmId,
            payment_method_options: { card: { cvc: cvcEl } },
          });
          if (result.error) { setError(result.error.message || "No se pudo procesar el pago."); setSubmitting(false); return; }
          if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") { markPaid(); return; }
          throw new Error("rejected");
        }
        // Cuenta real: cobro "un clic" off-session (sin CVV); el callable confirma server-side.
        if (res.status === "succeeded" || res.status === "processing") { markPaid(); return; }
        // Requiere autenticación adicional (SCA): completa el 3DS con el client_secret.
        if (res.clientSecret) {
          const result = await stripe.confirmCardPayment(res.clientSecret);
          if (result.error) { setError(result.error.message || "No se pudo procesar el pago."); setSubmitting(false); return; }
          if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") { markPaid(); return; }
        }
        throw new Error("rejected");
      }
      // Tarjeta nueva.
      if (!cardName.trim()) throw new Error("no_name");
      const numberEl = numberElRef.current;
      if (!numberEl) throw new Error("no_element");

      const res = await createIntentRef.current({ amount: payAmount, saveCard, taxCountry: pf.buyerCountry ?? null, nickname: collectNickname ? (nickname.trim() || null) : null });
      // Sin factura que confirmar (p. ej. REACTIVAR una suscripción con cancelación
      // pendiente: no se cobra de nuevo). El backend ya dejó todo listo → éxito directo.
      if (res.status === "succeeded" || res.status === "processing") { markPaid(); return; }
      const clientSecret = res.clientSecret;
      if (!clientSecret) throw new Error("no_secret");
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: numberEl, billing_details: { name: cardName.trim() } },
      });
      if (result.error) {
        setError(result.error.message || "No se pudo procesar el pago.");
        setSubmitting(false);
        return;
      }
      if (result.paymentIntent?.status === "succeeded" || result.paymentIntent?.status === "processing") {
        markPaid();
        return;
      }
      throw new Error("rejected");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      // Errores del callable (HttpsError) traen su propio mensaje útil y en español
      // (ej. "En vivo no encontrado."); lo mostramos en vez del genérico.
      const fbCode = (err as { code?: unknown })?.code;
      const isCallableError = typeof fbCode === "string" && fbCode.includes("/");
      setError(
        code === "no_name" ? "Escribe el nombre como aparece en la tarjeta."
          : code === "no_element" ? "Recarga el formulario de tarjeta."
          : isCallableError && code ? code
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

  const cardFields = (kind: "credit" | "debit") => (
    <div style={{ display: "grid", gap: 14, padding: "6px 2px 18px" }}>
      <div>
        <label style={label}>Número de tarjeta</label>
        <div id={`${ID_NUMBER}-${kind}`} style={stripeBox} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><label style={label}>Vencimiento</label><div id={`${ID_EXP}-${kind}`} style={stripeBox} /></div>
        <div><label style={label}>CVC</label><div id={`${ID_CVC}-${kind}`} style={stripeBox} /></div>
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
            {(active || renderedMethod === kind) && cardFields(kind)}
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
        {/* Invitado: re-pide el CVV de la tarjeta guardada (sin volver a teclear el número). */}
        {isGuest && (
          <div style={{ display: "grid", gridTemplateRows: active ? "1fr" : "0fr", transition: "grid-template-rows 300ms cubic-bezier(0.4,0,0.2,1)" }}>
            <div style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}>
              <div style={{ display: "grid", gap: 6, padding: "2px 2px 16px", maxWidth: 170 }}>
                <label style={label}>CVV</label>
                <div id={`vibra-saved-cvc-${card.id}`} style={stripeBox} />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const leftColumn = (
    <div style={{ position: "relative", padding: stacked ? "24px 18px 4px" : "28px 24px 24px", minWidth: 0 }}>
      <button type="button" onClick={() => { if (!submitting) onClose(); }} aria-label="Cerrar"
        style={{ position: "absolute", top: 8, right: 10, zIndex: 2, border: "none", background: "none", color: "#9aa0a8", cursor: submitting ? "not-allowed" : "pointer", fontSize: 26, lineHeight: 1, padding: 4 }}>×</button>

      {stacked && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
          <VibraPayBrand />
        </div>
      )}

      {!hideBuyerGreeting && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#e6e8ec", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {buyer?.photo ? (
              <img src={buyer.photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              // Sin foto (invitado): ícono de persona genérica.
              <svg width="24" height="24" viewBox="0 0 24 24" fill="#9aa0a8" aria-hidden="true">
                <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z" />
              </svg>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: "#9aa0a8" }}>Bienvenido</div>
            {collectNickname ? (
              <input
                type="text"
                value={nickname}
                onChange={(e) => { const v = e.target.value.slice(0, GUEST_NICKNAME_MAX); setNickname(v); setGuestNickname(v); }}
                placeholder="Escribe tu apodo"
                maxLength={GUEST_NICKNAME_MAX}
                aria-label="Tu apodo"
                style={{ width: "100%", border: "none", borderBottom: "1px solid #e0e3e8", outline: "none", fontSize: 15, fontWeight: 600, color: "#3a3f4a", fontFamily: "inherit", padding: "2px 0", background: "transparent" }}
              />
            ) : (
              buyer?.name && <div style={{ fontSize: 15, fontWeight: 600, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{buyer.name}</div>
            )}
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
          {effectiveSavedCards.map((c) => savedCardRow(c))}
        </div>
      )}
    </div>
  );

  const effectiveAmount = amountEditable ? chosenAmount : amount;
  const isNonAnchor = pf.currency !== "USD";
  // En donación (amountEditable) el monto elegido es la BASE; el $3 fijo se suma en el
  // DISPLAY (el backend lo suma al cobrar). Los servicios ya reciben base+$3 en `amount`.
  const chargedBase = effectiveAmount != null ? effectiveAmount + (amountEditable ? FIXED_SERVICE_FEE_MXN : 0) : null;
  const totalLabel = chargedBase != null ? `${pf.format(chargedBase, { baseCurrency: amountCurrency })} ${pf.currency}` : priceLabel ?? "";
  const taxed = chargedBase != null ? pf.formatWithTax(chargedBase, { baseCurrency: amountCurrency }) : null;

  const rightColumn = (
    <div style={{ position: "relative", padding: stacked ? "16px 18px 20px" : "48px 24px 24px", background: "#fff", borderLeft: stacked ? "none" : "1px solid #eaecef", display: "flex", flexDirection: "column", justifyContent: "flex-start", gap: 12, minWidth: 0 }}>
      {!stacked && <VibraPayBrand style={{ position: "absolute", top: 22, right: 24 }} />}
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
            {(donationPresets && donationPresets.length ? donationPresets : DEFAULT_DONATION_PRESETS_MXN).map((base) => {
              const selected = selectedPreset === base;
              return (
                <button key={base} type="button"
                  onClick={() => {
                    setSelectedPreset(base); setChosenAmount(base);
                    // En modo inclusivo el input custom muestra el TOTAL (base+$3+IVA), igual
                    // que el botón, para no confundir al usuario. En modo base, muestra la base.
                    setCustomAmount(donationCustomInclusive
                      ? String(Math.round((base + FIXED_SERVICE_FEE_MXN) * (1 + pf.taxRate) * 100) / 100)
                      : String(base));
                  }}
                  style={{ padding: "9px 2px", borderRadius: 10, border: "none", background: selected ? "#eaf6fd" : "transparent", color: selected ? BLUE : "#3a3f4a", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}>
                  {/* Todo-incluido desde el inicio: (base + $3) + IVA. */}
                  {pf.formatWithTax(base + FIXED_SERVICE_FEE_MXN, { baseCurrency: "MXN" }).total}
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
                  const typed = Number(v);
                  if (!Number.isFinite(typed) || typed <= 0) { setChosenAmount(null); return; }
                  if (donationCustomInclusive) {
                    // Lo tecleado YA es el TOTAL (incluye $3 + IVA): NO se suma nada. Despejamos
                    // la base (base + $3 = total/(1+iva)) para que abajo se DESGLOSE el IVA de
                    // ese total y el total cobrado sea exactamente lo que escribió el usuario.
                    const base = typed / (1 + pf.taxRate) - FIXED_SERVICE_FEE_MXN;
                    setChosenAmount(base > 0 ? Math.round(base * 100) / 100 : null);
                  } else {
                    // El donador teclea la BASE directo en MXN (México-only, sin conversión).
                    const n = Math.floor(typed);
                    setChosenAmount(n > 0 ? n : null);
                  }
                }}
                placeholder="0" style={{ width: 120, border: "none", borderBottom: "1px solid #eceef1", background: "transparent", fontSize: 22, fontWeight: 700, color: "#3a3f4a", textAlign: "center", outline: "none", fontFamily: "inherit", padding: "0 2px 4px" }} />
              <span style={{ fontSize: 13, color: "#9aa0a8", fontWeight: 600 }}>MXN</span>
            </div>
          </div>
          {minBaseAmount > 0 && (
            <div style={{ textAlign: "center", fontSize: 11.5, fontWeight: 600, color: belowMin ? "#c0392b" : "#9aa0a8" }}>
              Mínimo {pf.formatWithTax(minBaseAmount + FIXED_SERVICE_FEE_MXN, { baseCurrency: "MXN" }).total} {pf.currency}
            </div>
          )}
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
        <span>Tu pago está protegido por <span style={{ color: BLUE, fontWeight: 600 }}>Stripe</span></span>
      </div>
    </div>
  );

  const successView = (
    <PaymentSuccessCard
      avatarUrl={avatarUrl}
      providerName={providerName}
      productType={productType}
      successMessage={successMessage}
      onClose={onClose}
      locale={locale}
      stacked={stacked}
    />
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
        : mobileSheet
          ? { position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "flex-end", justifyContent: "center", background: "rgba(0,0,0,0.55)", opacity: entered ? 1 : 0, transition: "opacity 220ms ease", willChange: "opacity" }
          : { position: "fixed", inset: 0, zIndex: 2147483647, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "rgba(0,0,0,0.55)", opacity: entered ? 1 : 0, transition: "opacity 220ms ease", willChange: "opacity" }}>
      <div ref={scrollRef} onClick={(e) => e.stopPropagation()}
        style={isSheet
          ? { position: "absolute", inset: 0, boxSizing: "border-box", overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y", background: "#fff", color: "#3a3f4a", paddingBottom: "var(--vb-safe-bottom, 0px)", transform: entered ? "translateY(0)" : "translateY(100%)", transition: "transform 240ms cubic-bezier(0.2,0.8,0.2,1)", willChange: "transform" }
          : mobileSheet
            ? { position: "relative", width: "100%", maxHeight: "92vh", boxSizing: "border-box", overflowY: "auto", background: "#fff", borderRadius: "16px 16px 0 0", boxShadow: "0 -12px 48px rgba(0,0,0,0.4)", color: "#3a3f4a", paddingBottom: "var(--vb-safe-bottom, 0px)", transform: entered ? "translateY(0)" : "translateY(100%)", transition: "transform 240ms cubic-bezier(0.2,0.8,0.2,1)", willChange: "transform" }
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
