"use client";

// Carga Stripe.js por CDN (https://js.stripe.com/v3/) — SIN el paquete npm, para no
// tocar dependencias. Devuelve la instancia de Stripe. Cachea la promesa.

import { STRIPE_PUBLISHABLE_KEY } from "./config";

// Tipado mínimo de lo que usamos de Stripe.js (no tipamos el SDK completo).
export type StripeElement = {
  mount: (target: string | HTMLElement) => void;
  unmount: () => void;
  destroy: () => void;
  on: (event: string, cb: (e: unknown) => void) => void;
};
export type StripeElements = { create: (type: string, options?: unknown) => StripeElement };
export type ConfirmResult = {
  paymentIntent?: { status?: string };
  error?: { message?: string; code?: string; type?: string };
};
/** Método de pago ya materializado. `card.country` es el país EMISOR (el BIN). */
export type StripePaymentMethodLike = {
  id: string;
  card?: { country?: string | null; brand?: string | null } | null;
};

export type StripeLike = {
  elements: (options?: unknown) => StripeElements;
  confirmCardPayment: (clientSecret: string, data?: unknown) => Promise<ConfirmResult>;
  /**
   * Materializa la tarjeta SIN cobrar. La pasarela lo usa al terminar de escribirla para
   * conocer el país emisor y recalcular el precio; el mismo `pm_...` se reutiliza al
   * confirmar, así que la tarjeta se tokeniza una sola vez.
   */
  createPaymentMethod: (data: unknown) => Promise<{
    paymentMethod?: StripePaymentMethodLike;
    error?: { message?: string };
  }>;
};

let stripePromise: Promise<StripeLike> | null = null;

export function loadStripe(): Promise<StripeLike> {
  if (stripePromise) return stripePromise;
  stripePromise = new Promise<StripeLike>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Stripe.js solo carga en el navegador."));
      return;
    }
    const w = window as unknown as { Stripe?: (k: string) => StripeLike };
    const make = () => {
      if (w.Stripe) resolve(w.Stripe(STRIPE_PUBLISHABLE_KEY));
      else reject(new Error("Stripe.js no quedó disponible."));
    };
    if (w.Stripe) {
      make();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://js.stripe.com/v3/"]');
    if (existing) {
      existing.addEventListener("load", make);
      existing.addEventListener("error", () => reject(new Error("Falló la carga de Stripe.js.")));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://js.stripe.com/v3/";
    s.async = true;
    s.onload = make;
    s.onerror = () => reject(new Error("No se pudo cargar Stripe.js."));
    document.head.appendChild(s);
  });
  return stripePromise;
}
