import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

import { assertAccountNotBanned } from "../src/accountStatus";

// ─────────────────────────────────────────────────────────────────────────────
// B5-M07 (opción B) — cuenta suspendida en la hora de gracia del token.
//
// `blockUser` deshabilita la cuenta en Firebase Auth y revoca sus refresh tokens,
// pero la llave que el baneado ya tuviera sigue valiendo hasta ~1 h. Esta
// comprobación cierra esa ventana donde duele: dinero y recursos con factura.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function uid(): string {
  return crypto.randomUUID();
}

async function codigo(u: string): Promise<string | null> {
  try {
    await assertAccountNotBanned(u);
    return null;
  } catch (error) {
    return (error as { code?: string })?.code ?? "desconocido";
  }
}

describe("assertAccountNotBanned", () => {
  it("🔴 una cuenta marcada como baneada no pasa", async () => {
    const u = uid();
    await db.collection("users").doc(u).set({ uid: u, platformBanned: true });
    expect(await codigo(u)).toBe("permission-denied");
  });

  it("🟢 una cuenta normal pasa", async () => {
    const u = uid();
    await db.collection("users").doc(u).set({ uid: u });
    expect(await codigo(u)).toBeNull();
  });

  it("🟢 `platformBanned: false` pasa", async () => {
    const u = uid();
    await db.collection("users").doc(u).set({ uid: u, platformBanned: false });
    expect(await codigo(u)).toBeNull();
  });

  it("🟢 una ficha que NO existe pasa — es el comprador invitado", async () => {
    // Las compras sin login usan sesión anónima y muchas no tienen documento en
    // `users`. Tratar la ausencia como baneo dejaría sin pagar a todo ese flujo.
    expect(await codigo(uid())).toBeNull();
  });

  it("🟢 sin uid no lanza", async () => {
    expect(await codigo("")).toBeNull();
  });
});
