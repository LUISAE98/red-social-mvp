import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

// Mockeamos SOLO el acceso a MP (mpFetch) y el guardado de tarjetas; el resto de
// mpClient (MP_SANDBOX, emails de sandbox) y toda la reconciliación son REALES y
// pegan al emulador. Así probamos los guard rails y el camino feliz end-to-end
// sin tocar la red de Mercado Pago.
vi.mock("../src/payments/mpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/payments/mpClient")>();
  return { ...actual, mpFetch: vi.fn() };
});
vi.mock("../src/payments/savedCards", () => ({
  saveCardForBuyer: vi.fn(),
  getSavedCardRef: vi.fn(),
}));

import { chargeServiceIntent } from "../src/payments/serviceCharge";
import { mpFetch } from "../src/payments/mpClient";
import { saveCardForBuyer, getSavedCardRef } from "../src/payments/savedCards";

const mpFetchMock = vi.mocked(mpFetch);
const saveCardMock = vi.mocked(saveCardForBuyer);
const getSavedCardMock = vi.mocked(getSavedCardRef);

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function uid(): string {
  return crypto.randomUUID();
}
async function seedIntent(ref: string, data: Record<string, unknown>) {
  await db.collection("paymentIntents").doc(ref).set(data);
}
async function getDoc(path: string) {
  return (await db.doc(path).get()).data() as Record<string, unknown> | undefined;
}
/** Respuesta de MP aprobada. */
function approvedOrder() {
  return {
    ok: true as const,
    status: 200,
    data: {
      id: "ord_1",
      status: "processed",
      transactions: { payments: [{ id: "pay_1", status: "approved" }] },
    },
  };
}
/** Captura el `code` de un HttpsError lanzado por la función. */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "NO_THREW";
  } catch (e) {
    return (e as { code?: string }).code ?? "NO_CODE";
  }
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Corre con: npm run test:emulator");
  }
});
beforeEach(() => {
  mpFetchMock.mockReset();
  saveCardMock.mockReset();
  getSavedCardMock.mockReset();
});

describe("chargeServiceIntent — guard rails (no llega a MP)", () => {
  it("sin token -> invalid-argument", async () => {
    expect(await codeOf(chargeServiceIntent(`greetingRequest__${uid()}`, "u1", { token: "" }))).toBe(
      "invalid-argument"
    );
    expect(mpFetchMock).not.toHaveBeenCalled();
  });

  it("intent inexistente -> not-found", async () => {
    expect(
      await codeOf(chargeServiceIntent(`greetingRequest__${uid()}`, "u1", { token: "t" }))
    ).toBe("not-found");
  });

  it("no eres el comprador -> permission-denied", async () => {
    const ref = `greetingRequest__${uid()}`;
    await seedIntent(ref, { buyerId: "otro", status: "pending", grossAmount: 100 });
    expect(await codeOf(chargeServiceIntent(ref, "yo", { token: "t" }))).toBe("permission-denied");
  });

  it("compra ya pagada -> failed-precondition", async () => {
    const ref = `greetingRequest__${uid()}`;
    await seedIntent(ref, { buyerId: "u1", status: "approved", grossAmount: 100 });
    expect(await codeOf(chargeServiceIntent(ref, "u1", { token: "t" }))).toBe("failed-precondition");
  });

  it("precio inválido (0) -> failed-precondition", async () => {
    const ref = `greetingRequest__${uid()}`;
    await seedIntent(ref, { buyerId: "u1", status: "pending", grossAmount: 0 });
    expect(await codeOf(chargeServiceIntent(ref, "u1", { token: "t" }))).toBe("failed-precondition");
    expect(mpFetchMock).not.toHaveBeenCalled();
  });
});

describe("chargeServiceIntent — camino feliz y errores de MP", () => {
  it("MP aprueba -> intent 'approved', materializa el dominio y devuelve approved", async () => {
    const id = uid();
    const ref = `greetingRequest__${id}`;
    await seedIntent(ref, {
      buyerId: "u1",
      status: "pending",
      grossAmount: 100,
      pendingGreeting: { creatorId: "creatorX", buyerId: "u1", priceSnapshot: 100, type: "saludo" },
    });
    mpFetchMock.mockResolvedValue(approvedOrder());

    const result = await chargeServiceIntent(ref, "u1", { token: "t", paymentMethodId: "visa" });

    expect(result.status).toBe("approved");
    const intent = await getDoc(`paymentIntents/${ref}`);
    expect(intent?.status).toBe("approved");
    // Materialización end-to-end (reconcile real):
    const greeting = await getDoc(`greetingRequests/${id}`);
    expect(greeting?.paymentStatus).toBe("paid");
    expect(greeting?.creatorId).toBe("creatorX");
  });

  it("MP responde error -> intent 'rejected' con lastError y lanza internal", async () => {
    const ref = `greetingRequest__${uid()}`;
    await seedIntent(ref, { buyerId: "u1", status: "pending", grossAmount: 100 });
    mpFetchMock.mockResolvedValue({ ok: false, status: 400, error: "tarjeta rechazada" });

    expect(await codeOf(chargeServiceIntent(ref, "u1", { token: "t", paymentMethodId: "visa" }))).toBe(
      "internal"
    );
    const intent = await getDoc(`paymentIntents/${ref}`);
    expect(intent?.status).toBe("rejected");
    expect(String(intent?.lastError)).toContain("tarjeta rechazada");
  });

  it("guardar tarjeta es best-effort: si saveCardForBuyer falla, el pago NO se cae", async () => {
    const id = uid();
    const ref = `greetingRequest__${id}`;
    await seedIntent(ref, {
      buyerId: "u1",
      status: "pending",
      grossAmount: 100,
      pendingGreeting: { creatorId: "creatorX" },
    });
    mpFetchMock.mockResolvedValue(approvedOrder());
    saveCardMock.mockRejectedValue(new Error("MP customers caído"));

    const result = await chargeServiceIntent(ref, "u1", {
      token: "t",
      paymentMethodId: "visa",
      saveToken: "save_1",
    });

    expect(result.status).toBe("approved"); // no lanzó pese al fallo de guardado
    expect(saveCardMock).toHaveBeenCalledOnce();
    expect(await getDoc(`greetingRequests/${id}`)).toMatchObject({ paymentStatus: "paid" });
  });

  it("tarjeta guardada (savedCardId): cobra con customer_id, no con email", async () => {
    const ref = `greetingRequest__${uid()}`;
    await seedIntent(ref, { buyerId: "u1", status: "pending", grossAmount: 100 });
    getSavedCardMock.mockResolvedValue({ mpCustomerId: "cust_9", paymentMethodId: "visa" });
    mpFetchMock.mockResolvedValue(approvedOrder());

    await chargeServiceIntent(ref, "u1", { token: "t", savedCardId: "card_9" });

    expect(getSavedCardMock).toHaveBeenCalledWith("u1", "card_9");
    // La orden se arma con payer.customer_id (no con email).
    const orderCall = mpFetchMock.mock.calls.find((c) => c[0] === "/v1/orders");
    const body = orderCall?.[1]?.body as { payer?: Record<string, unknown> };
    expect(body?.payer).toEqual({ customer_id: "cust_9" });
  });
});
