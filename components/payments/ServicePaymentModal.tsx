"use client";

// Panel de pago de Vibra — Mercado Pago "Secure Fields".
//
// Diseño LAPTOP estilo Mercado Libre: panel blanco, dos columnas.
//   Izquierda  → "Método de pago": contenedores APILADOS tipo acordeón.
//                  · Tarjeta de crédito (nueva) → expande con campos.
//                  · Tarjeta de débito (nueva)  → expande con campos.
//                  · Tarjetas guardadas         → se apilan abajo, seleccionables
//                    (un clic, sin CVV — Bloque 3).
//                Clic en el seleccionado lo CIERRA (toggle).
//   Derecha    → avatar + servicio + tipo de producto + total + botón "Pagar" (azul MP).
//
// MP entrega SOLO los campos sensibles como iframes PCI; el resto es NUESTRO.
// Tarjeta NUEVA pide CVV (MP lo exige para tokenizar); guardada = un clic.

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { loadMercadoPago } from "@mercadopago/sdk-js";
import { doc, getDoc, collection, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { MP_PUBLIC_KEY } from "@/lib/payments/mpConfig";

// ── Tipado mínimo del SDK (no trae tipos) ────────────────────────────────────
type MpField = {
  mount: (containerId: string) => void;
  unmount: () => void;
  on: (event: string, cb: (data: unknown) => void) => void;
};
type MpFields = {
  create: (type: string, options?: unknown) => MpField;
  createCardToken: (data: {
    cardholderName?: string;
    cardId?: string;
  }) => Promise<{ id?: string }>;
};
type MpInstance = {
  fields: MpFields;
  getPaymentMethods: (args: { bin: string }) => Promise<{
    results?: Array<{
      id?: string;
      payment_type_id?: string;
      thumbnail?: string;
      secure_thumbnail?: string;
    }>;
  }>;
};
type MercadoPagoCtor = new (
  publicKey: string,
  options?: { locale?: string }
) => MpInstance;

export type PaymentCardData = {
  token: string;
  paymentMethodId?: string;
  paymentType: string;
  installments?: number;
  payerEmail?: string;
  /** Segundo token para guardar la tarjeta nueva. */
  saveToken?: string;
  /** Id de la tarjeta guardada, si se paga con una. */
  savedCardId?: string;
};
export type PaymentResult = { status: string };

/** Tarjeta guardada (Bloque 3). Referencias no sensibles de Firestore. */
export type SavedCard = { id: string; brand?: string; lastFour?: string; brandName?: string };

const ID_NUMBER = "vibra-mp-card-number";
const ID_EXP = "vibra-mp-card-exp";
const ID_CVV = "vibra-mp-card-cvv";
const ID_SAVED_CVV = "vibra-mp-saved-cvv";

const MP_BLUE = "#009ee3";

// Placeholder sutil (mismo gris del panel), como el campo de mensaje al creador.
// backgroundColor transparente: el iframe de MP trae fondo blanco por defecto;
// transparente deja ver el gris del contenedor (evita la "franja blanca").
const FIELD_STYLE = {
  height: "100%",
  fontSize: "15px",
  color: "#3a3f4a",
  placeholderColor: "#9aa0a8",
  backgroundColor: "transparent",
};

type Props = {
  open: boolean;
  amount: number | null;
  pay: (card: PaymentCardData) => Promise<PaymentResult>;
  priceLabel?: string;
  productType?: string;
  providerName?: string;
  avatarUrl?: string | null;
  payerEmail?: string;
  locale?: string;
  onClose: () => void;
  onPaid: () => void;
};

export default function ServicePaymentModal({
  open,
  amount,
  pay,
  priceLabel,
  productType,
  providerName,
  avatarUrl,
  payerEmail,
  locale = "es-MX",
  onClose,
  onPaid,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cardName, setCardName] = useState("");
  // Guardar tarjeta para futuras compras (activo por defecto). El guardado real
  // se conecta en el Bloque 3 (MP Customers & Cards).
  const [saveCard, setSaveCard] = useState(true);
  // Logo de la marca detectada por el BIN (lo entrega Mercado Pago).
  const [cardBrandThumb, setCardBrandThumb] = useState<string | null>(null);
  // Tarjetas guardadas del comprador (Firestore).
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  // "credit" | "debit" (tarjeta nueva) | "saved:<id>" | null
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [buyer, setBuyer] = useState<{ name: string; photo: string | null } | null>(null);
  // Animación de entrada/salida (no de golpe).
  const [render, setRender] = useState(false);
  const [entered, setEntered] = useState(false);

  const isNewCard = selectedMethod === "credit" || selectedMethod === "debit";
  const savedCardId = selectedMethod?.startsWith("saved:")
    ? selectedMethod.slice(6)
    : null;

  const mpRef = useRef<MpInstance | null>(null);
  const fieldsRef = useRef<MpField[]>([]);
  const paymentMethodIdRef = useRef<string | null>(null);
  const paymentTypeRef = useRef<string>("credit_card");

  const onPaidRef = useRef(onPaid);
  const payRef = useRef(pay);
  useEffect(() => {
    onPaidRef.current = onPaid;
    payRef.current = pay;
  }, [onPaid, pay]);

  useEffect(() => {
    setMounted(true);
    const check = () => setIsNarrow(window.innerWidth <= 720);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Monta al abrir y anima; al cerrar, anima la salida y luego desmonta.
  useEffect(() => {
    if (open) {
      setRender(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    setEntered(false);
    const t = window.setTimeout(() => setRender(false), 240);
    return () => window.clearTimeout(t);
  }, [open]);

  // Bloquea el scroll del fondo mientras el panel está abierto.
  useEffect(() => {
    if (!open) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [open]);

  // Carga el perfil del comprador (nombre + avatar) para el saludo.
  useEffect(() => {
    if (!open) return;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setBuyer(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "users", uid))
      .then((snap) => {
        if (cancelled) return;
        const d = snap.data();
        setBuyer({
          name:
            (typeof d?.displayName === "string" && d.displayName) ||
            (typeof d?.firstName === "string" && d.firstName) ||
            "",
          photo: typeof d?.photoURL === "string" ? d.photoURL : null,
        });
      })
      .catch(() => {
        if (!cancelled) setBuyer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Suscribe a las tarjetas guardadas del comprador.
  useEffect(() => {
    if (!open) return;
    const uid = auth.currentUser?.uid;
    if (!uid) {
      setSavedCards([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "users", uid, "paymentMethods"),
      (snap) => {
        setSavedCards(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              brand: typeof data.brand === "string" ? data.brand : undefined,
              brandName: typeof data.brandName === "string" ? data.brandName : undefined,
              lastFour: typeof data.lastFour === "string" ? data.lastFour : undefined,
            };
          })
        );
      },
      () => setSavedCards([])
    );
    return () => unsub();
  }, [open]);

  // (A) Al abrir: carga el SDK y crea la instancia. Aún NO monta los campos.
  useEffect(() => {
    if (!open) return;
    if (!amount || amount <= 0) {
      setError("No se pudo determinar el precio de este servicio.");
      setLoading(false);
      return;
    }
    if (!MP_PUBLIC_KEY) {
      setError("Pagos no configurados. Falta la Public Key de Mercado Pago.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSdkReady(false);
    setSelectedMethod(null);
    setCardBrandThumb(null);
    paymentMethodIdRef.current = null;

    (async () => {
      try {
        await loadMercadoPago();
        if (cancelled) return;
        const Ctor = (window as unknown as { MercadoPago?: MercadoPagoCtor })
          .MercadoPago;
        if (!Ctor) throw new Error("SDK de Mercado Pago no disponible.");
        mpRef.current = new Ctor(MP_PUBLIC_KEY, { locale });
        if (!cancelled) {
          setSdkReady(true);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        setError("No se pudo cargar el pago. Intenta de nuevo.");
        setLoading(false);
        console.error("ServicePaymentModal init failed", err);
      }
    })();

    return () => {
      cancelled = true;
      mpRef.current = null;
    };
  }, [open, amount, locale]);

  // (B) Monta los Secure Fields del método seleccionado:
  //   · Tarjeta nueva  → número + vencimiento + CVV.
  //   · Tarjeta guardada → SOLO el CVV (MP exige re-capturarlo).
  useEffect(() => {
    if (!open || !sdkReady || (!isNewCard && !savedCardId)) return;
    const mp = mpRef.current;
    if (!mp) return;

    let localFields: MpField[] = [];
    try {
      if (isNewCard) {
        const numberField = mp.fields.create("cardNumber", {
          placeholder: "1234 1234 1234 1234",
          style: FIELD_STYLE,
        });
        const expField = mp.fields.create("expirationDate", {
          placeholder: "MM/AA",
          style: FIELD_STYLE,
        });
        const cvvField = mp.fields.create("securityCode", {
          placeholder: "CVV",
          style: FIELD_STYLE,
        });

        numberField.on("binChange", async (data) => {
          const bin = (data as { bin?: string } | null)?.bin;
          if (!bin) {
            paymentMethodIdRef.current = null;
            setCardBrandThumb(null);
            return;
          }
          try {
            const res = await mp.getPaymentMethods({ bin });
            const pm = res?.results?.[0];
            paymentMethodIdRef.current = pm?.id ?? null;
            paymentTypeRef.current =
              pm?.payment_type_id === "debit_card" ? "debit_card" : "credit_card";
            setCardBrandThumb(pm?.secure_thumbnail ?? pm?.thumbnail ?? null);
          } catch {
            paymentMethodIdRef.current = null;
            setCardBrandThumb(null);
          }
        });

        numberField.mount(ID_NUMBER);
        expField.mount(ID_EXP);
        cvvField.mount(ID_CVV);
        localFields = [numberField, expField, cvvField];
      } else {
        // Tarjeta guardada: solo el CVV.
        const cvvField = mp.fields.create("securityCode", {
          placeholder: "CVV",
          style: FIELD_STYLE,
        });
        cvvField.mount(ID_SAVED_CVV);
        localFields = [cvvField];
      }
      fieldsRef.current = localFields;
    } catch (err) {
      setError("No se pudo cargar el formulario. Intenta de nuevo.");
      console.error("mount fields failed", err);
    }

    return () => {
      for (const f of localFields) {
        try {
          f.unmount();
        } catch {
          // no-op
        }
      }
      if (fieldsRef.current === localFields) fieldsRef.current = [];
    };
  }, [open, sdkReady, isNewCard, savedCardId]);

  function toggleMethod(id: string) {
    setSelectedMethod((prev) => (prev === id ? null : id));
    setError(null);
  }

  async function handlePay() {
    if (submitting) return;
    if (!selectedMethod) {
      setError("Elige un método de pago.");
      return;
    }
    const mp = mpRef.current;
    if (!mp) return;

    setSubmitting(true);
    setError(null);
    try {
      let card: PaymentCardData;

      if (savedCardId) {
        // Tarjeta guardada: token a partir del cardId + CVV re-capturado.
        const token = await mp.fields.createCardToken({ cardId: savedCardId });
        if (!token?.id) throw new Error("no_cvv");
        card = {
          token: token.id,
          savedCardId,
          paymentType: "credit_card",
          installments: 1,
        };
      } else {
        // Tarjeta nueva.
        if (!cardName.trim()) throw new Error("no_name");
        const token = await mp.fields.createCardToken({ cardholderName: cardName.trim() });
        if (!token?.id) throw new Error("no_token");
        if (!paymentMethodIdRef.current) throw new Error("no_payment_method");

        // Segundo token para GUARDAR la tarjeta (best-effort) si el switch está on.
        let saveToken: string | undefined;
        if (saveCard) {
          try {
            const t2 = await mp.fields.createCardToken({ cardholderName: cardName.trim() });
            saveToken = t2?.id ?? undefined;
          } catch {
            // si no se puede generar el 2º token, simplemente no se guarda
          }
        }

        card = {
          token: token.id,
          paymentMethodId: paymentMethodIdRef.current,
          paymentType: paymentTypeRef.current,
          installments: 1,
          payerEmail: payerEmail || undefined,
          saveToken,
        };
      }

      const res = await payRef.current(card);
      if (res.status === "approved" || res.status === "pending") {
        onPaidRef.current();
        return;
      }
      throw new Error("rejected");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(
        code === "no_name"
          ? "Escribe el nombre como aparece en la tarjeta."
          : code === "no_cvv"
            ? "Escribe el código de seguridad (CVV)."
            : code === "no_payment_method"
              ? "Revisa el número de tarjeta."
              : "No se pudo procesar el pago. Revisa los datos e intenta de nuevo."
      );
      console.error("createCardToken/pay failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !render) return null;

  // ── Estilos (panel claro) ────────────────────────────────────────────────
  const label: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 600,
    color: "#5b616e",
    marginBottom: 6,
    display: "block",
  };
  // Fondo blanco (los Secure Fields de MP son blancos por dentro y no se pueden
  // volver grises); un borde sutil los define sobre el panel, sin franja interna.
  const box: React.CSSProperties = {
    height: 40,
    borderRadius: 10,
    border: "1px solid #e3e6ea",
    background: "#fff",
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
  };
  const textInput: React.CSSProperties = {
    ...box,
    width: "100%",
    color: "#3a3f4a",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
  };
  const cardIcon = (active: boolean) => (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke={active ? MP_BLUE : "#8a8f99"}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <path d="M2 10h20" />
    </svg>
  );
  const radio = (active: boolean) => (
    <span
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        border: `2px solid ${active ? MP_BLUE : "#b8bcc4"}`,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
      }}
    >
      {active && <span style={{ width: 9, height: 9, borderRadius: "50%", background: MP_BLUE }} />}
    </span>
  );

  // Campos de tarjeta nueva (se renderizan DENTRO del método activo).
  const cardFields = (
    <div style={{ display: "grid", gap: 14, padding: "6px 2px 18px" }}>
      <div>
        <label style={label}>Número de tarjeta</label>
        <div style={{ position: "relative" }}>
          <div id={ID_NUMBER} style={{ ...box, paddingRight: 58 }} />
          {cardBrandThumb && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cardBrandThumb}
              alt=""
              style={{
                position: "absolute",
                right: 12,
                top: "50%",
                transform: "translateY(-50%)",
                width: 44,
                height: 28,
                objectFit: "contain",
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={label}>Vencimiento</label>
          <div id={ID_EXP} style={box} />
        </div>
        <div>
          <label style={label}>CVV</label>
          <div id={ID_CVV} style={box} />
        </div>
      </div>
      <div>
        <label style={label}>Nombre en la tarjeta</label>
        <style>{`.vibra-pay-input::placeholder{color:#9aa0a8;opacity:1}`}</style>
        <input
          className="vibra-pay-input"
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
          placeholder="Como aparece en la tarjeta"
          autoComplete="cc-name"
          disabled={submitting}
          style={textInput}
        />
      </div>

      {/* Guardar tarjeta para futuras compras (activo por defecto) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 2,
        }}
      >
        <span style={{ fontSize: 13, color: "#8a8f99", fontWeight: 500 }}>
          Guardar tarjeta para futuras compras
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={saveCard}
          aria-label="Guardar tarjeta para futuras compras"
          onClick={() => setSaveCard((v) => !v)}
          disabled={submitting}
          style={{
            position: "relative",
            width: 40,
            height: 22,
            borderRadius: 999,
            border: "none",
            padding: 0,
            flexShrink: 0,
            cursor: submitting ? "not-allowed" : "pointer",
            background: saveCard ? MP_BLUE : "#d4d7dc",
            transition: "background 180ms ease",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: saveCard ? 20 : 2,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 180ms ease",
              boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
            }}
          />
        </button>
      </div>
    </div>
  );

  // Estilo de fila (sin caja; solo una línea sutil separa cada forma de pago).
  const rowButton: React.CSSProperties = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "15px 2px",
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
  };
  const rowDivider: React.CSSProperties = { borderBottom: "1px solid #eceef1" };

  // Fila-acordeón de tarjeta NUEVA (crédito/débito). Radio a la derecha.
  function newCardRow(kind: "credit" | "debit", title: string) {
    const active = selectedMethod === kind;
    return (
      <div key={kind} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(kind)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>
            {title}
          </span>
          {radio(active)}
        </button>

        {/* Cuerpo colapsable — abre/cierra suave. */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: active ? "1fr" : "0fr",
            transition: "grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}
          >
            {active && cardFields}
          </div>
        </div>
      </div>
    );
  }

  // Fila de tarjeta GUARDADA. Al seleccionar, expande el CVV (MP lo re-pide).
  function savedCardRow(card: SavedCard) {
    const id = `saved:${card.id}`;
    const active = selectedMethod === id;
    const brandLabel = card.brandName
      ? card.brandName
      : card.brand
        ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1)
        : "Tarjeta";
    return (
      <div key={id} style={rowDivider}>
        <button type="button" onClick={() => toggleMethod(id)} style={rowButton}>
          {cardIcon(active)}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3f4a", flex: 1, textAlign: "left" }}>
            {brandLabel} ···· {card.lastFour ?? "••••"}
          </span>
          {radio(active)}
        </button>

        {/* Cuerpo colapsable — solo CVV. */}
        <div
          style={{
            display: "grid",
            gridTemplateRows: active ? "1fr" : "0fr",
            transition: "grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          <div
            style={{ overflow: "hidden", opacity: active ? 1 : 0, transition: "opacity 260ms ease" }}
          >
            <div style={{ display: "grid", gap: 6, padding: "6px 2px 18px", maxWidth: 140 }}>
              <label style={label}>Código de seguridad</label>
              {active && <div id={ID_SAVED_CVV} style={box} />}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const leftColumn = (
    <div
      style={{
        position: "relative",
        padding: isNarrow ? "24px 18px 4px" : "28px 24px 24px",
        minWidth: 0,
      }}
    >
      {/* Cerrar (arriba a la derecha de la columna 1) */}
      <button
        type="button"
        onClick={() => { if (!submitting) onClose(); }}
        aria-label="Cerrar"
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          zIndex: 2,
          border: "none",
          background: "none",
          color: "#9aa0a8",
          cursor: submitting ? "not-allowed" : "pointer",
          fontSize: 26,
          lineHeight: 1,
          padding: 4,
        }}
      >
        ×
      </button>

      {/* Saludo al comprador */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            background: "#e6e8ec",
          }}
        >
          {buyer?.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={buyer.photo}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "#9aa0a8" }}>Bienvenido</div>
          {buyer?.name && (
            <div
              style={{
                fontSize: 15,
                fontWeight: 500,
                color: "#3a3f4a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {buyer.name}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#3a3f4a" }}>
          ¿Cómo quieres pagar?
        </h4>
        <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "#9aa0a8", fontWeight: 400 }}>
          Elige tu forma de pago
        </p>
      </div>

      {loading ? (
        <p style={{ color: "#8a8f99", fontSize: 14 }}>Cargando pago seguro…</p>
      ) : (
        <div style={{ display: "grid", borderTop: "1px solid #eceef1" }}>
          {newCardRow("credit", "Tarjeta de crédito")}
          {newCardRow("debit", "Tarjeta de débito")}
          {savedCards.map((c) => savedCardRow(c))}
        </div>
      )}
    </div>
  );

  const rightColumn = (
    <div
      style={{
        padding: isNarrow ? "16px 18px 20px" : 24,
        background: "#f6f7f9",
        borderLeft: isNarrow ? "none" : "1px solid #eaecef",
        borderTop: isNarrow ? "1px solid #eaecef" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        minWidth: 0,
      }}
    >
      {/* Mercado Pago — arriba pegado a la derecha */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/mercadopago.webp" alt="Mercado Pago" style={{ height: 30, width: "auto" }} />
      </div>

      {/* Creador (más abajo) */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            background: "#e6e8ec",
          }}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          {providerName && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "#3a3f4a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {providerName}
            </div>
          )}
          {productType && (
            <div style={{ fontSize: 12.5, color: "#6b7280" }}>{productType}</div>
          )}
        </div>
      </div>

      <div style={{ height: 1, background: "#e6e8ec" }} />

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 600 }}>Total a pagar</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#3a3f4a" }}>{priceLabel ?? ""}</span>
      </div>

      {/* Empuja el botón hacia abajo para llenar el alto del panel. */}
      <div style={{ flex: 1, minHeight: 12 }} />

      {error && (
        <p
          style={{
            margin: 0,
            padding: "9px 11px",
            borderRadius: 9,
            background: "#fdecea",
            border: "1px solid #f5c2c0",
            color: "#c0392b",
            fontSize: 12.5,
          }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handlePay}
        disabled={submitting || loading}
        style={{
          height: 48,
          borderRadius: 10,
          border: "none",
          background: submitting || loading ? "#9fd8f2" : MP_BLUE,
          color: "#fff",
          fontSize: 15,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: submitting || loading ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "Procesando…" : priceLabel ? `Pagar ${priceLabel}` : "Pagar"}
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          fontSize: 11,
          color: "#8a8f99",
        }}
      >
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        <span>
          Pago cifrado · <span style={{ color: MP_BLUE, fontWeight: 700 }}>Mercado Pago</span>
        </span>
      </div>
    </div>
  );

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.55)",
        opacity: entered ? 1 : 0,
        transition: "opacity 220ms ease",
        willChange: "opacity",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: isNarrow ? "min(100%, 440px)" : "min(100%, 660px)",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 24px 72px rgba(0,0,0,0.4)",
          color: "#3a3f4a",
          opacity: entered ? 1 : 0,
          transform: entered ? "translateY(0) scale(1)" : "translateY(10px) scale(0.985)",
          transition: "opacity 220ms ease, transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          willChange: "opacity, transform",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isNarrow ? "1fr" : "1.05fr 1fr",
            minHeight: isNarrow ? undefined : 500,
          }}
        >
          {leftColumn}
          {rightColumn}
        </div>
      </div>
    </div>,
    document.body
  );
}
