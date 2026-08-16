import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

import { assertIntentMatchesCharge } from "../src/payments/stripe/intentBinding";

// ─────────────────────────────────────────────────────────────────────────────
// B6-C02 — el webhook tiene que ligar el cobro con la compra vigente.
//
// De una misma referencia pueden colgar VARIOS cobros de Stripe: al recotizar
// por el país de la tarjeta cambia el importe, y con él la clave de
// idempotencia, así que nace otro. Quien conserve el `client_secret` del primero
// podía confirmar el cobro viejo —más barato— y el webhook aprobaba con él la
// versión nueva y cara de la compra.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function ref(): string {
  return `test__${crypto.randomUUID()}`;
}

async function sembrarIntent(id: string, stripePaymentIntentId: string | null) {
  await db.collection("paymentIntents").doc(id).set({
    externalReference: id,
    ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
  });
}

describe("assertIntentMatchesCharge", () => {
  it("🟢 el cobro vigente pasa", async () => {
    const r = ref();
    await sembrarIntent(r, "pi_vigente");
    const ok = await assertIntentMatchesCharge(r, {
      id: "pi_vigente",
      amount: 15000,
      currency: "mxn",
    });
    expect(ok).toBe(true);
  });

  it("🔴 un cobro ANTERIOR de la misma compra no pasa", async () => {
    const r = ref();
    await sembrarIntent(r, "pi_nuevo");
    const ok = await assertIntentMatchesCharge(r, {
      id: "pi_viejo_y_barato",
      amount: 100,
      currency: "mxn",
    });
    expect(ok).toBe(false);
  });

  it("🟢 el mismo cobro con OTRO importe pasa — es una recotización legítima", async () => {
    // `repriceForCard` corrige el importe del MISMO cobro cuando el país fiscal
    // cambia al leer la tarjeta. Comparar importes rechazaría esa compra buena.
    const r = ref();
    await sembrarIntent(r, "pi_vigente");
    const ok = await assertIntentMatchesCharge(r, {
      id: "pi_vigente",
      amount: 99999,
      currency: "eur",
    });
    expect(ok).toBe(true);
  });

  it("🟢 sin id guardado se acepta — hay caminos que confirman antes de persistirlo", async () => {
    const r = ref();
    await sembrarIntent(r, null);
    expect(
      await assertIntentMatchesCharge(r, { id: "pi_x", amount: 1, currency: "mxn" })
    ).toBe(true);
  });

  it("🟢 sin documento se acepta — no hay nada que materializar", async () => {
    expect(
      await assertIntentMatchesCharge(ref(), { id: "pi_x", amount: 1, currency: "mxn" })
    ).toBe(true);
  });
});
