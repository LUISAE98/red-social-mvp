"use client";

// Panel de pago de Vibra — Mercado Pago "Secure Fields".
//
// MP nos entrega SOLO los 3 campos sensibles (número, vencimiento, CVV) como
// iframes PCI; el resto del formulario y todo el diseño son NUESTROS. Esta es la
// base de diseño para el pago de todos los servicios.
//
// Cada call site inyecta su función `pay` (payGreeting, payExclusiveSession, …):
// el panel no conoce el servicio.

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { loadMercadoPago } from "@mercadopago/sdk-js";
import { MP_PUBLIC_KEY } from "@/lib/payments/mpConfig";

// ── Tipado mínimo del SDK (no trae tipos) ────────────────────────────────────
type MpField = {
  mount: (containerId: string) => void;
  unmount: () => void;
  on: (event: string, cb: (data: unknown) => void) => void;
};
type MpFields = {
  create: (type: string, options?: unknown) => MpField;
  createCardToken: (data: { cardholderName: string }) => Promise<{ id?: string }>;
};
type MpInstance = {
  fields: MpFields;
  getPaymentMethods: (args: { bin: string }) => Promise<{
    results?: Array<{ id?: string; payment_type_id?: string }>;
  }>;
};
type MercadoPagoCtor = new (
  publicKey: string,
  options?: { locale?: string }
) => MpInstance;

export type PaymentCardData = {
  token: string;
  paymentMethodId: string;
  paymentType: string;
  installments?: number;
  payerEmail?: string;
};
export type PaymentResult = { status: string };

const ID_NUMBER = "vibra-mp-card-number";
const ID_EXP = "vibra-mp-card-exp";
const ID_CVV = "vibra-mp-card-cvv";

// Estilo del texto DENTRO de los iframes seguros (lo pinta MP con estas vars).
const FIELD_STYLE = {
  height: "100%",
  fontSize: "15px",
  color: "#ffffff",
  placeholderColor: "rgba(255,255,255,0.32)",
};

type Props = {
  open: boolean;
  amount: number | null;
  pay: (card: PaymentCardData) => Promise<PaymentResult>;
  priceLabel?: string;
  title?: string;
  locale?: string;
  onClose: () => void;
  onPaid: () => void;
};

export default function ServicePaymentModal({
  open,
  amount,
  pay,
  priceLabel,
  title,
  locale = "es-MX",
  onClose,
  onPaid,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cardName, setCardName] = useState("");
  const [email, setEmail] = useState("");

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
  }, []);

  // Monta los Secure Fields al abrir; los desmonta al cerrar.
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
    paymentMethodIdRef.current = null;

    (async () => {
      try {
        await loadMercadoPago();
        if (cancelled) return;
        const Ctor = (window as unknown as { MercadoPago?: MercadoPagoCtor })
          .MercadoPago;
        if (!Ctor) throw new Error("SDK de Mercado Pago no disponible.");

        const mp = new Ctor(MP_PUBLIC_KEY, { locale });
        mpRef.current = mp;

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

        // Detecta la marca/método de pago a partir del BIN (primeros dígitos).
        numberField.on("binChange", async (data) => {
          const bin = (data as { bin?: string } | null)?.bin;
          if (!bin) {
            paymentMethodIdRef.current = null;
            return;
          }
          try {
            const res = await mp.getPaymentMethods({ bin });
            const pm = res?.results?.[0];
            paymentMethodIdRef.current = pm?.id ?? null;
            paymentTypeRef.current =
              pm?.payment_type_id === "debit_card" ? "debit_card" : "credit_card";
          } catch {
            paymentMethodIdRef.current = null;
          }
        });

        numberField.mount(ID_NUMBER);
        expField.mount(ID_EXP);
        cvvField.mount(ID_CVV);
        fieldsRef.current = [numberField, expField, cvvField];

        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError("No se pudo cargar el pago. Intenta de nuevo.");
        setLoading(false);
        console.error("ServicePaymentModal init failed", err);
      }
    })();

    return () => {
      cancelled = true;
      for (const f of fieldsRef.current) {
        try {
          f.unmount();
        } catch {
          // no-op
        }
      }
      fieldsRef.current = [];
      mpRef.current = null;
    };
  }, [open, amount, locale]);

  async function handlePay() {
    if (submitting) return;
    const mp = mpRef.current;
    if (!mp) return;
    if (!cardName.trim()) {
      setError("Escribe el nombre como aparece en la tarjeta.");
      return;
    }
    if (!email.trim()) {
      setError("Escribe un correo para el comprobante.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await mp.fields.createCardToken({
        cardholderName: cardName.trim(),
      });
      if (!token?.id) throw new Error("no_token");

      if (!paymentMethodIdRef.current) {
        throw new Error("no_payment_method");
      }

      const res = await payRef.current({
        token: token.id,
        paymentMethodId: paymentMethodIdRef.current,
        paymentType: paymentTypeRef.current,
        installments: 1,
        payerEmail: email.trim(),
      });

      if (res.status === "approved" || res.status === "pending") {
        onPaidRef.current();
        return;
      }
      throw new Error("rejected");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setError(
        code === "no_payment_method"
          ? "Revisa el número de tarjeta."
          : "No se pudo procesar el pago. Revisa los datos e intenta de nuevo."
      );
      console.error("createCardToken/pay failed", err);
    } finally {
      setSubmitting(false);
    }
  }

  if (!mounted || !open) return null;

  const boxStyle: React.CSSProperties = {
    height: 46,
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.05)",
    padding: "0 12px",
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "rgba(255,255,255,0.72)",
    marginBottom: 6,
    display: "block",
  };
  const textInputStyle: React.CSSProperties = {
    ...boxStyle,
    width: "100%",
    color: "#fff",
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
  };

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
        background: "rgba(0,0,0,0.9)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100%, 440px)",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "#0b0b0d",
          borderRadius: 20,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <strong style={{ fontSize: 16, fontWeight: 600 }}>{title ?? "Pago"}</strong>
            {priceLabel && (
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>{priceLabel}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { if (!submitting) onClose(); }}
            aria-label="Cerrar"
            style={{
              border: "none",
              background: "none",
              color: "rgba(255,255,255,0.86)",
              cursor: submitting ? "not-allowed" : "pointer",
              fontSize: 26,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {error && (
            <p
              style={{
                margin: "0 0 14px",
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(248,113,113,0.12)",
                border: "1px solid rgba(248,113,113,0.3)",
                color: "#fca5a5",
                fontSize: 13,
              }}
            >
              {error}
            </p>
          )}

          {loading ? (
            <p style={{ margin: "8px 0", color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
              Cargando pago seguro…
            </p>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {/* Número de tarjeta */}
              <div>
                <label style={labelStyle}>Número de tarjeta</label>
                <div id={ID_NUMBER} style={boxStyle} />
              </div>

              {/* Vencimiento + CVV */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Vencimiento</label>
                  <div id={ID_EXP} style={boxStyle} />
                </div>
                <div>
                  <label style={labelStyle}>CVV</label>
                  <div id={ID_CVV} style={boxStyle} />
                </div>
              </div>

              {/* Nombre en la tarjeta */}
              <div>
                <label style={labelStyle}>Nombre en la tarjeta</label>
                <input
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
                  placeholder="Como aparece en la tarjeta"
                  autoComplete="cc-name"
                  disabled={submitting}
                  style={textInputStyle}
                />
              </div>

              {/* Correo */}
              <div>
                <label style={labelStyle}>Correo electrónico</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tucorreo@ejemplo.com"
                  type="email"
                  autoComplete="email"
                  disabled={submitting}
                  style={textInputStyle}
                />
              </div>

              {/* Botón de pago */}
              <button
                type="button"
                onClick={handlePay}
                disabled={submitting}
                style={{
                  height: 48,
                  marginTop: 4,
                  borderRadius: 12,
                  border: "none",
                  background: submitting
                    ? "rgba(255,255,255,0.12)"
                    : "linear-gradient(100deg, #a855ff, #4f46ff)",
                  color: "#fff",
                  fontSize: 15,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "Procesando…" : priceLabel ? `Pagar ${priceLabel}` : "Pagar"}
              </button>

              {/* Sello de seguridad / procesador */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  marginTop: 2,
                  fontSize: 11,
                  color: "rgba(255,255,255,0.5)",
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
                  Pago cifrado · Procesado por{" "}
                  <span style={{ color: "#00b1ea", fontWeight: 700 }}>Mercado Pago</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
