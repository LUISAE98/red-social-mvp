"use client";

import { useState, useEffect, useRef } from "react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { submitSuperCommentAsGuest } from "@/lib/liveChat/super-comment-service";
import { registrarCompraGeo } from "@/lib/wallet/registrarCompraGeo";
import { getSavedGuestNickname, saveGuestNickname } from "@/lib/guest-id";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import { usePriceFormat } from "@/lib/currency/usePriceFormat";
import { createSuperCommentStripeIntent } from "@/lib/stripe/stripePayments";
import { FIXED_SERVICE_FEE_MXN } from "@/lib/currency/catalog";
import StripePaymentModal, { type SavedCard } from "@/components/payments/StripePaymentModal";
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
  const isSheet = presentation === "sheet";
  const isGuest = !userId;
  const [payStep, setPayStep] = useState(false);
  const tLive = useTranslations("live");
  const tCommon = useTranslations("common");
  const pf = usePriceFormat();
  // Precio TODO-INCLUIDO que ve el fan (base del creador + $3 + IVA), en MXN.
  const tierTotal = (base: number) => pf.formatWithTax(base + FIXED_SERVICE_FEE_MXN, { baseCurrency: "MXN" }).total;

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
  const hasSavedCard = !isGuest && savedCards.length > 0 && !!selectedCardId;
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

  // Suscribe a las tarjetas guardadas (solo usuarios con sesión).
  useEffect(() => {
    if (!open || isGuest) { setSavedCards([]); return; }
    const uid = auth.currentUser?.uid;
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
    }, 1800);
  }

  // Invitado (sin sesión): pago aún no integrado → envío simulado por ahora
  // (se conectará cuando integremos pagos para invitados).
  async function handleGuestSend() {
    if (!selectedTier || !text.trim() || !guestId) return;
    setDirectError(null);
    setSubmitting(true);
    try {
      await submitSuperCommentAsGuest({
        postId,
        guestId,
        username: guestNickname.trim(),
        text: text.trim(),
        tier: selectedTier,
      });
      markSentAndClose();
    } catch {
      setDirectError(tLive("scPaymentDeclined"));
    } finally {
      setSubmitting(false);
    }
  }

  // Un clic con tarjeta guardada (off-session, sin CVV). Se cobra server-side y el
  // webhook materializa el súper comentario. Si no queda "succeeded" (p. ej. requiere
  // autenticación), cae a la pasarela para completar con tarjeta nueva.
  async function handleDirectSend() {
    if (!selectedTier || !text.trim() || !selectedCardId) return;
    setDirectError(null);
    setSubmitting(true);
    try {
      const res = await createSuperCommentStripeIntent({
        postId,
        tierId: selectedTier.id,
        text: text.trim(),
        saveCard: false,
        taxCountry: pf.buyerCountry ?? null,
        savedPaymentMethodId: selectedCardId,
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
      {createPortal(
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
                  width: "100%", height: "100%", boxSizing: "border-box",
                  overflowY: "auto",
                  background: "rgba(8,9,11,0.96)",
                  color: "#fff",
                  padding: "20px 20px calc(24px + var(--vb-safe-bottom, 0px))",
                  transform: entered ? "translateY(0)" : "translateY(100%)",
                  transition: "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
                  willChange: "transform",
                }
              : {
                  width: "100%", maxWidth: 480,
                  maxHeight: "calc(100dvh - 72px)", overflowY: "auto",
                  borderRadius: "22px 22px 0 0",
                  background: "rgba(8,9,11,0.96)",
                  boxShadow: "0 -24px 80px rgba(0,0,0,0.56)",
                  color: "#fff",
                  padding: "20px 20px calc(24px + var(--vb-safe-bottom, 0px))",
                  transform: entered ? "translateY(0)" : "translateY(100%)",
                  transition: "transform 0.26s cubic-bezier(0.22,1,0.36,1)",
                  willChange: "transform",
                }
          }
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: FONT }}>
                Supercomentario
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

          {/* ── Step: nickname (invitados sin apodo guardado) ─────────────────── */}
          {isGuest && step === "nickname" ? (
            <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", fontFamily: FONT, marginBottom: 4 }}>
                  ¿Cómo quieres que te llamen?
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: FONT }}>
                  Tu apodo aparecerá en el supercomentario
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
                Continuar
              </button>
            </>
          ) : (
            /* ── Step: compose (mismo panel original) ──────────────────────── */
            <>
              {/* Badge de apodo para invitados */}
              {isGuest && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  marginBottom: 16, padding: "7px 12px", borderRadius: 8,
                  background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.15)",
                }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: FONT }}>
                    Enviando como <strong style={{ color: "#fff" }}>{guestNickname}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep("nickname")}
                    style={{
                      fontSize: 11, color: "#a855f7", background: "none",
                      border: "none", cursor: "pointer", fontFamily: FONT, padding: 0,
                    }}
                  >
                    Cambiar
                  </button>
                </div>
              )}

              {sent ? (
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: "50%",
                    background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)",
                    display: "grid", placeItems: "center", margin: "0 auto 16px",
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", fontFamily: FONT }}>
                    ¡Supercomentario enviado!
                  </div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", fontFamily: FONT, marginTop: 6 }}>
                    El creador lo leerá en cualquier momento.
                  </div>
                </div>
              ) : (
                <>
                  {/* Selección de tier */}
                  <div style={{ marginBottom: 18 }}>
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
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => { setSelectedCardId(c.id); setDirectError(null); }}
                              style={{
                                display: "flex", alignItems: "center", gap: 10,
                                width: "100%", textAlign: "left",
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
                        Al pagar pasarás a la pasarela para completar el cargo de forma segura. Guardaremos tu tarjeta para que tus próximos supercomentarios sean con <strong style={{ color: "rgba(255,255,255,0.82)" }}>un solo clic</strong>.
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
                              background: isSelected ? tier.color + "33" : "transparent",
                              transform: isSelected ? "scale(1.05)" : "scale(1)",
                              cursor: "pointer", textAlign: "center",
                              transition: "background-color 0.28s ease, transform 0.28s ease",
                            }}
                          >
                            {/* Aro del color del tier */}
                            <div style={{
                              width: 16, height: 16, borderRadius: "50%",
                              border: `2.5px solid ${tier.color}`,
                            }} />
                            <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: FONT }}>
                              {tier.maxChars} caract.
                            </span>
                            <span style={{
                              fontSize: 13, fontWeight: 700,
                              color: isSelected ? tier.color : "rgba(255,255,255,0.5)",
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
                          Tu mensaje
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
                        placeholder={`Escribe tu supercomentario (máx. ${topMaxChars} caracteres)...`}
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
                      if (isGuest) handleGuestSend();       // invitado: simulado (por ahora)
                      else if (hasSavedCard) handleDirectSend(); // un clic con tarjeta guardada (sin CVV)
                      else setPayStep(true);                // pasarela Stripe (primera compra / tarjeta nueva)
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
                      ? `Enviar · ${tierTotal(selectedTier.price)}`
                      : tLive("selectLevel")}
                  </button>

                  <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: FONT, textAlign: "center" }}>
                    El creador recibirá el 75% del monto.
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
        amount={selectedTier ? selectedTier.price + FIXED_SERVICE_FEE_MXN : null}
        amountCurrency="MXN"
        createIntent={(args) => createSuperCommentStripeIntent({
          postId,
          tierId: selectedTier?.id ?? "",
          text: text.trim(),
          saveCard: args.saveCard,
          taxCountry: args.taxCountry,
        }).then((r) => ({ clientSecret: r.clientSecret ?? "" }))}
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
