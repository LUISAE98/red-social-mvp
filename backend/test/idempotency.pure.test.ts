import { describe, it, expect } from "vitest";

import { stripeIdempotencyKey } from "../src/payments/stripe/idempotency";

// ─────────────────────────────────────────────────────────────────────────────
// B5-C04 — claves de idempotencia estables para crear objetos en Stripe.
//
// Antes se usaba `crypto.randomUUID()`, que le dice a Stripe "operación nueva"
// cada vez: dos ejecuciones concurrentes de la misma compra creaban DOS
// PaymentIntents y la segunda sobrescribía el id guardado, dejando uno huérfano
// y cobrable en Stripe sin que Vibra lo conociera.
// ─────────────────────────────────────────────────────────────────────────────

describe("stripeIdempotencyKey", () => {
  it("🟢 la misma compra con los mismos datos da la MISMA clave", () => {
    const a = stripeIdempotencyKey("liveAccess__live1_user1", 15000, "mxn");
    const b = stripeIdempotencyKey("liveAccess__live1_user1", 15000, "mxn");
    expect(a).toBe(b);
  });

  it("🔴 compras distintas dan claves distintas", () => {
    const a = stripeIdempotencyKey("liveAccess__live1_user1", 15000, "mxn");
    const b = stripeIdempotencyKey("liveAccess__live1_user2", 15000, "mxn");
    expect(a).not.toBe(b);
  });

  it("🔴 un importe distinto da una clave distinta", () => {
    // Es lo que permite reintentar legítimamente tras aplicar saldo a favor o
    // cambiar de tarjeta (otro país ⇒ otro impuesto) sin chocar con la clave
    // cacheada de Stripe, que devolvería idempotency_error.
    const a = stripeIdempotencyKey("greeting__req1", 15000, "mxn");
    const b = stripeIdempotencyKey("greeting__req1", 12000, "mxn");
    expect(a).not.toBe(b);
  });

  it("🔴 una moneda distinta también", () => {
    const a = stripeIdempotencyKey("greeting__req1", 15000, "mxn");
    const b = stripeIdempotencyKey("greeting__req1", 15000, "usd");
    expect(a).not.toBe(b);
  });

  it("🟢 nunca supera el límite de 255 caracteres de Stripe", () => {
    const larga = "x".repeat(400);
    expect(stripeIdempotencyKey(larga, 1, "mxn").length).toBeLessThanOrEqual(255);
  });

  it("🟢 un valor ausente y uno vacío no se confunden con otro distinto", () => {
    expect(stripeIdempotencyKey("ref", null)).toBe(stripeIdempotencyKey("ref", undefined));
    expect(stripeIdempotencyKey("ref", null)).not.toBe(stripeIdempotencyKey("ref", 0));
  });
});
