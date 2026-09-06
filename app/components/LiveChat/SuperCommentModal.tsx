"use client";

import { useState, useEffect, useRef } from "react";
import { formatCurrency } from "@/lib/currency/format";
import { aroDegradado } from "@/lib/liveChat/types";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { TextButton } from "@/components/ui";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import { getSavedGuestNickname, saveGuestNickname } from "@/lib/guest-id";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { useBuyerCredit } from "@/lib/wallet/useBuyerCredit";
import { createSuperCommentStripeIntent } from "@/lib/stripe/stripePayments";
import { ensureGuestAuth } from "@/lib/guest/ensureGuestAuth";
import { FIXED_SERVICE_FEE_USD } from "@/lib/currency/catalog";
import StripePaymentModal, { type SavedCard } from "@/components/payments/StripePaymentModal";
import PaymentSuccessCard from "@/components/payments/PaymentSuccessCard";
import type { SuperCommentConfig, SuperCommentTier } from "@/lib/liveChat/types";

const FONT = 'inherit';

type Props = {
  open: boolean;
  onClose: () => void;
  postId: string;
  authorId?: string | null;
  /** undefined = modo invitado */
  userId?: string;
  username?: string;
  avatarUrl?: string | null;
  /** Solo cuando userId es undefined */
  guestId?: string;
  config: SuperCommentConfig;
  /** "dialog" (default, bottom-sheet a pantalla completa con backdrop oscuro) o
   *  "sheet" (contenido dentro de `container`, sin oscurecer el live). */
  presentation?: "dialog" | "sheet";
  /** Contenedor del portal en modo "sheet". Si se omite, usa document.body. */
  container?: HTMLElement | null;
  /** Creador (para mostrarlo en la pasarela de pago del supercomentario). */
  creatorName?: string | null;
  creatorAvatarUrl?: string | null;
};

export default function SuperCommentModal({
  open,
  onClose,
  postId,
  authorId,
  userId,
  username,
  avatarUrl,
  guestId,
  config,
  presentation = "dialog",
  container,
  creatorName,
  creatorAvatarUrl,
}: Props) {
  const tPosts = useTranslations("posts");
  const tWallet = useTranslations("wallet");
  const isSheet = presentation === "sheet";
  const isGuest = !userId;
  const [payStep, setPayStep] = useState(false);
  const tLive = useTranslations("live");
  const tCommon = useTranslations("common");
  const pf = usePriceFormat();
  // Precio TODO-INCLUIDO que ve el fan (base del creador + cargo fijo + impuesto del país), en MXN.
  const tierTotal = (base: number) => pf.formatWithTax(base + FIXED_SERVICE_FEE_USD, { baseCurrency: SETTLEMENT_CURRENCY }).total;

  const [mounted, setMounted] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [step, setStep] = useState<"nickname" | "compose">("compose");
  const [guestNickname, setGuestNickname] = useState("");
  const [selectedTier, setSelectedTier] = useState<SuperCommentTier | null>(null);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const payBtnRef = useRef<HTMLButtonElement>(null);
  // Instancia del SDK de MP (memoizada) para tokenizar la tarjeta guardada en el un-clic.

  // Tarjetas guardadas del comprador. Si hay ≥1, el pago es "un clic" directo
  // (sin pasarela); si no hay ninguna, Enviar abre la pasarela (primera compra).
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  // Invitado también puede tener tarjeta guardada (bajo su uid anónimo, de una compra previa).
  const hasSavedCard = savedCards.length > 0 && !!selectedCardId;
  // Saldo a favor (crédito) — solo cuentas reales. Se puede usar INLINE, sin ir a la pasarela.
  const creditState = useBuyerCredit(isGuest ? null : (userId ?? null));
  const creditBalance = isGuest ? 0 : creditState.balance;
  const [useCredit, setUseCredit] = useState(false);
  // Total del nivel en la moneda de LIQUIDACIÓN, que es en la que vive el saldo a favor.
  // ⚠️ Se llamaba `tierTotalMxn`. El nombre venía de la época del peso y ya no describía
  // lo que hay dentro: un nombre así invita a tratarlo como pesos y a multiplicarlo por el
  // tipo de cambio, que es exactamente el fallo que se ha estado limpiando.
  const totalDelNivel = selectedTier
    ? Math.round(((selectedTier.price + FIXED_SERVICE_FEE_USD) * (1 + pf.taxRate) + Number.EPSILON) * 100) / 100
    : 0;
  const creditApplied = useCredit && creditBalance > 0 ? Math.min(creditBalance, totalDelNivel) : 0;
  const creditCoversAll = useCredit && creditBalance > 0 && selectedTier != null && creditBalance >= totalDelNivel;
  // Error del pago directo (un clic, sin pasarela). Se muestra en rojo sobre Enviar.
  const [directError, setDirectError] = useState<string | null>(null);
  // Animación de entrada/salida por transform (no keyframes: más fiable en el 1er montaje).
  const [entered, setEntered] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Entrada/salida: doble rAF para que el navegador PINTE el estado cerrado
  // (translateY(100%)) antes de pasar al abierto; así la 1ª apertura también
  // desliza (con un solo rAF o keyframes recién inyectados, saltaba de golpe).
  useEffect(() => {
    if (!open) { setEntered(false); return; }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setEntered(true)); });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [open]);

  // Suscribe a las tarjetas guardadas del comprador (real o invitado anónimo).
  useEffect(() => {
    if (!open) { setSavedCards([]); return; }
    const uid = auth.currentUser?.uid; // null si el invitado aún no firmó anónimo (sin compras)
    if (!uid) { setSavedCards([]); return; }
    const unsub = onSnapshot(
      collection(db, "users", uid, "paymentMethods"),
      (snap) => setSavedCards(snap.docs
        // Solo tarjetas Stripe (con payment_method guardado) → cobro "un clic" off-session.
        // Descarta docs legacy de MP, que no se pueden cobrar por esta vía.
        .filter((d) => typeof d.data().stripePaymentMethodId === "string")
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            brand: typeof data.brand === "string" ? data.brand : undefined,
            brandName: typeof data.brandName === "string" ? data.brandName : undefined,
            lastFour: typeof data.lastFour === "string" ? data.lastFour : undefined,
          };
        })),
      () => setSavedCards([])
    );
    return () => unsub();
  }, [open, isGuest]);

  // Selección por defecto = primera tarjeta (mantiene la actual si sigue existiendo).
  useEffect(() => {
    if (savedCards.length === 0) { setSelectedCardId(null); return; }
    setSelectedCardId((prev) => (prev && savedCards.some((c) => c.id === prev) ? prev : savedCards[0].id));
  }, [savedCards]);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setSent(false);
      setDirectError(null);
      if (isGuest) {
        const saved = getSavedGuestNickname();
        setGuestNickname(saved);
        setStep(saved.length >= 2 ? "compose" : "nickname");
      }
    } else {
      setPayStep(false);
      const t = window.setTimeout(() => setShouldRender(false), 260);
      return () => window.clearTimeout(t);
    }
  }, [open, isGuest]);

  useEffect(() => {
    if (selectedTier) {
      setText((prev) => prev.slice(0, selectedTier.maxChars));
    }
  }, [selectedTier]);

  useEffect(() => {
    if (open && config.tiers.length > 0 && !selectedTier) {
      setSelectedTier(config.tiers[0]);
    }
    if (!open) {
      setSelectedTier(null);
      setText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Marca el supercomentario como enviado y cierra tras la confirmación.
  function markSentAndClose() {
    setSent(true);
    window.setTimeout(() => {
      onClose();
      setSent(false);
      setText("");
      setSelectedTier(null);
    }, 4000);
  }

  // Un clic con tarjeta guardada (off-session, sin CVV). Se cobra server-side y el
  // webhook materializa el súper comentario. Si no queda "succeeded" (p. ej. requiere
  // autenticación), cae a la pasarela para completar con tarjeta nueva.
  async function handleDirectSend() {
    if (!selectedTier || !text.trim()) return;
    // Debe haber forma de pago: tarjeta guardada, o saldo a favor que cubra el total.
    if (!selectedCardId && !creditCoversAll) return;
    setDirectError(null);
    setSubmitting(true);
    try {
      const res = await createSuperCommentStripeIntent({
        postId,
        tierId: selectedTier.id,
        text: text.trim(),
        saveCard: false,
        taxCountry: pf.buyerCountry ?? null,
        // Si el saldo cubre todo, no se manda tarjeta. Si no, el saldo (si se activó) se
        // mezcla con la tarjeta guardada.
        savedPaymentMethodId: creditCoversAll ? undefined : (selectedCardId ?? undefined),
        applyCredit: useCredit,
      });
      if (res.status === "succeeded") {
        markSentAndClose();
        registrarCompraGeo({ creatorId: authorId, serviceType: "supercomment", grossAmount: selectedTier.price });
        return;
      }
      // Requiere paso adicional → pasarela (tarjeta nueva / autenticación).
      setPayStep(true);
    } catch (err) {
      const fbCode = (err as { code?: unknown })?.code;
      const msg = (err as { message?: unknown })?.message;
      setDirectError(
        typeof fbCode === "string" && fbCode.includes("/") && typeof msg === "string"
          ? msg
          : tLive("scPaymentDeclined")
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleNicknameContinue() {
    const trimmed = guestNickname.trim();
    if (trimmed.length < 2) return;
    saveGuestNickname(trimmed);
    setGuestNickname(trimmed);
    setStep("compose");
  }

  // En modo "sheet" vive dentro del modal del live (que ya maneja su scroll) → no lo tocamos.
  useBodyScrollLock(open && !isSheet);

  if (!shouldRender || !mounted) return null;

  const maxChars = selectedTier?.maxChars ?? 120;
  const remaining = maxChars - text.length;
  // Tope absoluto = el nivel más alto. Al escribir NO se corta en el nivel actual:
  // se sube de nivel automáticamente (poco a poco) hasta este tope.
  const topMaxChars = config.tiers.reduce((m, t) => Math.max(m, t.maxChars), 0);
  const nicknameOk = guestNickname.trim().length >= 2;

  const creatorLabel = creatorName ?? tLive("defaultCreator");

  return (
    <>
      {/* El composer y la pasarela NUNCA se montan a la vez: en la card chica del live
          (300×450) dos sheets apilados se pisaban y la pasarela abría "a la mitad". */}
      {!payStep && createPortal(
    <>
      {/* Backdrop — pestaña canónica (vibra_style.md). En "sheet" va contenido en el
          contenedor (área bajo el video), sin oscurecer el live. */}
      <div
        onClick={onClose}
        style={
          isSheet
            ? {
                position: "absolute", inset: 0, zIndex: 60,
                display: "flex", alignItems: "stretch", justifyContent: "stretch",
                background: "transparent",
              }
            : {
                position: "fixed", inset: 0, zIndex: 999999,
                background: "rgba(0,0,0,0.52)",
                backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                display: "flex", alignItems: "flex-end", justifyContent: "center",
                padding: 0,
                opacity: entered ? 1 : 0,
                transition: "opacity 0.22s ease",
              }
        }
      >
        {/* Panel */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={
            isSheet
              ? {
                  // Absolute inset:0 → llena la card por posicionamiento (no por flex ni
                  // height:100%, donde overflowY:auto no scrolleaba). Este SÍ es el scroller.
                  position: "absolute", inset: 0, boxSizing: "border-box",
                  overflowY: "auto", WebkitOverflowScrolling: "touch",
                  overscrollBehavior: "contain", touchAction: "pan-y",
                  background: "rgba(8,9,11,0.96)",
                  color: "#fff",
                  padding: sent ? 0 : "20px 20px calc(24px + var(--vb-safe-bottom, 0px))",
                  transform: entered ? "translateY(0)" : "translateY(100%)",
                  transition: "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
                  willChange: "transform",
                }
              : {
                  width: "100%", maxWidth: 480,
                  maxHeight: "calc(var(--vb-alto-pantalla) - 72px)", overflowY: "auto",
                  WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", touchAction: "pan-y",
                  borderRadius: "22px 22px 0 0",
                  background: "rgba(8,9,11,0.96)",
                  boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
                  color: "#fff",
                  padding: sent ? 0 : "20px 20px calc(24px + var(--vb-safe-bottom, 0px))",
                  overflow: sent ? "hidden" : undefined,
                  transform: entered ? "translateY(0)" : "translateY(100%)",
                  transition: "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
                  willChange: "transform",
                }
          }
        >
          {/* Header — se oculta al confirmar (el panel de éxito trae su propia X). */}
          {!sent && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: FONT }}>
                {tCommon("paySupercommentProductType")}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                border: "none", background: "none",
                color: "#fff",
                cursor: "pointer", fontSize: 26, lineHeight: 1, padding: 2,
                display: "grid", placeItems: "center",
                fontFamily: FONT,
              }}
            >
              ×
            </button>
          </div>
          )}

          {/* ── Step: nickname (invitados sin apodo guardado) ─────────────────── */}
          {isGuest && step === "nickname" ? (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", fontFamily: FONT, marginBottom: 4 }}>
                  {tLive("scNicknameQuestion")}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: FONT }}>
                  {tLive("scNicknameHint")}
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <input
                  type="text"
                  value={guestNickname}
                  onChange={(e) => setGuestNickname(e.target.value.slice(0, 30))}
                  placeholder={tLive("nicknamePlaceholder")}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleNicknameContinue(); }}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${nicknameOk ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 10, padding: "11px 14px",
                    color: "#fff", fontSize: 14, fontFamily: FONT,
                    outline: "none", transition: "border-color 0.15s",
                  }}
                />
              </div>

              <button
                type="button"
                onClick={handleNicknameContinue}
                disabled={!nicknameOk}
                style={{
                  width: "100%", padding: "12px 20px", borderRadius: 10, border: "none",
                  background: nicknameOk ? "#a855f7" : "rgba(255,255,255,0.07)",
                  color: "#fff", fontSize: 14, fontWeight: 600, fontFamily: FONT,
                  cursor: nicknameOk ? "pointer" : "not-allowed",
                  transition: "background 0.15s",
                }}
              >
                {tCommon("continue")}
              </button>
            </>
          ) : (
            /* ── Step: compose (mismo panel original) ──────────────────────── */
            <>
              {/* Badge de apodo para invitados (sin contenedor: texto suelto) */}
              {isGuest && !sent && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 16,
                }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: FONT }}>
                    {tLive("scSendingAs")}<strong style={{ color: "#fff", marginInlineStart: 8 }}>{guestNickname}</strong>
                  </span>
                  <TextButton tone="brand" size="sm" style={{ fontFamily: FONT }} onClick={() => setStep("nickname")}>
                    {tPosts("changeButton")}
                  </TextButton>
                </div>
              )}

              {sent ? (
                // Mismo panel de confirmación que las donaciones (verde + palomita),
                // con el contexto de "Supercomentario".
                <PaymentSuccessCard
                  avatarUrl={creatorAvatarUrl ?? null}
                  providerName={creatorName ?? undefined}
                  productType={tCommon("paySupercommentProductType")}
                  successMessage={tCommon("paySupercommentSuccess", { name: creatorLabel })}
                  onClose={onClose}
                  stacked
                />
              ) : (
                <>
                  {/* Selección de tier */}
                  <div style={{ marginBottom: 18 }}>
                    {/* Saldo a favor INLINE: sin ir a la pasarela. Mezclable con tarjeta. */}
                    {!isGuest && creditBalance > 0 && (
                      <div style={{ margin: "0 0 10px" }}>
                        <button type="button"
                          onClick={() => { setUseCredit((v) => !v); setDirectError(null); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "start",
                            padding: "12px 14px", borderRadius: 12, background: "#000", cursor: "pointer", fontFamily: FONT,
                            border: `1px solid ${useCredit ? "rgba(59,130,246,0.9)" : "rgba(255,255,255,0.09)"}`,
                            WebkitTapHighlightColor: "transparent",
                          }}
                        >
                          <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, display: "grid", placeItems: "center", border: `2px solid ${useCredit ? "#3b82f6" : "rgba(255,255,255,0.3)"}`, background: useCredit ? "#3b82f6" : "transparent" }}>
                            {useCredit && <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "#fff" }}>{tWallet("creditAvailable")}</span>
                            <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{formatCurrency(creditBalance, creditState.currency || SETTLEMENT_CURRENCY, pf.locale, { code: true })} disponible</span>
                          </span>
                          {useCredit && creditApplied > 0 && (
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6", whiteSpace: "nowrap" }}>−{pf.formatPlain(creditApplied, { baseCurrency: SETTLEMENT_CURRENCY })}</span>
                          )}
                        </button>
                        {useCredit && (
                          <p style={{ margin: "6px 2px 0", fontSize: 11.5, color: creditCoversAll ? "#4ade80" : "rgba(255,255,255,0.5)", fontFamily: FONT }}>
                            {creditCoversAll ? tLive("scBalanceCovers") : tLive("scChooseCardRest")}
                          </p>
                        )}
                      </div>
                    )}
                    {hasSavedCard ? (
                      /* Tarjeta(s) guardada(s): selector "un clic" (fondo negro,
                         texto blanco, puntito selector azul). Enviar = pago directo. */
                      <div style={{ display: "grid", gap: 8, margin: "0 0 14px" }}>
                        {savedCards.map((c) => {
                          const active = selectedCardId === c.id;
                          const brandLabel = c.brandName
                            ? c.brandName
                            : c.brand
                              ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1)
                              : "Tarjeta";
                          return (
                            <button className="vibra-pop"
                              key={c.id}
                              type="button"
                              onClick={() => { setSelectedCardId(c.id); setDirectError(null); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 10,
                                width: "100%", textAlign: "start",
                                padding: "12px 14px", borderRadius: 12,
                                background: "#000",
                                border: `1px solid ${active ? "rgba(59,130,246,0.9)" : "rgba(255,255,255,0.09)"}`,
                                cursor: "pointer", fontFamily: FONT,
                                transition: "border-color 0.2s ease",
                                WebkitTapHighlightColor: "transparent",
                              }}
                            >
                              {/* Icono de tarjeta */}
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                                <rect x="2" y="5" width="20" height="14" rx="2.5" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" />
                                <path d="M2 9.5H22" stroke="rgba(255,255,255,0.85)" strokeWidth="1.6" />
                              </svg>
                              <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#fff", letterSpacing: "0.02em" }}>
                                {brandLabel} ···· {c.lastFour ?? "••••"}
                              </span>
                              {/* Puntito selector azul */}
                              <span style={{
                                width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                                border: `2px solid ${active ? "#3b82f6" : "rgba(255,255,255,0.3)"}`,
                                display: "grid", placeItems: "center",
                                transition: "border-color 0.2s ease",
                              }}>
                                {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3b82f6" }} />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      /* Aviso (primera compra, sin tarjeta guardada) */
                      <p style={{ margin: "0 0 14px", fontSize: 12, lineHeight: 1.55, color: "rgba(255,255,255,0.5)", fontFamily: FONT, textAlign: "center" }}>
                        {tLive("scGatewayNotice")} <strong style={{ color: "rgba(255,255,255,0.82)" }}>{tLive("scOneClick")}</strong>.
                      </p>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
                      {config.tiers.map((tier) => {
                        const isSelected = selectedTier?.id === tier.id;
                        return (
                          <button
                            key={tier.id}
                            type="button"
                            onClick={() => setSelectedTier(tier)}
                            style={{
                              flex: "0 0 calc(33.333% - 6px)",
                              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "12px 6px", borderRadius: 10,
                              border: "none",
                              // El nivel tope lleva el degradado de la marca. Al estar
                              // seleccionado se apaga con una capa oscura encima —el mismo
                              // recurso del panel de contenido premium— porque un degradado
                              // no admite el sufijo de opacidad que sí acepta un color.
                              background: isSelected
                                ? tier.gradient
                                  ? `linear-gradient(rgba(0,0,0,0.72), rgba(0,0,0,0.72)), ${tier.gradient}`
                                  : tier.color + "33"
                                : "transparent",
                              transform: isSelected ? "scale(1.05)" : "scale(1)",
                              cursor: "pointer", textAlign: "center",
                              transition: "background-color 0.28s ease, transform 0.28s ease",
                            }}
                          >
                            {/* Aro del color del tier */}
                            <div style={{
                              width: 16, height: 16, borderRadius: "50%",
                              boxSizing: "border-box" as const,
                              border: `2.5px solid ${tier.gradient ? "transparent" : tier.color}`,
                              ...(tier.gradient ? aroDegradado(tier.gradient) : {}),
                            }} />
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
                              {tier.maxChars} caract.
                            </span>
                            <span style={{
                              fontSize: 13, fontWeight: 700,
                              color: isSelected ? tier.color : "rgba(255,255,255,0.5)",
                              // Degradado recortado sobre el texto, solo en el nivel tope y
                              // solo al estar elegido. `color` queda debajo como respaldo si
                              // el navegador no recorta el fondo.
                              ...(isSelected && tier.gradient
                                ? {
                                    backgroundImage: tier.gradient,
                                    WebkitBackgroundClip: "text" as const,
                                    backgroundClip: "text" as const,
                                    WebkitTextFillColor: "transparent",
                                  }
                                : {}),
                              fontFamily: FONT, whiteSpace: "nowrap",
                              transition: "color 0.28s ease",
                            }}>
                              {tierTotal(tier.price)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Input de texto */}
                  {selectedTier && (
                    <div style={{ marginBottom: 18 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
                          {tLive("scYourMessage")}
                        </div>
                        <span style={{ fontSize: 11, fontFamily: FONT, color: remaining < 20 ? "#f87171" : "rgba(255,255,255,0.3)" }}>
                          {remaining} restantes
                        </span>
                      </div>
                      <textarea
                        value={text}
                        onChange={(e) => {
                          const val = e.target.value.slice(0, topMaxChars);
                          setText(val);
                          if (directError) setDirectError(null);
                          // Sube de nivel poco a poco: el menor tier que alcance el largo (solo hacia arriba).
                          const needed = [...config.tiers].sort((a, b) => a.maxChars - b.maxChars).find((t) => t.maxChars >= val.length);
                          if (needed && (!selectedTier || needed.maxChars > selectedTier.maxChars)) setSelectedTier(needed);
                        }}
                        placeholder={tLive("scPlaceholder", { max: topMaxChars })}
                        rows={3}
                        onFocus={() => {
                          // En laptop no hay teclado que suba la vista → scroll para que se vea el botón.
                          if (typeof window !== "undefined" && window.innerWidth > 720) {
                            window.setTimeout(() => payBtnRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
                          }
                        }}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          background: "rgba(255,255,255,0.06)",
                          border: "none",
                          borderRadius: 12, padding: "10px 12px",
                          color: "#fff", fontSize: 13, fontFamily: "inherit",
                          resize: "none", outline: "none", lineHeight: 1.5,
                        }}
                      />
                    </div>
                  )}

                  {directError && (
                    <p style={{
                      margin: "0 0 10px", fontSize: 12.5, fontWeight: 600, lineHeight: 1.45,
                      color: "#f87171", fontFamily: FONT, textAlign: "center",
                    }}>
                      {directError}
                    </p>
                  )}

                  <button
                    ref={payBtnRef}
                    type="button"
                    onClick={() => {
                      if (!selectedTier || !text.trim()) return;
                      // Logueado + tarjeta guardada → un clic off-session (sin CVV).
                      // Invitado (o primera compra) → pasarela: el invitado re-pide CVV
                      // sobre su tarjeta guardada; sin tarjeta, teclea una nueva.
                      // Un clic (sin pasarela): con tarjeta guardada, o si el saldo a favor
                      // cubre el total. Si el saldo no alcanza y no hay guardada → pasarela.
                      if (!isGuest && (hasSavedCard || creditCoversAll)) handleDirectSend();
                      else setPayStep(true);
                    }}
                    disabled={submitting || !text.trim() || !selectedTier}
                    style={{
                      width: "100%", padding: "12px 20px", borderRadius: 10, border: "none",
                      background: selectedTier && text.trim() && !submitting
                        ? "#a855f7"
                        : "rgba(255,255,255,0.07)",
                      color: "#fff", fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", fontFamily: FONT,
                      cursor: submitting || !text.trim() || !selectedTier ? "not-allowed" : "pointer",
                      transition: "opacity 150ms ease",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    {submitting
                      ? tCommon("sending")
                      : selectedTier
                      ? tLive("scSendWithTotal", { total: tierTotal(selectedTier.price) })
                      : tLive("selectLevel")}
                  </button>

                  <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: FONT, textAlign: "center" }}>
                    {tLive("scCreatorGets")}
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>,
    (isSheet ? container : null) ?? document.body,
      )}

      {/* Pasarela de pago del supercomentario. Monto FIJO (precio del nivel), sin
          montos variables ni placeholder. Al aprobar el pago se envía el
          supercomentario (por ahora vía `sendSuperComment`; el cargo real de MP
          se conectará después). */}
      <StripePaymentModal
        open={payStep}
        presentation={isSheet ? "sheet" : "dialog"}
        container={isSheet ? container : null}
        hideBuyerGreeting
        paymentHeading={tLive("scPaymentHeading")}
        payButtonLabel={tLive("scPayButtonLabel")}
        autoCloseMs={4000}
        amount={selectedTier ? selectedTier.price + FIXED_SERVICE_FEE_USD : null}
        amountCurrency={SETTLEMENT_CURRENCY}
        createIntent={async (args) => {
          // Invitado (sin login): firma anónima antes de cobrar → buyerId server-authoritative.
          if (isGuest) await ensureGuestAuth();
          return createSuperCommentStripeIntent({
            postId,
            tierId: selectedTier?.id ?? "",
            text: text.trim(),
            saveCard: args.saveCard,
            taxCountry: args.taxCountry,
            savedPaymentMethodId: args.savedPaymentMethodId,
            applyCredit: args.applyCredit,
            nickname: isGuest ? (guestNickname.trim() || null) : null,
          });
        }}
        productType={tCommon("paySupercommentProductType")}
        providerName={creatorName ?? undefined}
        avatarUrl={creatorAvatarUrl ?? null}
        description={tCommon("paySupercommentDescription", { name: creatorLabel })}
        successMessage={tCommon("paySupercommentSuccess", { name: creatorLabel })}
        onPaid={() => registrarCompraGeo({
          creatorId: authorId,
          serviceType: "supercomment",
          grossAmount: selectedTier?.price,
        })}
        onClose={() => {
          setPayStep(false);
          onClose();
        }}
      />
    </>
  );
}
