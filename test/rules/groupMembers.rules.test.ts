import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Test de seguridad de las Firestore Rules: nadie puede auto-concederse una
// membresía de PAGO ("subscribed") sin un comprobante de pago que solo el backend
// puede crear (groupSubscriptions/{groupId}_{userId}, colección backend-only).
//
// Regresión que cierra: el flujo legítimo ya era server-authoritative
// (payGroupSubscription → Admin SDK), pero la regla de creación de miembro NO
// exigía prueba de pago, así que un cliente podía fabricarse acceso sin pagar.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-vibra",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8085,
    },
  });
});
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Siembra un doc saltándose las reglas (simula lo que escribe el backend). */
async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

describe("groups/{g}/members create — prueba de pago obligatoria", () => {
  it("🔴 cliente NO puede crearse membresía 'subscribed' en grupo de pago SIN comprobante", async () => {
    const gid = "gPago";
    const attacker = "attacker";
    await seed(`groups/${gid}`, {
      ownerId: "owner",
      visibility: "hidden",
      isActive: true,
      monetization: { subscriptionsEnabled: true },
    });

    const db = testEnv.authenticatedContext(attacker).firestore();
    await assertFails(
      setDoc(doc(db, `groups/${gid}/members/${attacker}`), {
        userId: attacker,
        roleInGroup: "member",
        status: "subscribed",
        accessType: "subscription",
      })
    );
  });

  it("✅ CON groupSubscriptions pagado (creado por el backend) el cliente SÍ puede", async () => {
    const gid = "gPago2";
    const buyer = "buyer";
    await seed(`groups/${gid}`, {
      ownerId: "owner",
      visibility: "hidden",
      isActive: true,
      monetization: { subscriptionsEnabled: true },
    });
    // Solo el backend puede crear esto (create:if false en las rules).
    await seed(`groupSubscriptions/${gid}_${buyer}`, { active: true, uid: buyer });

    const db = testEnv.authenticatedContext(buyer).firestore();
    await assertSucceeds(
      setDoc(doc(db, `groups/${gid}/members/${buyer}`), {
        userId: buyer,
        roleInGroup: "member",
        status: "subscribed",
        accessType: "subscription",
      })
    );
  });

  it("✅ unirse a un grupo PÚBLICO gratis sigue permitido (sin regresión)", async () => {
    const gid = "gPublico";
    const user = "user";
    await seed(`groups/${gid}`, { ownerId: "owner", visibility: "public", isActive: true });

    const db = testEnv.authenticatedContext(user).firestore();
    await assertSucceeds(
      setDoc(doc(db, `groups/${gid}/members/${user}`), {
        userId: user,
        roleInGroup: "member",
        status: "active",
        accessType: "standard",
      })
    );
  });

  it("🔴 un usuario no puede crear la membresía de OTRO usuario", async () => {
    const gid = "gPublico2";
    await seed(`groups/${gid}`, { ownerId: "owner", visibility: "public", isActive: true });

    const db = testEnv.authenticatedContext("user").firestore();
    await assertFails(
      setDoc(doc(db, `groups/${gid}/members/otro`), {
        userId: "otro",
        roleInGroup: "member",
        status: "active",
        accessType: "standard",
      })
    );
  });
});
