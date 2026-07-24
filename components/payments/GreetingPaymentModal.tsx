"use client";

// Modal de pago compartido (Payment Brick de Mercado Pago).
//
// Segundo modal que se abre tras crear un saludo/consejo (`awaiting_payment`).
// Renderiza el Payment Brick: el número de tarjeta lo tokeniza MP en el cliente
// (PCI); nosotros solo recibimos el token y llamamos `payGreeting`.
//
// Reusado por los 3 call sites (perfil, comunidad, historias). Sienta el patrón
// que después reutilizaremos para supercomentarios in-live.

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { loadMercadoPago } from "@mercadopago/sdk-js";
import { MP_PUBLIC_KEY } from "@/lib/payments/mpConfig";
import { payGreeting } from "@/lib/payments/payGreeting";

// El global que inyecta el SDK de MP. Tipado mínimo (el SDK no trae tipos).
type BrickController = { unmount: () => void };
type BrickBuilder = {
  create: (
    brick: "payment",
    containerId: string,
    settings: unknown
  ) => Promise<BrickController>;
};
type MercadoPagoInstance = { bricks: () => BrickBuilder };
type MercadoPagoCtor = new (
  publicKey: string,
  options?: { locale?: string }
) => MercadoPagoInstance;

type BrickSubmitData = {
  selectedPaymentMethod: string;
  formData: {
    token?: string;
    payment_method_id?: string;
    installments?: number;
    payer?: { email?: string };
  };
};

const CONTAINER_ID = "vibra-greeting-payment-brick";

type Props = {
  open: boolean;
  greetingRequestId: string | null;
  amount: number | null;
  /** Etiqueta de precio ya formateada para el encabezado (ej. "$120 MXN"). */
  priceLabel?: string;
  title?: string;
  locale?: string;
  onClose: () => void; // el usuario cancela (el saludo queda awaiting_payment)
  onPaid: () => void; // pago aprobado
};

export default function GreetingPaymentModal({
  open,
  greetingRequestId,
  amount,
  priceLabel,
  title,
  locale = "es-MX",
  onClose,
  onPaid,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<BrickController | null>(null);

  // onPaid en un ref: evita que el efecto (y el Brick) se re-monten cuando el
  // padre re-renderiza y pasa un closure nuevo.
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Crea el Brick cuando el modal abre; lo desmonta al cerrar.
  useEffect(() => {
    if (!open) return;
    if (!greetingRequestId || !amount || amount <= 0) {
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

    (async () => {
      try {
        await loadMercadoPago();
        if (cancelled) return;
        const Ctor = (window as unknown as { MercadoPago?: MercadoPagoCtor })
          .MercadoPago;
        if (!Ctor) throw new Error("SDK de Mercado Pago no disponible.");

        const mp = new Ctor(MP_PUBLIC_KEY, { locale });
        const builder = mp.bricks();

        const controller = await builder.create("payment", CONTAINER_ID, {
          initialization: { amount },
          customization: {
            paymentMethods: { creditCard: "all", debitCard: "all" },
            visual: { style: { theme: "dark" } },
          },
          callbacks: {
            onReady: () => {
              if (!cancelled) setLoading(false);
            },
            onSubmit: ({ selectedPaymentMethod, formData }: BrickSubmitData) => {
              return payGreeting({
                greetingRequestId,
                token: formData.token ?? "",
                paymentMethodId: formData.payment_method_id ?? "",
                paymentType: selectedPaymentMethod,
                installments: formData.installments,
                payerEmail: formData.payer?.email,
              }).then((res) => {
                if (res.status === "approved" || res.status === "pending") {
                  // "pending" = MP aún revisa; lo tratamos como éxito de flujo
                  // (el webhook confirmará y el creador lo verá al aprobar).
                  onPaidRef.current();
                  return;
                }
                throw new Error("rejected");
              });
            },
            onError: (err: unknown) => {
              if (cancelled) return;
              setError("No se pudo procesar el pago. Revisa los datos e intenta de nuevo.");
              console.error("Brick error", err);
            },
          },
        });

        if (cancelled) {
          controller.unmount();
          return;
        }
        controllerRef.current = controller;
      } catch (err) {
        if (cancelled) return;
        setError("No se pudo cargar el pago. Intenta de nuevo.");
        setLoading(false);
        console.error("GreetingPaymentModal init failed", err);
      }
    })();

    return () => {
      cancelled = true;
      try {
        controllerRef.current?.unmount();
      } catch {
        // no-op
      }
      controllerRef.current = null;
    };
  }, [open, greetingRequestId, amount, locale]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
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
          width: "min(100%, 480px)",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#0a0a0a",
          borderRadius: 18,
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 32px 72px rgba(0,0,0,0.9)",
          color: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <strong style={{ fontSize: 16, fontWeight: 600 }}>
              {title ?? "Pago"}
            </strong>
            {priceLabel && (
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
                {priceLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              border: "none",
              background: "none",
              color: "rgba(255,255,255,0.86)",
              cursor: "pointer",
              fontSize: 26,
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {error ? (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={{ margin: 0, color: "#f87171", fontSize: 14 }}>{error}</p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  height: 42,
                  borderRadius: 8,
                  border: "none",
                  background: "rgba(255,255,255,0.1)",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Cerrar
              </button>
            </div>
          ) : (
            <>
              {loading && (
                <p style={{ margin: "8px 0 16px", color: "rgba(255,255,255,0.6)", fontSize: 14 }}>
                  Cargando pago seguro…
                </p>
              )}
              {/* Contenedor donde el SDK monta el Brick. */}
              <div id={CONTAINER_ID} />
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
