import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import {
  recordEarning,
  settleEarning,
  reverseEarning,
  netFromGross,
} from "../src/wallet/ledger";

// ─────────────────────────────────────────────────────────────────────────────
// Contabilidad del ledger contra el emulador de Firestore.
//
// Requiere FIRESTORE_EMULATOR_HOST (lo define `firebase emulators:exec`). Cada
// test usa un creatorId único, así que no hay contaminación entre casos y no hace
// falta limpiar el emulador entre pruebas.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function newCreator(): string {
  return `creator_${crypto.randomUUID()}`;
}
function entryId(sourceType: string, sourceId: string): string {
  return `${sourceType}__${sourceId}`;
}
async function readSummary(creatorId: string) {
  const snap = await db.doc(`users/${creatorId}/walletSummary/current`).get();
  return snap.data() as Record<string, number> | undefined;
}
async function readEntry(creatorId: string, sourceType: string, sourceId: string) {
  const snap = await db
    .doc(`users/${creatorId}/walletLedger/${entryId(sourceType, sourceId)}`)
    .get();
  return snap.data() as Record<string, unknown> | undefined;
}

beforeAll(() => {
  // Falla temprano y claro si alguien corre esto sin el emulador (evita que
  // pegue a Firestore real).
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "FIRESTORE_EMULATOR_HOST no está definido. Corre: npm run test:emulator"
    );
  }
});

describe("recordEarning", () => {
  it("una venta 'earned' crea la entrada y suma al lifetime del summary", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "supercomment",
      grossAmount: 100,
      sourceType: "superComment",
      sourceId: "p1_sc1",
      buyerId: "buyer1",
      earnedImmediately: true,
    });

    const entry = await readEntry(creatorId, "superComment", "p1_sc1");
    expect(entry?.status).toBe("earned");
    expect(entry?.grossAmount).toBe(100);
    expect(entry?.netAmount).toBe(netFromGross(100)); // 77

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(100);
    expect(s?.lifetimeEarnedNet).toBe(77);
    expect(s?.pendingGross).toBe(0);
  });

  it("una venta 'pending' (grupo B) suma a pending, no al lifetime", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 200,
      sourceType: "greetingRequest",
      sourceId: "g1",
      earnedImmediately: false,
    });

    const s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(200);
    expect(s?.pendingNet).toBe(netFromGross(200)); // 154
    expect(s?.lifetimeEarnedGross).toBe(0);
  });

  it("IDEMPOTENCIA: registrar dos veces la misma venta no dobla nada (anti doble cobro)", async () => {
    const creatorId = newCreator();
    const params = {
      type: "premium_post" as const,
      grossAmount: 50,
      sourceType: "postAccess",
      sourceId: "acc1",
      earnedImmediately: true,
    };
    await recordEarning(creatorId, params);
    await recordEarning(creatorId, params); // reintento / webhook duplicado

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(50); // NO 100
    expect(s?.lifetimeEarnedNet).toBe(netFromGross(50)); // NO el doble

    const entries = await db
      .collection(`users/${creatorId}/walletLedger`)
      .get();
    expect(entries.size).toBe(1); // una sola entrada
  });
});

describe("settleEarning (pending -> earned)", () => {
  it("libera una venta pendiente: resta de pending y suma al lifetime", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 300,
      sourceType: "greetingRequest",
      sourceId: "g2",
      earnedImmediately: false,
    });
    await settleEarning(creatorId, "greetingRequest", "g2");

    const entry = await readEntry(creatorId, "greetingRequest", "g2");
    expect(entry?.status).toBe("earned");

    const s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(0);
    expect(s?.lifetimeEarnedGross).toBe(300);
    expect(s?.lifetimeEarnedNet).toBe(netFromGross(300));
  });

  it("settle sobre una entrada ya 'earned' es no-op (no doble conteo)", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 300,
      sourceType: "greetingRequest",
      sourceId: "g3",
      earnedImmediately: false,
    });
    await settleEarning(creatorId, "greetingRequest", "g3");
    await settleEarning(creatorId, "greetingRequest", "g3"); // segunda vez

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(300); // NO 600
    expect(s?.pendingGross).toBe(0); // NO negativo
  });
});

describe("reverseEarning (reembolsos / rechazos)", () => {
  it("earned -> refunded: resta del lifetime y suma a refunded", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "premium_post",
      grossAmount: 100,
      sourceType: "postAccess",
      sourceId: "acc2",
      earnedImmediately: true,
    });
    await reverseEarning(creatorId, "postAccess", "acc2");

    const entry = await readEntry(creatorId, "postAccess", "acc2");
    expect(entry?.status).toBe("refunded");

    const s = await readSummary(creatorId);
    expect(s?.lifetimeEarnedGross).toBe(0);
    expect(s?.refundedGross).toBe(100);
    expect(s?.refundedNet).toBe(netFromGross(100));
  });

  it("pending -> rejected: resta de pending y suma a rejected", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "greeting",
      grossAmount: 80,
      sourceType: "greetingRequest",
      sourceId: "g4",
      earnedImmediately: false,
    });
    await reverseEarning(creatorId, "greetingRequest", "g4");

    const entry = await readEntry(creatorId, "greetingRequest", "g4");
    expect(entry?.status).toBe("rejected");

    const s = await readSummary(creatorId);
    expect(s?.pendingGross).toBe(0);
    expect(s?.rejectedGross).toBe(80);
  });

  it("DOBLE REVERSA es no-op: no deja el summary negativo", async () => {
    const creatorId = newCreator();
    await recordEarning(creatorId, {
      type: "premium_post",
      grossAmount: 100,
      sourceType: "postAccess",
      sourceId: "acc3",
      earnedImmediately: true,
    });
    await reverseEarning(creatorId, "postAccess", "acc3");
    await reverseEarning(creatorId, "postAccess", "acc3"); // segunda vez

    const s = await readSummary(creatorId);
    expect(s?.refundedGross).toBe(100); // NO 200
    expect(s?.lifetimeEarnedGross).toBe(0); // NO -100
  });
});

describe("invariantes del summary", () => {
  it("ningún agregado queda negativo tras una secuencia record/settle/reverse", async () => {
    const creatorId = newCreator();
    // Dos ventas pendientes; una se libera, la otra se rechaza; una tercera
    // earned que luego se reembolsa.
    await recordEarning(creatorId, { type: "greeting", grossAmount: 100, sourceType: "greetingRequest", sourceId: "a", earnedImmediately: false });
    await recordEarning(creatorId, { type: "advice", grossAmount: 50, sourceType: "greetingRequest", sourceId: "b", earnedImmediately: false });
    await recordEarning(creatorId, { type: "premium_post", grossAmount: 200, sourceType: "postAccess", sourceId: "c", earnedImmediately: true });
    await settleEarning(creatorId, "greetingRequest", "a");
    await reverseEarning(creatorId, "greetingRequest", "b");
    await reverseEarning(creatorId, "postAccess", "c");

    const s = (await readSummary(creatorId))!;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "number") {
        expect(v, `${k} no debe ser negativo`).toBeGreaterThanOrEqual(0);
      }
    }
    // a liberado (100 earned) y c reembolsado (200) -> lifetime neto = 100.
    expect(s.lifetimeEarnedGross).toBe(100);
    expect(s.rejectedGross).toBe(50);
    expect(s.refundedGross).toBe(200);
    expect(s.pendingGross).toBe(0);
  });
});
