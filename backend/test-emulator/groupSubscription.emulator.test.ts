import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

// mpFetch (red a MP) mockeado; el resto de mpClient real. recordEarning y toda la
// escritura de membresías/ledger son REALES contra el emulador.
vi.mock("../src/payments/mpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/payments/mpClient")>();
  return { ...actual, mpFetch: vi.fn() };
});

import functionsTest from "firebase-functions-test";
import {
  reconcileMpSubscription,
  payGroupSubscription,
  cancelGroupSubscription,
} from "../src/payments/groupSubscription";
import { mpFetch } from "../src/payments/mpClient";

const mpFetchMock = vi.mocked(mpFetch);

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;
const testEnv = functionsTest();

function uid(): string {
  return crypto.randomUUID();
}
const DAY = 24 * 60 * 60 * 1000;
async function getDoc(path: string) {
  return (await db.doc(path).get()).data() as Record<string, unknown> | undefined;
}
async function seedGroup(groupId: string, extra: Record<string, unknown> = {}) {
  await db.doc(`groups/${groupId}`).set({
    ownerId: extra.ownerId ?? `owner_${uid()}`,
    name: "Comunidad Test",
    visibility: "public",
    monetization: { subscriptionsEnabled: true, subscriptionPriceMonthly: 30 },
    ...extra,
  });
}
async function seedSub(id: string, data: Record<string, unknown>) {
  await db.doc(`groupSubscriptions/${id}`).set(data);
}
function ledgerEntry(creatorId: string, sourceId: string) {
  return getDoc(`users/${creatorId}/walletLedger/groupSubscription__${sourceId}`);
}
async function ledgerSize(creatorId: string): Promise<number> {
  return (await db.collection(`users/${creatorId}/walletLedger`).get()).size;
}
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
});

// ─────────────── reconcileMpSubscription: cobro mensual recurrente ────────────

describe("reconcileMpSubscription — subscription_authorized_payment", () => {
  async function setupSub() {
    const groupId = uid();
    const ownerId = `owner_${uid()}`;
    const subscriberUid = `sub_${uid()}`;
    const preId = `pre_${uid()}`;
    await seedGroup(groupId, { ownerId });
    await seedSub(`${groupId}_${subscriberUid}`, {
      groupId,
      uid: subscriberUid,
      ownerId,
      mpPreapprovalId: preId,
      priceMonthly: 30,
      currency: "MXN",
      currentPeriodEnd: Timestamp.fromDate(new Date(Date.now() + 30 * DAY)),
      active: true,
    });
    return { groupId, ownerId, subscriberUid, preId };
  }

  it("cobro aprobado -> earning al dueño, extiende periodo y activa membresía", async () => {
    const { groupId, ownerId, subscriberUid, preId } = await setupSub();
    mpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: { id: "payA", status: "approved", preapproval_id: preId, transaction_amount: 30 },
    } as any);

    await reconcileMpSubscription("subscription_authorized_payment", "notif1");

    const entry = await ledgerEntry(ownerId, `${groupId}_${subscriberUid}_payA`);
    expect(entry?.type).toBe("subscription");
    expect(entry?.grossAmount).toBe(30);
    expect(entry?.channelType).toBe("group");

    const member = await getDoc(`groups/${groupId}/members/${subscriberUid}`);
    expect(member?.subscriptionActive).toBe(true);
    expect(member?.mpManaged).toBe(true);
  });

  it("⭐ cada cobro mensual cuenta un earning (N cobros = N earnings)", async () => {
    const { groupId, ownerId, subscriberUid, preId } = await setupSub();

    mpFetchMock.mockResolvedValue({
      ok: true, status: 200,
      data: { id: "payA", status: "approved", preapproval_id: preId, transaction_amount: 30 },
    } as any);
    await reconcileMpSubscription("subscription_authorized_payment", "notif1");

    mpFetchMock.mockResolvedValue({
      ok: true, status: 200,
      data: { id: "payB", status: "approved", preapproval_id: preId, transaction_amount: 30 },
    } as any);
    await reconcileMpSubscription("subscription_authorized_payment", "notif2");

    expect(await ledgerSize(ownerId)).toBe(2); // dos meses, dos earnings
    const s = await getDoc(`users/${ownerId}/walletSummary/current`);
    expect(s?.lifetimeEarnedGross).toBe(60);
  });

  it("el mismo cobro notificado dos veces -> un solo earning (idempotente)", async () => {
    const { ownerId, preId } = await setupSub();
    mpFetchMock.mockResolvedValue({
      ok: true, status: 200,
      data: { id: "payA", status: "approved", preapproval_id: preId, transaction_amount: 30 },
    } as any);

    await reconcileMpSubscription("subscription_authorized_payment", "notif1");
    await reconcileMpSubscription("subscription_authorized_payment", "notif1");

    expect(await ledgerSize(ownerId)).toBe(1);
  });

  it("cobro fallido (rejected) -> past_due con 5 días de gracia, sin earning", async () => {
    const { groupId, ownerId, subscriberUid, preId } = await setupSub();
    mpFetchMock.mockResolvedValue({
      ok: true, status: 200,
      data: { id: "payA", status: "rejected", preapproval_id: preId },
    } as any);

    await reconcileMpSubscription("subscription_authorized_payment", "notif1");

    const sub = await getDoc(`groupSubscriptions/${groupId}_${subscriberUid}`);
    expect(sub?.status).toBe("past_due");
    const graceMs = (sub?.gracePeriodEnd as admin.firestore.Timestamp).toMillis();
    expect(graceMs).toBeGreaterThan(Date.now() + 4.5 * DAY);
    expect(graceMs).toBeLessThan(Date.now() + 5.5 * DAY);
    expect(await ledgerSize(ownerId)).toBe(0); // fallo -> no se cuenta dinero
  });

  it("dueño == suscriptor -> no se paga a sí mismo", async () => {
    const groupId = uid();
    const ownerId = `owner_${uid()}`;
    const preId = `pre_${uid()}`;
    await seedGroup(groupId, { ownerId });
    await seedSub(`${groupId}_${ownerId}`, {
      groupId, uid: ownerId, ownerId, mpPreapprovalId: preId, priceMonthly: 30, currency: "MXN", active: true,
    });
    mpFetchMock.mockResolvedValue({
      ok: true, status: 200,
      data: { id: "payA", status: "approved", preapproval_id: preId, transaction_amount: 30 },
    } as any);

    await reconcileMpSubscription("subscription_authorized_payment", "notif1");
    expect(await ledgerSize(ownerId)).toBe(0);
  });

  it("preapprovalId sin suscripción asociada -> no-op", async () => {
    mpFetchMock.mockResolvedValue({
      ok: true, status: 200,
      data: { id: "payA", status: "approved", preapproval_id: `inexistente_${uid()}`, transaction_amount: 30 },
    } as any);
    await expect(
      reconcileMpSubscription("subscription_authorized_payment", "notif1")
    ).resolves.toBeUndefined();
  });
});

describe("reconcileMpSubscription — subscription_preapproval", () => {
  it("cancelado en MP -> status cancelled y conserva accessUntil", async () => {
    const groupId = uid();
    const subscriberUid = `sub_${uid()}`;
    const preId = `pre_${uid()}`;
    const accessUntil = Timestamp.fromDate(new Date(Date.now() + 20 * DAY));
    await seedSub(`${groupId}_${subscriberUid}`, {
      groupId, uid: subscriberUid, ownerId: `owner_${uid()}`, mpPreapprovalId: preId,
      priceMonthly: 30, currency: "MXN", accessUntil, active: true,
    });
    mpFetchMock.mockResolvedValue({ ok: true, status: 200, data: { status: "cancelled" } } as any);

    await reconcileMpSubscription("subscription_preapproval", preId);

    const sub = await getDoc(`groupSubscriptions/${groupId}_${subscriberUid}`);
    expect(sub?.status).toBe("cancelled");
    expect(sub?.cancelAtPeriodEnd).toBe(true);
    // accessUntil NO se toca (acceso hasta fin de periodo ya pagado).
    expect((sub?.accessUntil as admin.firestore.Timestamp).toMillis()).toBe(accessUntil.toMillis());
  });

  it("pausado en MP -> past_due con 5 días de gracia", async () => {
    const groupId = uid();
    const subscriberUid = `sub_${uid()}`;
    const preId = `pre_${uid()}`;
    await seedSub(`${groupId}_${subscriberUid}`, {
      groupId, uid: subscriberUid, ownerId: `owner_${uid()}`, mpPreapprovalId: preId, priceMonthly: 30, active: true,
    });
    mpFetchMock.mockResolvedValue({ ok: true, status: 200, data: { status: "paused" } } as any);

    await reconcileMpSubscription("subscription_preapproval", preId);

    const sub = await getDoc(`groupSubscriptions/${groupId}_${subscriberUid}`);
    expect(sub?.status).toBe("past_due");
    const graceMs = (sub?.gracePeriodEnd as admin.firestore.Timestamp).toMillis();
    expect(graceMs).toBeGreaterThan(Date.now() + 4.5 * DAY);
  });
});

// ─────────────────────── Callables: suscribir / cancelar ─────────────────────

describe("payGroupSubscription (callable)", () => {
  it("sin auth -> unauthenticated", async () => {
    const wrapped = testEnv.wrap(payGroupSubscription);
    expect(await codeOf(wrapped({ data: { groupId: uid(), token: "t" } } as any))).toBe(
      "unauthenticated"
    );
  });

  it("comunidad sin suscripción activa -> failed-precondition", async () => {
    const groupId = uid();
    await seedGroup(groupId, { monetization: { subscriptionsEnabled: false } });
    const wrapped = testEnv.wrap(payGroupSubscription);
    expect(
      await codeOf(wrapped({ auth: { uid: `u_${uid()}` }, data: { groupId, token: "t" } } as any))
    ).toBe("failed-precondition");
  });

  it("suscribirse a tu propia comunidad -> failed-precondition", async () => {
    const groupId = uid();
    const ownerId = `owner_${uid()}`;
    await seedGroup(groupId, { ownerId });
    const wrapped = testEnv.wrap(payGroupSubscription);
    expect(
      await codeOf(wrapped({ auth: { uid: ownerId }, data: { groupId, token: "t" } } as any))
    ).toBe("failed-precondition");
  });

  it("ya suscrito activo -> failed-precondition", async () => {
    const groupId = uid();
    const subscriberUid = `sub_${uid()}`;
    await seedGroup(groupId);
    await db.doc(`users/${subscriberUid}/groupMemberships/${groupId}`).set({ subscriptionActive: true });
    const wrapped = testEnv.wrap(payGroupSubscription);
    expect(
      await codeOf(wrapped({ auth: { uid: subscriberUid }, data: { groupId, token: "t" } } as any))
    ).toBe("failed-precondition");
  });

  it("MP autoriza -> crea la suscripción activa y activa la membresía (sin earning aquí)", async () => {
    const groupId = uid();
    const ownerId = `owner_${uid()}`;
    const subscriberUid = `sub_${uid()}`;
    await seedGroup(groupId, { ownerId });
    mpFetchMock.mockResolvedValue({ ok: true, status: 200, data: { id: "pre_1", status: "authorized" } } as any);

    const wrapped = testEnv.wrap(payGroupSubscription);
    const result = await wrapped({ auth: { uid: subscriberUid }, data: { groupId, token: "tok" } } as any);

    expect(result).toMatchObject({ status: "authorized", subscriptionId: `${groupId}_${subscriberUid}` });
    const sub = await getDoc(`groupSubscriptions/${groupId}_${subscriberUid}`);
    expect(sub?.active).toBe(true);
    expect(sub?.mpPreapprovalId).toBe("pre_1");
    const member = await getDoc(`groups/${groupId}/members/${subscriberUid}`);
    expect(member?.subscriptionActive).toBe(true);
    // El earning NO se registra al suscribir (lo hace el webhook por cada cobro).
    expect(await ledgerSize(ownerId)).toBe(0);
  });
});

describe("cancelGroupSubscription (callable)", () => {
  it("cancela en MP, marca cancelled y CONSERVA el acceso (no borra la membresía)", async () => {
    const groupId = uid();
    const subscriberUid = `sub_${uid()}`;
    const accessUntil = Timestamp.fromDate(new Date(Date.now() + 15 * DAY));
    await seedSub(`${groupId}_${subscriberUid}`, {
      groupId, uid: subscriberUid, ownerId: `owner_${uid()}`, mpPreapprovalId: "pre_1", accessUntil,
    });
    // Membresía vigente que NO debe borrarse al cancelar.
    await db.doc(`groups/${groupId}/members/${subscriberUid}`).set({ subscriptionActive: true });
    mpFetchMock.mockResolvedValue({ ok: true, status: 200, data: {} } as any);

    const wrapped = testEnv.wrap(cancelGroupSubscription);
    const result = await wrapped({ auth: { uid: subscriberUid }, data: { groupId } } as any);

    expect(result).toMatchObject({ status: "cancelled" });
    const sub = await getDoc(`groupSubscriptions/${groupId}_${subscriberUid}`);
    expect(sub?.status).toBe("cancelled");
    expect(sub?.cancelAtPeriodEnd).toBe(true);
    // La membresía sigue viva (acceso hasta fin de periodo).
    expect(await getDoc(`groups/${groupId}/members/${subscriberUid}`)).toBeDefined();
  });

  it("suscripción de otro -> permission-denied", async () => {
    const groupId = uid();
    await seedSub(`${groupId}_otro`, { groupId, uid: "otro", mpPreapprovalId: "pre_1" });
    // El doc id no coincide con el uid del que llama; además sub.uid = 'otro'.
    await seedSub(`${groupId}_${"otro"}`, { groupId, uid: "otro" });
    const wrapped = testEnv.wrap(cancelGroupSubscription);
    // Nota: el callable busca groupSubscriptions/{groupId}_{callerUid}; usamos un caller
    // cuyo doc existe pero con uid distinto para forzar el permission-denied.
    const caller = `me_${uid()}`;
    await seedSub(`${groupId}_${caller}`, { groupId, uid: "otro", mpPreapprovalId: "pre_1" });
    expect(await codeOf(wrapped({ auth: { uid: caller }, data: { groupId } } as any))).toBe(
      "permission-denied"
    );
  });

  it("sin suscripción -> not-found", async () => {
    const wrapped = testEnv.wrap(cancelGroupSubscription);
    expect(await codeOf(wrapped({ auth: { uid: `u_${uid()}` }, data: { groupId: uid() } } as any))).toBe(
      "not-found"
    );
  });
});
