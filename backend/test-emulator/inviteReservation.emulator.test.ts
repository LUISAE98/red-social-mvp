import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

import { reserveInviteSlot } from "../src/payments/groupSubscriptionCore";

// ─────────────────────────────────────────────────────────────────────────────
// B6-C04 — el cupo de la invitación se reserva ANTES de cobrar.
//
// Antes se validaba el tope con una lectura simple al empezar el checkout y el
// webhook lo re-comprobaba al llegar la factura: si ya estaba agotado dejaba de
// contar **pero activaba la membresía igual**. Dos personas con el último cupo
// pagaban las dos y entraban las dos a una comunidad oculta.
//
// Reservando antes, quien llega tarde se queda fuera SIN haber pagado, y
// desaparece el problema de qué hacer con alguien a quien ya le cobraste.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function id(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function sembrarInvitacion(groupId: string, token: string, maxUses: number | null) {
  await db.doc(`groups/${groupId}/inviteLinks/${token}`).set({
    token,
    groupId,
    isActive: true,
    usedCount: 0,
    maxUses,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86_400_000),
  });
}

async function intentar(groupId: string, token: string, uid: string): Promise<string | null> {
  try {
    await reserveInviteSlot(groupId, token, uid);
    return null;
  } catch (error) {
    return (error as { code?: string })?.code ?? "desconocido";
  }
}

describe("reserveInviteSlot", () => {
  it("🟢 reserva mientras hay cupo y 🔴 rechaza al agotarse", async () => {
    const groupId = id();
    const token = id();
    await sembrarInvitacion(groupId, token, 2);

    expect(await intentar(groupId, token, id())).toBeNull();
    expect(await intentar(groupId, token, id())).toBeNull();
    expect(await intentar(groupId, token, id())).toBe("permission-denied");
  });

  it("🔴 varias reservas a la vez NO se pasan del tope", async () => {
    // El caso que rompía: dos checkouts concurrentes con el último cupo.
    const groupId = id();
    const token = id();
    await sembrarInvitacion(groupId, token, 3);

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => intentar(groupId, token, id()))
    );

    expect(resultados.filter((r) => r === null).length).toBe(3);
    expect((await db.doc(`groups/${groupId}/inviteLinks/${token}`).get()).get("usedCount")).toBe(3);
  });

  it("🟢 el mismo comprador reintentando NO consume otro cupo", async () => {
    const groupId = id();
    const token = id();
    const uid = id();
    await sembrarInvitacion(groupId, token, 1);

    expect(await intentar(groupId, token, uid)).toBeNull();
    expect(await intentar(groupId, token, uid)).toBeNull();
    expect((await db.doc(`groups/${groupId}/inviteLinks/${token}`).get()).get("usedCount")).toBe(1);
  });

  it("🟢 al llegar al tope la invitación se desactiva sola", async () => {
    const groupId = id();
    const token = id();
    await sembrarInvitacion(groupId, token, 1);

    await intentar(groupId, token, id());
    expect((await db.doc(`groups/${groupId}/inviteLinks/${token}`).get()).get("isActive")).toBe(false);
  });

  it("🟢 una invitación sin tope admite a todos", async () => {
    const groupId = id();
    const token = id();
    await sembrarInvitacion(groupId, token, null);

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => intentar(groupId, token, id()))
    );
    expect(resultados.every((r) => r === null)).toBe(true);
  });

  it("🔴 una invitación de OTRA comunidad no sirve", async () => {
    const groupId = id();
    const token = id();
    await sembrarInvitacion(groupId, token, 5);
    expect(await intentar(id(), token, id())).toBe("permission-denied");
  });
});
