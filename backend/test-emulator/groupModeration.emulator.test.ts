import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import functionsTest from "firebase-functions-test";

import {
  promoteGroupMemberToAdmin,
  demoteGroupAdminToMember,
  muteGroupMember,
  unmuteGroupMember,
  banGroupMember,
  removeGroupMember,
} from "../src/groupModeration";

// ─────────────────────────────────────────────────────────────────────────────
// B7-M10 — la autorización se comprueba DENTRO de la transacción que escribe.
//
// Los siete flujos hacían: leer mi rol → comprobar → escribir con un `batch`. Un
// batch no detecta conflictos, así que entre la comprobación y la escritura el
// creador podía haberme degradado y mi acción entraba igual.
//
// Estas pruebas cubren además el comportamiento de siempre: el cambio reescribió
// los siete flujos y no había ninguna red debajo.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();
const testEnv = functionsTest();

const promover = testEnv.wrap(promoteGroupMemberToAdmin);
const degradar = testEnv.wrap(demoteGroupAdminToMember);
const silenciar = testEnv.wrap(muteGroupMember);
const quitarSilencio = testEnv.wrap(unmuteGroupMember);
const banear = testEnv.wrap(banGroupMember);
const expulsar = testEnv.wrap(removeGroupMember);

function uid(): string {
  return crypto.randomUUID();
}

function auth(userId: string) {
  return { uid: userId, token: {} as unknown as Record<string, unknown> };
}

async function sembrarMiembro(
  groupId: string,
  userId: string,
  roleInGroup: string,
  status = "active"
) {
  await db.doc(`groups/${groupId}/members/${userId}`).set({ userId, roleInGroup, status });
}

async function escenario() {
  const groupId = uid();
  const creador = uid();
  const moderador = uid();
  const miembro = uid();

  await db.doc(`groups/${groupId}`).set({ ownerId: creador, visibility: "public", isActive: true });
  await sembrarMiembro(groupId, creador, "owner");
  await sembrarMiembro(groupId, moderador, "mod");
  await sembrarMiembro(groupId, miembro, "member");

  return { groupId, creador, moderador, miembro };
}

async function codigo(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as { code?: string })?.code ?? "desconocido";
  }
}

async function estadoDe(groupId: string, userId: string) {
  const d = (await db.doc(`groups/${groupId}/members/${userId}`).get()).data() ?? {};
  return { status: d.status, roleInGroup: d.roleInGroup };
}

describe("moderación de comunidad — autorización", () => {
  let e: Awaited<ReturnType<typeof escenario>>;

  beforeAll(async () => {
    e = await escenario();
  });

  it("🟢 el creador asciende a un miembro activo", async () => {
    const caso = await escenario();
    await promover({
      data: { groupId: caso.groupId, targetUserId: caso.miembro },
      auth: auth(caso.creador),
    } as never);
    expect((await estadoDe(caso.groupId, caso.miembro)).roleInGroup).toBe("mod");
  });

  it("🔴 un MODERADOR no puede ascender: es cosa del creador", async () => {
    expect(
      await codigo(() =>
        promover({
          data: { groupId: e.groupId, targetUserId: e.miembro },
          auth: auth(e.moderador),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 un moderador no puede moderar a OTRO moderador", async () => {
    const otroMod = uid();
    await sembrarMiembro(e.groupId, otroMod, "mod");

    expect(
      await codigo(() =>
        silenciar({
          data: { groupId: e.groupId, targetUserId: otroMod, durationDays: 1 },
          auth: auth(e.moderador),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 nadie puede moderar al CREADOR", async () => {
    expect(
      await codigo(() =>
        banear({
          data: { groupId: e.groupId, targetUserId: e.creador },
          auth: auth(e.moderador),
        } as never)
      )
    ).toBe("failed-precondition");
  });

  it("🔴 nadie puede moderarse a sí mismo", async () => {
    expect(
      await codigo(() =>
        silenciar({
          data: { groupId: e.groupId, targetUserId: e.moderador, durationDays: 1 },
          auth: auth(e.moderador),
        } as never)
      )
    ).toBe("failed-precondition");
  });

  it("🔴 un moderador YA DEGRADADO no puede moderar", async () => {
    // El corazón de M10: la autorización se lee dentro de la transacción, así que
    // vale el estado del momento de escribir, no el de hace un rato.
    const caso = await escenario();
    const exMod = uid();
    await sembrarMiembro(caso.groupId, exMod, "member"); // fue moderador, ya no

    expect(
      await codigo(() =>
        expulsar({
          data: { groupId: caso.groupId, targetUserId: caso.miembro },
          auth: auth(exMod),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 un moderador SILENCIADO tampoco", async () => {
    const caso = await escenario();
    const modMuteado = uid();
    await sembrarMiembro(caso.groupId, modMuteado, "mod", "muted");

    expect(
      await codigo(() =>
        expulsar({
          data: { groupId: caso.groupId, targetUserId: caso.miembro },
          auth: auth(modMuteado),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 alguien de fuera no puede moderar", async () => {
    expect(
      await codigo(() =>
        expulsar({
          data: { groupId: e.groupId, targetUserId: e.miembro },
          auth: auth(uid()),
        } as never)
      )
    ).toBe("permission-denied");
  });
});

describe("moderación de comunidad — efectos", () => {
  it("🟢 silenciar deja el estado y degrada el rol", async () => {
    const caso = await escenario();
    await silenciar({
      data: { groupId: caso.groupId, targetUserId: caso.miembro, durationDays: 3 },
      auth: auth(caso.creador),
    } as never);

    const m = await estadoDe(caso.groupId, caso.miembro);
    expect(m.status).toBe("muted");
    expect(m.roleInGroup).toBe("member");
  });

  it("🟢 quitar el silencio devuelve a activo", async () => {
    const caso = await escenario();
    await silenciar({
      data: { groupId: caso.groupId, targetUserId: caso.miembro, durationDays: 3 },
      auth: auth(caso.creador),
    } as never);
    await quitarSilencio({
      data: { groupId: caso.groupId, targetUserId: caso.miembro },
      auth: auth(caso.creador),
    } as never);

    expect((await estadoDe(caso.groupId, caso.miembro)).status).toBe("active");
  });

  it("🟢 expulsar marca `removed` y borra el espejo de la membresía", async () => {
    const caso = await escenario();
    await db
      .doc(`users/${caso.miembro}/groupMemberships/${caso.groupId}`)
      .set({ groupId: caso.groupId, userId: caso.miembro });

    await expulsar({
      data: { groupId: caso.groupId, targetUserId: caso.miembro },
      auth: auth(caso.creador),
    } as never);

    expect((await estadoDe(caso.groupId, caso.miembro)).status).toBe("removed");
    expect(
      (await db.doc(`users/${caso.miembro}/groupMemberships/${caso.groupId}`).get()).exists
    ).toBe(false);
  });

  it("🟢 ascender es idempotente: repetirlo no falla", async () => {
    const caso = await escenario();
    const datos = { groupId: caso.groupId, targetUserId: caso.miembro };
    await promover({ data: datos, auth: auth(caso.creador) } as never);
    await promover({ data: datos, auth: auth(caso.creador) } as never);
    expect((await estadoDe(caso.groupId, caso.miembro)).roleInGroup).toBe("mod");
  });

  it("🟢 degradar devuelve a miembro", async () => {
    const caso = await escenario();
    const datos = { groupId: caso.groupId, targetUserId: caso.miembro };
    await promover({ data: datos, auth: auth(caso.creador) } as never);
    await degradar({ data: datos, auth: auth(caso.creador) } as never);
    expect((await estadoDe(caso.groupId, caso.miembro)).roleInGroup).toBe("member");
  });

  it("🔴 no se puede ascender a alguien silenciado", async () => {
    const caso = await escenario();
    const muteado = uid();
    await sembrarMiembro(caso.groupId, muteado, "member", "muted");

    expect(
      await codigo(() =>
        promover({
          data: { groupId: caso.groupId, targetUserId: muteado },
          auth: auth(caso.creador),
        } as never)
      )
    ).toBe("failed-precondition");
  });
});
