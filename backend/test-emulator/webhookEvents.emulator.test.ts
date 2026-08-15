import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

import { claimWebhookEvent } from "../src/webhookEvents";

// ─────────────────────────────────────────────────────────────────────────────
// B5-M03 — el reclamo de idempotencia de webhooks.
//
// El `catch` trataba CUALQUIER error como "entrega duplicada". Si Firestore
// parpadeaba, el webhook respondía "ya estaba hecho" y 200: el proveedor daba la
// entrega por buena y no reintentaba, así que el evento se perdía para siempre —
// un cobro sin acceso, una membresía sin activar— y en silencio.
//
// Ahora solo ALREADY_EXISTS cuenta como duplicado; lo demás se propaga para que
// el manejador devuelva 5xx y el proveedor reintente.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });

const COLECCION = "testWebhookEvents";

describe("claimWebhookEvent", () => {
  it("🟢 la primera entrega reclama el evento", async () => {
    const claim = await claimWebhookEvent(COLECCION, crypto.randomUUID(), { tipo: "prueba" });
    expect(claim.claimed).toBe(true);
  });

  it("🔴 la segunda entrega del MISMO evento no reclama", async () => {
    const id = crypto.randomUUID();
    const primera = await claimWebhookEvent(COLECCION, id);
    const segunda = await claimWebhookEvent(COLECCION, id);

    expect(primera.claimed).toBe(true);
    expect(segunda.claimed).toBe(false);
  });

  it("🟢 tras `release()` el evento se puede volver a reclamar", async () => {
    // Es lo que permite que el proveedor reintente cuando el manejador falla.
    const id = crypto.randomUUID();
    const primera = await claimWebhookEvent(COLECCION, id);
    await primera.release?.();

    const segunda = await claimWebhookEvent(COLECCION, id);
    expect(segunda.claimed).toBe(true);
  });

  it("🔴 un fallo que NO es duplicado se propaga, no se traga", async () => {
    // Un id inválido (con barra) hace que Firestore rechace la ruta. Antes esto
    // devolvía `claimed: false` —o sea, "duplicado"— y el evento se perdía.
    await expect(
      claimWebhookEvent(COLECCION, "id/invalido/con/barras")
    ).rejects.toBeTruthy();
  });
});
