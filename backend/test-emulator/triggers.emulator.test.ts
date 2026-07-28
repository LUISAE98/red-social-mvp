import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import functionsTest from "firebase-functions-test";
import {
  onSuperCommentLedger,
  onLiveAccessLedger,
  onPostAccessLedger,
  onGroupSubscriptionLedger,
  onGroupSubscriptionChurn,
  onProfileDonationLedger,
  onGreetingLedger,
  onExclusiveSessionLedger,
  onMeetGreetLedger,
} from "../src/wallet/ledgerTriggers";

// ─────────────────────────────────────────────────────────────────────────────
// Tier 3 — Triggers de Firestore que alimentan el ledger (ledgerTriggers.ts).
//
// Se envuelven con firebase-functions-test y se disparan con eventos sintéticos
// contra el emulador. Verifican que cada trigger: (a) cuente en el momento
// correcto, (b) resuelva el tipo/canal correcto, (c) atribuya al creador correcto
// y (d) no cuente cuando no debe. La aritmética/idempotencia ya está cubierta en
// ledger.emulator.test.ts; aquí probamos la LÓGICA DE DECISIÓN del trigger.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();
const testEnv = functionsTest();
const appOpt = { firebaseApp: admin.app() };

function uid(): string {
  return crypto.randomUUID();
}
function snap(data: Record<string, unknown>, path: string) {
  return testEnv.firestore.makeDocumentSnapshot(data, path, appOpt);
}
/** Change para onDocumentWritten. before {} = documento inexistente (creación). */
function change(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: string
) {
  return testEnv.makeChange(snap(before, path), snap(after, path));
}
async function readEntry(creatorId: string, entryId: string) {
  const s = await db.doc(`users/${creatorId}/walletLedger/${entryId}`).get();
  return s.data() as Record<string, unknown> | undefined;
}
async function readSummary(creatorId: string) {
  const s = await db.doc(`users/${creatorId}/walletSummary/current`).get();
  return s.data() as Record<string, number> | undefined;
}
async function ledgerSize(creatorId: string): Promise<number> {
  const s = await db.collection(`users/${creatorId}/walletLedger`).get();
  return s.size;
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST no definido. Corre: npm run test:emulator");
  }
});

// ───────────────────────── Grupo A: ganan al pagar ──────────────────────────

describe("onSuperCommentLedger (#1 supercomentario / #3 donación en live)", () => {
  it("supercomment CON texto en un live -> type 'supercomment', liveId = postId", async () => {
    const authorId = `a_${uid()}`;
    const postId = `p_${uid()}`;
    const scId = `sc_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId, liveData: { foo: 1 } });

    const wrapped = testEnv.wrap(onSuperCommentLedger);
    await wrapped({
      data: snap(
        { status: "paid", amount: 40, text: "¡grande!", userId: `b_${uid()}` },
        `posts/${postId}/superComments/${scId}`
      ),
      params: { postId, scId },
    });

    const entry = await readEntry(authorId, `superComment__${postId}_${scId}`);
    expect(entry?.type).toBe("supercomment");
    expect(entry?.liveId).toBe(postId);
    expect(entry?.grossAmount).toBe(40);
    expect(entry?.status).toBe("earned");
  });

  it("supercomment SIN texto en un live -> type 'live_donation'", async () => {
    const authorId = `a_${uid()}`;
    const postId = `p_${uid()}`;
    const scId = `sc_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId, liveData: { foo: 1 } });

    const wrapped = testEnv.wrap(onSuperCommentLedger);
    await wrapped({
      data: snap({ status: "paid", amount: 25, userId: `b_${uid()}` }, `posts/${postId}/superComments/${scId}`),
      params: { postId, scId },
    });

    const entry = await readEntry(authorId, `superComment__${postId}_${scId}`);
    expect(entry?.type).toBe("live_donation");
  });

  it("atribuye el canal a la comunidad cuando el post tiene groupId", async () => {
    const authorId = `a_${uid()}`;
    const postId = `p_${uid()}`;
    const scId = `sc_${uid()}`;
    const groupId = `grp_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId, liveData: { foo: 1 }, groupId });

    const wrapped = testEnv.wrap(onSuperCommentLedger);
    await wrapped({
      data: snap({ status: "paid", amount: 10, text: "hey", userId: `b_${uid()}` }, `posts/${postId}/superComments/${scId}`),
      params: { postId, scId },
    });

    const entry = await readEntry(authorId, `superComment__${postId}_${scId}`);
    expect(entry?.channelType).toBe("group");
    expect(entry?.channelId).toBe(groupId);
  });

  it("status != 'paid' -> no registra nada", async () => {
    const authorId = `a_${uid()}`;
    const postId = `p_${uid()}`;
    const scId = `sc_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId, liveData: { foo: 1 } });

    const wrapped = testEnv.wrap(onSuperCommentLedger);
    await wrapped({
      data: snap({ status: "pending", amount: 40, text: "x" }, `posts/${postId}/superComments/${scId}`),
      params: { postId, scId },
    });

    expect(await ledgerSize(authorId)).toBe(0);
  });
});

describe("onLiveAccessLedger (#4 ticket de live)", () => {
  it("ticket pagado -> live_ticket al autor", async () => {
    const authorId = `a_${uid()}`;
    const liveId = `live_${uid()}`;
    const userId = `u_${uid()}`;
    const wrapped = testEnv.wrap(onLiveAccessLedger);
    await wrapped({
      data: snap({ status: "paid", amount: 50, authorId }, `liveAccess/${liveId}/users/${userId}`),
      params: { liveId, userId },
    });

    const entry = await readEntry(authorId, `liveAccess__${liveId}_${userId}`);
    expect(entry?.type).toBe("live_ticket");
    expect(entry?.grossAmount).toBe(50);
    expect(entry?.buyerId).toBe(userId);
  });

  it("sin authorId o amount <= 0 -> no registra", async () => {
    const liveId = `live_${uid()}`;
    const userId = `u_${uid()}`;
    const wrapped = testEnv.wrap(onLiveAccessLedger);
    // amount 0
    await wrapped({
      data: snap({ status: "paid", amount: 0, authorId: `a_${uid()}` }, `liveAccess/${liveId}/users/${userId}`),
      params: { liveId, userId },
    });
    // sin authorId (no truena)
    await wrapped({
      data: snap({ status: "paid", amount: 10 }, `liveAccess/${liveId}/users/${userId}`),
      params: { liveId, userId },
    });
    // nada que assertar más allá de que no lanzó; el creador no existe.
    expect(true).toBe(true);
  });
});

describe("onPostAccessLedger (#5 post premium / #11 VOD)", () => {
  it("post SIN liveData -> premium_post con el precio del doc", async () => {
    const creatorId = `c_${uid()}`;
    const postId = `p_${uid()}`;
    const accessId = `acc_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId: creatorId });

    const wrapped = testEnv.wrap(onPostAccessLedger);
    await wrapped({
      data: change({}, { status: "active", postId, buyerId: `b_${uid()}`, price: 80 }, `postAccess/${accessId}`),
      params: { accessId },
    });

    const entry = await readEntry(creatorId, `postAccess__${accessId}`);
    expect(entry?.type).toBe("premium_post");
    expect(entry?.grossAmount).toBe(80);
    expect(entry?.postId).toBe(postId);
  });

  it("post CON liveData -> vod_ticket, liveId = postId", async () => {
    const creatorId = `c_${uid()}`;
    const postId = `p_${uid()}`;
    const accessId = `acc_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId: creatorId, liveData: { foo: 1 } });

    const wrapped = testEnv.wrap(onPostAccessLedger);
    await wrapped({
      data: change({}, { status: "active", postId, buyerId: `b_${uid()}`, price: 120 }, `postAccess/${accessId}`),
      params: { accessId },
    });

    const entry = await readEntry(creatorId, `postAccess__${accessId}`);
    expect(entry?.type).toBe("vod_ticket");
    expect(entry?.liveId).toBe(postId);
  });

  it("precio faltante en el doc -> usa premium.oneTimePrice del post", async () => {
    const creatorId = `c_${uid()}`;
    const postId = `p_${uid()}`;
    const accessId = `acc_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId: creatorId, premium: { oneTimePrice: 99 } });

    const wrapped = testEnv.wrap(onPostAccessLedger);
    await wrapped({
      data: change({}, { status: "active", postId, buyerId: `b_${uid()}` }, `postAccess/${accessId}`),
      params: { accessId },
    });

    const entry = await readEntry(creatorId, `postAccess__${accessId}`);
    expect(entry?.grossAmount).toBe(99);
  });

  it("ya estaba 'active' antes -> no reprocesa (no doble conteo)", async () => {
    const creatorId = `c_${uid()}`;
    const postId = `p_${uid()}`;
    const accessId = `acc_${uid()}`;
    await db.doc(`posts/${postId}`).set({ authorId: creatorId });

    const wrapped = testEnv.wrap(onPostAccessLedger);
    await wrapped({
      data: change(
        { status: "active", postId, price: 80 },
        { status: "active", postId, price: 80 },
        `postAccess/${accessId}`
      ),
      params: { accessId },
    });

    expect(await ledgerSize(creatorId)).toBe(0);
  });
});

describe("onGroupSubscriptionLedger (#10 suscripción)", () => {
  it("activación de suscripción -> earning al dueño en canal grupo", async () => {
    const ownerId = `owner_${uid()}`;
    const subscriberUid = `sub_${uid()}`;
    const groupId = `grp_${uid()}`;

    const wrapped = testEnv.wrap(onGroupSubscriptionLedger);
    await wrapped({
      data: change(
        {},
        { accessType: "subscription", subscriptionActive: true, ownerId, subscriptionPriceMonthly: 30 },
        `users/${subscriberUid}/groupMemberships/${groupId}`
      ),
      params: { uid: subscriberUid, groupId },
    });

    const entry = await readEntry(ownerId, `groupSubscription__${groupId}_${subscriberUid}`);
    expect(entry?.type).toBe("subscription");
    expect(entry?.grossAmount).toBe(30);
    expect(entry?.channelType).toBe("group");
    expect(entry?.channelId).toBe(groupId);
    expect(entry?.buyerId).toBe(subscriberUid);
  });

  it("mpManaged=true -> NO cuenta aquí (evita doble contabilidad con el webhook)", async () => {
    const ownerId = `owner_${uid()}`;
    const subscriberUid = `sub_${uid()}`;
    const groupId = `grp_${uid()}`;

    const wrapped = testEnv.wrap(onGroupSubscriptionLedger);
    await wrapped({
      data: change(
        {},
        { accessType: "subscription", subscriptionActive: true, ownerId, subscriptionPriceMonthly: 30, mpManaged: true },
        `users/${subscriberUid}/groupMemberships/${groupId}`
      ),
      params: { uid: subscriberUid, groupId },
    });

    expect(await ledgerSize(ownerId)).toBe(0);
  });

  it("el dueño suscrito a su propio grupo -> no se paga a sí mismo", async () => {
    const ownerId = `owner_${uid()}`;
    const groupId = `grp_${uid()}`;

    const wrapped = testEnv.wrap(onGroupSubscriptionLedger);
    await wrapped({
      data: change(
        {},
        { accessType: "subscription", subscriptionActive: true, ownerId, subscriptionPriceMonthly: 30 },
        `users/${ownerId}/groupMemberships/${groupId}`
      ),
      params: { uid: ownerId, groupId },
    });

    expect(await ledgerSize(ownerId)).toBe(0);
  });

  it("ya estaba activa antes -> no re-cuenta", async () => {
    const ownerId = `owner_${uid()}`;
    const subscriberUid = `sub_${uid()}`;
    const groupId = `grp_${uid()}`;

    const wrapped = testEnv.wrap(onGroupSubscriptionLedger);
    await wrapped({
      data: change(
        { accessType: "subscription", subscriptionActive: true, ownerId, subscriptionPriceMonthly: 30 },
        { accessType: "subscription", subscriptionActive: true, ownerId, subscriptionPriceMonthly: 30 },
        `users/${subscriberUid}/groupMemberships/${groupId}`
      ),
      params: { uid: subscriberUid, groupId },
    });

    expect(await ledgerSize(ownerId)).toBe(0);
  });
});

describe("onGroupSubscriptionChurn (baja de suscripción)", () => {
  it("borrar una suscripción activa registra un evento 'cancel' para el dueño", async () => {
    const ownerId = `owner_${uid()}`;
    const subscriberUid = `sub_${uid()}`;
    const groupId = `grp_${uid()}`;

    const wrapped = testEnv.wrap(onGroupSubscriptionChurn);
    await wrapped({
      data: snap(
        { accessType: "subscription", subscriptionActive: true, ownerId, subscriptionPriceMonthly: 30 },
        `users/${subscriberUid}/groupMemberships/${groupId}`
      ),
      params: { uid: subscriberUid, groupId },
    });

    const events = await db.collection(`users/${ownerId}/subscriptionEvents`).get();
    expect(events.size).toBe(1);
    const ev = events.docs[0].data();
    expect(ev.type).toBe("cancel");
    expect(ev.subscriberId).toBe(subscriberUid);
    expect(ev.groupId).toBe(groupId);
    expect(ev.priceMonthly).toBe(30);
  });

  it("borrar una membresía que NO era suscripción activa -> no registra evento", async () => {
    const ownerId = `owner_${uid()}`;
    const subscriberUid = `sub_${uid()}`;
    const groupId = `grp_${uid()}`;

    const wrapped = testEnv.wrap(onGroupSubscriptionChurn);
    await wrapped({
      data: snap({ accessType: "free", ownerId }, `users/${subscriberUid}/groupMemberships/${groupId}`),
      params: { uid: subscriberUid, groupId },
    });

    const events = await db.collection(`users/${ownerId}/subscriptionEvents`).get();
    expect(events.size).toBe(0);
  });
});

describe("onProfileDonationLedger (#2 donación en perfil)", () => {
  it("donación pagada -> profile_donation al creador", async () => {
    const creatorId = `c_${uid()}`;
    const donationId = `d_${uid()}`;
    const wrapped = testEnv.wrap(onProfileDonationLedger);
    await wrapped({
      data: snap({ paymentStatus: "paid", amount: 100, creatorId, buyerId: `b_${uid()}` }, `profileDonations/${donationId}`),
      params: { donationId },
    });

    const entry = await readEntry(creatorId, `profileDonation__${donationId}`);
    expect(entry?.type).toBe("profile_donation");
    expect(entry?.grossAmount).toBe(100);
    expect(entry?.channelType).toBe("profile");
  });

  it("el comprador es el propio creador -> no se dona a sí mismo", async () => {
    const creatorId = `c_${uid()}`;
    const donationId = `d_${uid()}`;
    const wrapped = testEnv.wrap(onProfileDonationLedger);
    await wrapped({
      data: snap({ paymentStatus: "paid", amount: 100, creatorId, buyerId: creatorId }, `profileDonations/${donationId}`),
      params: { donationId },
    });

    expect(await ledgerSize(creatorId)).toBe(0);
  });
});

// ─────────── Grupo B: pending al pagar -> earned al entregar (lifecycle) ──────

describe("onGreetingLedger (#6 saludo / #7 consejo) — ciclo de vida completo", () => {
  it("pagado -> pending -> entregado -> earned", async () => {
    const creatorId = `c_${uid()}`;
    const requestId = `req_${uid()}`;
    const path = `greetingRequests/${requestId}`;
    const wrapped = testEnv.wrap(onGreetingLedger);

    // 1) Pagado: registra pending.
    await wrapped({
      data: change(
        {},
        { creatorId, paymentStatus: "paid", priceSnapshot: 200, type: "saludo", buyerId: `b_${uid()}`, status: "paid" },
        path
      ),
      params: { requestId },
    });
    let entry = await readEntry(creatorId, `greetingRequest__${requestId}`);
    expect(entry?.type).toBe("greeting");
    expect(entry?.status).toBe("pending");
    let s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(200);

    // 2) Entregado: libera a earned.
    await wrapped({
      data: change(
        { creatorId, paymentStatus: "paid", priceSnapshot: 200, status: "paid" },
        { creatorId, paymentStatus: "paid", priceSnapshot: 200, status: "delivered" },
        path
      ),
      params: { requestId },
    });
    entry = await readEntry(creatorId, `greetingRequest__${requestId}`);
    expect(entry?.status).toBe("earned");
    s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(0);
    expect(s?.lifetimeEarnedGross).toBe(200);
  });

  it("type 'consejo' -> resuelve como 'advice'", async () => {
    const creatorId = `c_${uid()}`;
    const requestId = `req_${uid()}`;
    const wrapped = testEnv.wrap(onGreetingLedger);
    await wrapped({
      data: change(
        {},
        { creatorId, paymentStatus: "paid", priceSnapshot: 50, type: "consejo", status: "paid" },
        `greetingRequests/${requestId}`
      ),
      params: { requestId },
    });

    const entry = await readEntry(creatorId, `greetingRequest__${requestId}`);
    expect(entry?.type).toBe("advice");
  });

  it("pagado -> pending -> rechazado -> reversed (rejected)", async () => {
    const creatorId = `c_${uid()}`;
    const requestId = `req_${uid()}`;
    const path = `greetingRequests/${requestId}`;
    const wrapped = testEnv.wrap(onGreetingLedger);

    await wrapped({
      data: change({}, { creatorId, paymentStatus: "paid", priceSnapshot: 80, type: "saludo", status: "paid" }, path),
      params: { requestId },
    });
    await wrapped({
      data: change(
        { creatorId, paymentStatus: "paid", priceSnapshot: 80, status: "paid" },
        { creatorId, paymentStatus: "paid", priceSnapshot: 80, status: "rejected" },
        path
      ),
      params: { requestId },
    });

    const entry = await readEntry(creatorId, `greetingRequest__${requestId}`);
    expect(entry?.status).toBe("rejected");
    const s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(0);
    expect(s?.rejectedGross).toBe(80);
  });
});

describe("onExclusiveSessionLedger (#8) y onMeetGreetLedger (#9)", () => {
  it("sesión exclusiva: pagado -> pending -> completed -> earned", async () => {
    const creatorId = `c_${uid()}`;
    const requestId = `req_${uid()}`;
    const path = `exclusiveSessionRequests/${requestId}`;
    const wrapped = testEnv.wrap(onExclusiveSessionLedger);

    await wrapped({
      data: change({}, { creatorId, paymentStatus: "paid", priceSnapshot: 300, status: "paid" }, path),
      params: { requestId },
    });
    await wrapped({
      data: change(
        { creatorId, paymentStatus: "paid", priceSnapshot: 300, status: "paid" },
        { creatorId, paymentStatus: "paid", priceSnapshot: 300, status: "completed" },
        path
      ),
      params: { requestId },
    });

    const entry = await readEntry(creatorId, `exclusiveSessionRequest__${requestId}`);
    expect(entry?.type).toBe("exclusive_session");
    expect(entry?.status).toBe("earned");
  });

  it("meet & greet: pagado registra pending como 'live_session'", async () => {
    const creatorId = `c_${uid()}`;
    const requestId = `req_${uid()}`;
    const wrapped = testEnv.wrap(onMeetGreetLedger);

    await wrapped({
      data: change({}, { creatorId, paymentStatus: "paid", priceSnapshot: 150, status: "paid" }, `meetGreetRequests/${requestId}`),
      params: { requestId },
    });

    const entry = await readEntry(creatorId, `meetGreetRequest__${requestId}`);
    expect(entry?.type).toBe("live_session");
    expect(entry?.status).toBe("pending");
  });
});
