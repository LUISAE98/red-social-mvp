import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

const SECRET = "test_webhook_secret_xyz";
// El handler lee el secreto con mpWebhookSecret.value() (= process.env) en runtime.
process.env.MP_WEBHOOK_SECRET = SECRET;

// mpFetch (red a MP) mockeado; verifyMpWebhookSignature y los secretos REALES.
vi.mock("../src/payments/mpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/payments/mpClient")>();
  return { ...actual, mpFetch: vi.fn() };
});
// La reconciliación de suscripciones (preapproval) pega a MP: la mockeamos.
vi.mock("../src/payments/groupSubscription", () => ({
  reconcileMpSubscription: vi.fn(),
}));

import { mpWebhook } from "../src/payments/mpWebhook";
import { mpFetch } from "../src/payments/mpClient";
import { reconcileMpSubscription } from "../src/payments/groupSubscription";

const mpFetchMock = vi.mocked(mpFetch);
const reconcileSubMock = vi.mocked(reconcileMpSubscription);

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function uid(): string {
  return crypto.randomUUID();
}
function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}
/** Firma válida para (dataId, requestId, ts) con el secreto de prueba. */
function sign(dataId: string, requestId: string, ts: string): string {
  const id = /^[a-zA-Z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  return crypto.createHmac("sha256", SECRET).update(manifest, "utf8").digest("hex");
}
/** Request sintético con firma válida (salvo que se pida override). */
function makeReq(opts: {
  method?: string;
  type?: string;
  dataId?: string;
  badSignature?: boolean;
}) {
  const { method = "POST", type = "order", dataId = "ord1", badSignature } = opts;
  const ts = nowTs();
  const requestId = "req-1";
  const v1 = badSignature ? "deadbeef" : sign(dataId, requestId, ts);
  return {
    method,
    query: { type, "data.id": dataId },
    headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
    body: {},
  } as any;
}
/** Response mock que resuelve una promesa cuando el handler responde. */
function makeRes() {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(o: unknown) {
      this.body = o;
      resolve();
      return this;
    },
  };
  return { res, done };
}
async function invoke(req: any) {
  const { res, done } = makeRes();
  await Promise.resolve((mpWebhook as unknown as (rq: any, rs: any) => unknown)(req, res));
  await done;
  return res;
}
async function getDoc(path: string) {
  return (await db.doc(path).get()).data() as Record<string, unknown> | undefined;
}

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Corre con: npm run test:emulator");
  }
});
beforeEach(() => {
  mpFetchMock.mockReset();
  reconcileSubMock.mockReset();
});

describe("mpWebhook — seguridad y routing", () => {
  it("método != POST -> 405", async () => {
    const res = await invoke(makeReq({ method: "GET" }));
    expect(res.statusCode).toBe(405);
  });

  it("firma inválida -> 401 y no consulta a MP", async () => {
    const res = await invoke(makeReq({ badSignature: true }));
    expect(res.statusCode).toBe(401);
    expect(mpFetchMock).not.toHaveBeenCalled();
  });

  it("topic desconocido con firma válida -> 200 (para que MP no reintente)", async () => {
    const res = await invoke(makeReq({ type: "foo", dataId: "x1" }));
    expect(res.statusCode).toBe(200);
  });

  it("topic de suscripción -> deriva a reconcileMpSubscription y 200", async () => {
    const res = await invoke(
      makeReq({ type: "subscription_preapproval", dataId: "preapp1" })
    );
    expect(res.statusCode).toBe(200);
    expect(reconcileSubMock).toHaveBeenCalledWith("subscription_preapproval", "preapp1");
  });
});

describe("mpWebhook — order aprobada (end-to-end con reconcile real)", () => {
  it("order 'processed' -> materializa el dominio y responde 200", async () => {
    const id = uid();
    const externalReference = `greetingRequest__${id}`;
    await db.collection("paymentIntents").doc(externalReference).set({
      buyerId: "u1",
      pendingGreeting: { creatorId: "creatorX", priceSnapshot: 200 },
    });
    mpFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/orders/")) {
        return {
          ok: true,
          status: 200,
          data: {
            id: "ord_1",
            status: "processed",
            external_reference: externalReference,
            transactions: { payments: [{ id: "pay_1", status: "approved" }] },
          },
        } as any;
      }
      return { ok: false, status: 404, error: "n/a" } as any;
    });

    const res = await invoke(makeReq({ type: "order", dataId: "ord_1" }));
    expect(res.statusCode).toBe(200);

    const intent = await getDoc(`paymentIntents/${externalReference}`);
    expect(intent?.status).toBe("approved");
    const greeting = await getDoc(`greetingRequests/${id}`);
    expect(greeting?.paymentStatus).toBe("paid");
    expect(greeting?.creatorId).toBe("creatorX");
  });

  it("entrega DUPLICADA del mismo webhook -> efecto único (idempotente)", async () => {
    const id = uid();
    const externalReference = `greetingRequest__${id}`;
    await db.collection("paymentIntents").doc(externalReference).set({
      pendingGreeting: { creatorId: "creatorX", priceSnapshot: 50 },
    });
    mpFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        id: "ord_2",
        status: "processed",
        external_reference: externalReference,
        transactions: { payments: [{ id: "pay_2", status: "approved" }] },
      },
    } as any);

    await invoke(makeReq({ type: "order", dataId: "ord_2" }));
    const res2 = await invoke(makeReq({ type: "order", dataId: "ord_2" }));
    expect(res2.statusCode).toBe(200);

    // El documento existe una sola vez y sigue 'paid' (no se rehízo ni duplicó).
    const greeting = await getDoc(`greetingRequests/${id}`);
    expect(greeting?.paymentStatus).toBe("paid");
    expect(greeting?.creatorId).toBe("creatorX");
  });

  it("topic 'payment' también se resuelve (MP avisa por el otro topic)", async () => {
    const id = uid();
    const externalReference = `greetingRequest__${id}`;
    await db.collection("paymentIntents").doc(externalReference).set({
      pendingGreeting: { creatorId: "creatorY", priceSnapshot: 70 },
    });
    mpFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/v1/payments/")) {
        return {
          ok: true,
          status: 200,
          data: {
            id: "pay_9",
            status: "approved",
            external_reference: externalReference,
            order: { id: "ord_9" },
          },
        } as any;
      }
      return { ok: false, status: 404, error: "n/a" } as any;
    });

    const res = await invoke(makeReq({ type: "payment", dataId: "pay_9" }));
    expect(res.statusCode).toBe(200);
    const greeting = await getDoc(`greetingRequests/${id}`);
    expect(greeting?.paymentStatus).toBe("paid");
  });
});
