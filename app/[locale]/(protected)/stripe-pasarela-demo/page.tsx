"use client";

// Ruta SIMULADORA (temporal) de la pasarela de Stripe. Muestra el StripePaymentModal
// en las ~5 variantes de servicio, en vista laptop y celular. Solo diseño/prueba
// (usa el PaymentIntent de prueba, gate de moderador). Borrar cuando ya no se use.

import { useState } from "react";
import StripePaymentModal from "@/components/payments/StripePaymentModal";
import { createStripePaymentIntent } from "@/lib/stripe/stripePayments";

type VariantKey = "fijo" | "donacion" | "sesion" | "suscripcion" | "live";

const AVATAR = "https://i.pravatar.cc/160?img=47";

const VARIANTS: Array<{ key: VariantKey; label: string; desc: string }> = [
  { key: "fijo", label: "Precio fijo", desc: "Saludo, consejo, post premium…" },
  { key: "donacion", label: "Donación", desc: "Monto editable + presets" },
  { key: "sesion", label: "Sesión agendada", desc: "Muestra duración" },
  { key: "suscripcion", label: "Suscripción", desc: "$X / mes" },
  { key: "live", label: "Donación en vivo", desc: "Modo sheet (dentro del live)" },
];

export default function StripePasarelaDemoPage() {
  const [variant, setVariant] = useState<VariantKey | null>(null);
  const [forceStacked, setForceStacked] = useState(false);
  const [sheetContainer, setSheetContainer] = useState<HTMLDivElement | null>(null);
  const createIntent = (args: { amount: number; saveCard: boolean }) => createStripePaymentIntent(args);

  // Props por variante (mismos que usarían los servicios reales).
  const common = {
    avatarUrl: AVATAR,
    providerName: "María Fernanda",
    createIntent,
    onPaid: () => {},
    onClose: () => setVariant(null),
    forceStacked,
  };

  const savedCards = [
    { id: "pm_1", brandName: "Visa", lastFour: "4242" },
    { id: "pm_2", brandName: "Mastercard", lastFour: "5454" },
  ];

  return (
    <div style={{ maxWidth: 620, margin: "0 auto", padding: "24px 16px", color: "#fff", fontFamily: "inherit" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 6px" }}>Simulador · Pasarela Stripe</h1>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.5, margin: "0 0 18px" }}>
        Abre la pasarela en cada variante de servicio para revisar el diseño. Prueba con la tarjeta <b>4242 4242 4242 4242</b>, fecha futura y cualquier CVC. (Moderador.)
      </p>

      {/* Toggle laptop / celular */}
      <div style={{ display: "inline-flex", gap: 4, marginBottom: 18, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: 4 }}>
        {([["Laptop", false], ["Celular", true]] as const).map(([lbl, val]) => (
          <button key={lbl} type="button" onClick={() => setForceStacked(val)}
            style={{ padding: "8px 16px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
              background: forceStacked === val ? "#635bff" : "transparent", color: forceStacked === val ? "#fff" : "rgba(255,255,255,0.6)" }}>
            {lbl}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {VARIANTS.map((v) => (
          <button key={v.key} type="button" onClick={() => setVariant(v.key)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
            <span>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{v.label}</span>
              <span style={{ display: "block", fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>{v.desc}</span>
            </span>
            <span style={{ color: "#635bff", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>Abrir →</span>
          </button>
        ))}
      </div>

      {/* Variantes de diálogo */}
      <StripePaymentModal
        {...common}
        open={variant === "fijo"}
        amount={150}
        productType="Saludo personalizado"
        description="Un saludo en video hecho para ti, entregado en 48 horas."
        successMessage="¡Listo! Tu saludo está en camino. Te avisaremos cuando esté listo."
        savedCards={savedCards}
      />
      <StripePaymentModal
        {...common}
        open={variant === "donacion"}
        amount={100}
        amountEditable
        productType="Apoyo al creador"
        paymentHeading="Apoya a María Fernanda"
      />
      <StripePaymentModal
        {...common}
        open={variant === "sesion"}
        amount={500}
        productType="Sesión exclusiva"
        durationMinutes={30}
        successMessage="¡Sesión reservada! Te llegará el acceso a tu videollamada."
      />
      <StripePaymentModal
        {...common}
        open={variant === "suscripcion"}
        amount={99}
        productType="Membresía de comunidad"
        pricePeriodLabel="mes"
      />

      {/* Variante sheet (live): se renderiza dentro de un "marco de celular" */}
      {variant === "live" && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setVariant(null)}>
          <div ref={setSheetContainer} onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: 380, height: 680, maxHeight: "90vh", background: "#111", borderRadius: 28, overflow: "hidden", boxShadow: "0 24px 72px rgba(0,0,0,0.6)" }}>
            {sheetContainer && (
              <StripePaymentModal
                {...common}
                open
                presentation="sheet"
                container={sheetContainer}
                amount={50}
                amountEditable
                hideBuyerGreeting
                productType="Donación en vivo"
                paymentHeading="Envía tu apoyo"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
