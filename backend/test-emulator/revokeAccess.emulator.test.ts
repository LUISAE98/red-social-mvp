import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

import { revokeAccessForSource } from "../src/payments/stripe/revokeAccessOnRefund";

// ─────────────────────────────────────────────────────────────────────────────
// B6-C03 — devolver el dinero tiene que quitar lo comprado.
//
// El reconciliador de reembolsos revertía el asiento del ledger y nada más: el
// comprador recuperaba el dinero y conservaba el post de pago, la entrada del
// directo o la comunidad. Un paywall que se cruza pidiendo el dinero de vuelta
// al banco no es un paywall.
//
// Alcance: esto cubre contracargos y reembolsos desde el panel de Stripe. Las
// devoluciones que se piden DENTRO de Vibra son solo de saludo, consejo, sesión
// exclusiva y tiempo contigo, y tienen su propio camino.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function id(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

describe("revokeAccessForSource", () => {
  it("🔴 el acceso a un post de pago se retira", async () => {
    const postId = id();
    const uid = id();
    const ref = db.doc(`postAccess/${postId}_${uid}`);
    await ref.set({ buyerId: uid, status: "paid" });

    await revokeAccessForSource("postAccess", `${postId}_${uid}`, "chargeback_lost");

    const d = (await ref.get()).data() ?? {};
    expect(d.status).toBe("revoked");
    expect(d.revoked).toBe(true);
    expect(d.revokedReason).toBe("chargeback_lost");
  });

  it("🔴 la entrada a un directo se retira, y vive en una subcolección", async () => {
    const liveId = id();
    const uid = id();
    const ref = db.doc(`liveAccess/${liveId}/users/${uid}`);
    await ref.set({ userId: uid, status: "paid" });

    await revokeAccessForSource("liveAccess", `${liveId}_${uid}`, "chargeback_lost");

    expect((await ref.get()).get("status")).toBe("revoked");
  });

  it("🔴 la suscripción a una comunidad retira también la membresía", async () => {
    const groupId = id();
    const uid = id();
    const invoiceId = id();

    await db.doc(`groupSubscriptions/${groupId}_${uid}`).set({ active: true, status: "authorized" });
    await db.doc(`groups/${groupId}/members/${uid}`).set({ userId: uid, status: "subscribed" });
    await db.doc(`users/${uid}/groupMemberships/${groupId}`).set({ groupId, userId: uid });

    await revokeAccessForSource("groupSubscription", `${groupId}_${uid}_${invoiceId}`, "chargeback_lost");

    const sub = (await db.doc(`groupSubscriptions/${groupId}_${uid}`).get()).data() ?? {};
    expect(sub.active).toBe(false);
    expect(sub.status).toBe("refunded");
    expect((await db.doc(`groups/${groupId}/members/${uid}`).get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}/groupMemberships/${groupId}`).get()).exists).toBe(false);
  });

  it("🟢 el documento se conserva, no se borra — hace falta para investigar la disputa", async () => {
    const postId = id();
    const uid = id();
    const ref = db.doc(`postAccess/${postId}_${uid}`);
    await ref.set({ buyerId: uid, status: "paid", amount: 150 });

    await revokeAccessForSource("postAccess", `${postId}_${uid}`, "chargeback_lost");

    const d = (await ref.get()).data() ?? {};
    expect(d.buyerId).toBe(uid);
    expect(d.amount).toBe(150);
  });

  it("🟢 un servicio que se entrega no tiene acceso que retirar, y no falla", async () => {
    await expect(
      revokeAccessForSource("greetingRequest", id(), "chargeback_lost")
    ).resolves.toBeUndefined();
  });

  it("🟢 un acceso que no existe no rompe nada", async () => {
    await expect(
      revokeAccessForSource("postAccess", `${id()}_${id()}`, "chargeback_lost")
    ).resolves.toBeUndefined();
  });
});
