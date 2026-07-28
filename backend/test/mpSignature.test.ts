import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import { verifyMpWebhookSignature } from "../src/payments/mpClient";

// Firma del webhook de Mercado Pago (anti-suplantación). Si esto falla, un
// atacante podría falsear un "pago aprobado" y disparar entregas/earnings sin
// haber pagado. Es la barrera de seguridad más crítica del flujo de dinero.

const SECRET = "test_webhook_secret_123";

/** Firma un manifiesto igual que MP: id:<id>;request-id:<rid>;ts:<ts>; */
function sign(dataId: string, requestId: string, ts: string, secret = SECRET): string {
  const id = /^[a-zA-Z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", secret).update(manifest, "utf8").digest("hex");
  return v1;
}

function nowTs(): string {
  return String(Math.floor(Date.now() / 1000));
}

describe("verifyMpWebhookSignature", () => {
  it("acepta una firma válida y reciente", () => {
    const ts = nowTs();
    const dataId = "ord_123";
    const requestId = "req-abc";
    const v1 = sign(dataId, requestId, ts);
    const ok = verifyMpWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      dataId,
      secret: SECRET,
    });
    expect(ok).toBe(true);
  });

  it("rechaza una firma manipulada (v1 alterado)", () => {
    const ts = nowTs();
    const dataId = "ord_123";
    const requestId = "req-abc";
    const v1 = sign(dataId, requestId, ts);
    const tampered = v1.slice(0, -1) + (v1.endsWith("a") ? "b" : "a");
    const ok = verifyMpWebhookSignature({
      xSignature: `ts=${ts},v1=${tampered}`,
      xRequestId: requestId,
      dataId,
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  it("rechaza si el data.id no coincide con la firma (suplantación)", () => {
    const ts = nowTs();
    const requestId = "req-abc";
    const v1 = sign("ord_real", requestId, ts);
    const ok = verifyMpWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      dataId: "ord_fake", // el atacante cambia el recurso
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  it("rechaza si el secreto es incorrecto", () => {
    const ts = nowTs();
    const dataId = "ord_123";
    const requestId = "req-abc";
    const v1 = sign(dataId, requestId, ts, "otro_secreto");
    const ok = verifyMpWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      dataId,
      secret: SECRET,
    });
    expect(ok).toBe(false);
  });

  it("anti-replay: rechaza una firma vieja fuera de la ventana", () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 10_000); // ~2.7h atrás
    const dataId = "ord_123";
    const requestId = "req-abc";
    const v1 = sign(dataId, requestId, oldTs);
    const ok = verifyMpWebhookSignature({
      xSignature: `ts=${oldTs},v1=${v1}`,
      xRequestId: requestId,
      dataId,
      secret: SECRET,
      toleranceSeconds: 300,
    });
    expect(ok).toBe(false);
  });

  it("toleranceSeconds=0 desactiva el chequeo de tiempo (firma vieja pero válida)", () => {
    const oldTs = String(Math.floor(Date.now() / 1000) - 10_000);
    const dataId = "ord_123";
    const requestId = "req-abc";
    const v1 = sign(dataId, requestId, oldTs);
    const ok = verifyMpWebhookSignature({
      xSignature: `ts=${oldTs},v1=${v1}`,
      xRequestId: requestId,
      dataId,
      secret: SECRET,
      toleranceSeconds: 0,
    });
    expect(ok).toBe(true);
  });

  it("normaliza a minúsculas un data.id alfanumérico antes de firmar", () => {
    const ts = nowTs();
    const requestId = "req-abc";
    // La firma se calcula sobre el id EN MINÚSCULAS...
    const v1 = sign("ABC123", requestId, ts); // sign() ya lo baja a minúsculas
    // ...y MP puede mandar el data.id en mayúsculas: debe seguir validando.
    const ok = verifyMpWebhookSignature({
      xSignature: `ts=${ts},v1=${v1}`,
      xRequestId: requestId,
      dataId: "ABC123",
      secret: SECRET,
      toleranceSeconds: 0,
    });
    expect(ok).toBe(true);
  });

  it("rechaza si falta la cabecera x-signature", () => {
    expect(
      verifyMpWebhookSignature({
        xSignature: undefined,
        xRequestId: "req-abc",
        dataId: "ord_123",
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rechaza si falta el data.id", () => {
    const ts = nowTs();
    expect(
      verifyMpWebhookSignature({
        xSignature: `ts=${ts},v1=deadbeef`,
        xRequestId: "req-abc",
        dataId: undefined,
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rechaza una x-signature mal formada (sin ts o sin v1)", () => {
    const dataId = "ord_123";
    expect(
      verifyMpWebhookSignature({
        xSignature: "v1=deadbeef", // falta ts
        xRequestId: "req-abc",
        dataId,
        secret: SECRET,
      })
    ).toBe(false);
    expect(
      verifyMpWebhookSignature({
        xSignature: "ts=123", // falta v1
        xRequestId: "req-abc",
        dataId,
        secret: SECRET,
      })
    ).toBe(false);
  });
});
