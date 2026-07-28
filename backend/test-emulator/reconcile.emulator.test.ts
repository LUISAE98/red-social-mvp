import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import {
  applyApprovedPaymentToSource,
  upsertPaymentIntentStatus,
} from "../src/payments/reconcile";

// ─────────────────────────────────────────────────────────────────────────────
// Tier 4a — Reconciliación (reconcile.ts) contra el emulador.
//
// "Pagar-luego-crear": el documento de dominio NO existe hasta que el pago
// aprueba; aquí se materializa desde el paymentIntent. Es IDEMPOTENTE porque el
// webhook y la respuesta síncrona compiten por materializar lo mismo.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function uid(): string {
  return crypto.randomUUID();
}
async function seedIntent(externalReference: string, data: Record<string, unknown>) {
  await db.collection("paymentIntents").doc(externalReference).set(data);
}
async function getDoc(path: string) {
  return (await db.doc(path).get()).data() as Record<string, unknown> | undefined;
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Corre con: npm run test:emulator");
  }
});

describe("upsertPaymentIntentStatus", () => {
  it("hace merge sin borrar campos previos", async () => {
    const ref = `greetingRequest__${uid()}`;
    await seedIntent(ref, { buyerId: "b1", grossAmount: 100 });
    await upsertPaymentIntentStatus(ref, { status: "approved", mpOrderId: "ord1" });

    const intent = await getDoc(`paymentIntents/${ref}`);
    expect(intent?.buyerId).toBe("b1"); // preservado
    expect(intent?.grossAmount).toBe(100); // preservado
    expect(intent?.status).toBe("approved"); // nuevo
    expect(intent?.mpOrderId).toBe("ord1");
  });
});

describe("applyApprovedPaymentToSource — materialización", () => {
  it("materializa el documento de dominio con paymentStatus 'paid' desde el pending", async () => {
    const id = uid();
    const ref = `greetingRequest__${id}`;
    await seedIntent(ref, {
      buyerId: "b1",
      pendingGreeting: { creatorId: "creatorX", buyerId: "b1", priceSnapshot: 200, type: "saludo" },
    });

    await applyApprovedPaymentToSource(ref, { mpOrderId: "ord1", mpPaymentId: "pay1" });

    const greeting = await getDoc(`greetingRequests/${id}`);
    expect(greeting?.paymentStatus).toBe("paid");
    expect(greeting?.creatorId).toBe("creatorX"); // del pending
    expect(greeting?.priceSnapshot).toBe(200);
    expect(greeting?.mpOrderId).toBe("ord1");
    expect(greeting?.mpPaymentId).toBe("pay1");
  });

  it("IDEMPOTENTE: si el documento de dominio ya existe, no lo sobrescribe", async () => {
    const id = uid();
    const ref = `greetingRequest__${id}`;
    // El doc ya fue materializado antes (p.ej. por la respuesta síncrona).
    await db.doc(`greetingRequests/${id}`).set({ paymentStatus: "paid", marca: "original" });
    await seedIntent(ref, {
      pendingGreeting: { creatorId: "otro", priceSnapshot: 999 },
    });

    await applyApprovedPaymentToSource(ref, { mpOrderId: "ordX" });

    const greeting = await getDoc(`greetingRequests/${id}`);
    expect(greeting?.marca).toBe("original"); // intacto
    expect(greeting?.priceSnapshot).toBeUndefined(); // NO se aplicó el pending nuevo
  });

  it("sin payload pending -> no crea nada (warn)", async () => {
    const id = uid();
    const ref = `greetingRequest__${id}`;
    await seedIntent(ref, { buyerId: "b1" }); // sin pendingGreeting

    await applyApprovedPaymentToSource(ref, { mpOrderId: "ord1" });

    expect(await getDoc(`greetingRequests/${id}`)).toBeUndefined();
  });

  it("despacho anidado: liveAccess materializa liveAccess/{liveId}/users/{userId}", async () => {
    // liveId/userId sin '_' interno: reconcile parte el sourceId por el PRIMER '_'
    // (en prod son auto-ids/UIDs de Firebase, sin guion bajo).
    const liveId = uid();
    const userId = uid();
    const ref = `liveAccess__${liveId}_${userId}`;
    await seedIntent(ref, {
      pendingLiveAccess: { authorId: "creatorL", amount: 40, status: "paid" },
    });

    await applyApprovedPaymentToSource(ref, { mpOrderId: "ord1", mpPaymentId: "pay1" });

    const access = await getDoc(`liveAccess/${liveId}/users/${userId}`);
    expect(access?.paymentStatus).toBe("paid");
    expect(access?.authorId).toBe("creatorL");
  });

  it("external_reference sin '__' -> no crashea y no materializa", async () => {
    await expect(
      applyApprovedPaymentToSource("sinSeparador", { mpOrderId: "ord1" })
    ).resolves.toBeUndefined();
  });

  it("liveAccess con sourceId sin '_' -> no crashea (warn)", async () => {
    const ref = `liveAccess__${uid()}`; // sin el '_' interno que separa liveId_userId
    await seedIntent(ref, { pendingLiveAccess: { authorId: "x", amount: 10 } });
    await expect(
      applyApprovedPaymentToSource(ref, { mpOrderId: "ord1" })
    ).resolves.toBeUndefined();
  });
});
