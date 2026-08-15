// Credenciales falsas ANTES de importar nada: `defineSecret(...).value()` las lee
// de process.env, y sin ellas la generación del token falla por un motivo que no
// es el que se está probando.
process.env.LIVEKIT_API_KEY = "APItest";
process.env.LIVEKIT_API_SECRET = "secreto_de_prueba_suficientemente_largo_1234567890";
process.env.LIVEKIT_URL = "wss://ejemplo.livekit.cloud";

import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import functionsTest from "firebase-functions-test";

import { getLivekitToken } from "../src/livekitTokens";

// ─────────────────────────────────────────────────────────────────────────────
// B5-C05 — quién puede entrar a la videollamada de una sesión pagada.
//
// El fallo: esta función solo aceptaba `paymentStatus === "simulated_paid"`, que
// es el estado del flujo simulado anterior a Stripe. El flujo real escribe
// `authorized` al retener el pago y `paid` al capturarlo, así que una sesión
// pagada de verdad y bien agendada NO obtenía token: comprador y creador se
// quedaban fuera con el dinero ya cobrado. Todos los demás sitios que miran el
// pago aceptaban los dos valores; este se quedó atrás.
//
// Lo que fija esta prueba: `paid` y `simulated_paid` entran, `authorized` no.
// `authorized` queda fuera a propósito — el cobro se captura AL AGENDAR, y esa
// misma operación deja el estado en `paid`; lo que sigue retenido no tiene cita.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();
const testEnv = functionsTest();

const llamar = testEnv.wrap(getLivekitToken);

const CREADOR = "creador_lk";
const COMPRADOR = "comprador_lk";

function uid(): string {
  return crypto.randomUUID();
}

/** Sesión agendada para dentro de un minuto, dentro de la ventana de entrada. */
async function sembrarSesion(paymentStatus: string): Promise<string> {
  const id = uid();
  await db.collection("meetGreetRequests").doc(id).set({
    creatorId: CREADOR,
    buyerId: COMPRADOR,
    status: "scheduled",
    paymentStatus,
    scheduledAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
    durationMinutes: 15,
  });
  return id;
}

async function pedirToken(sessionId: string, quien: string) {
  return llamar({
    data: { sessionId, sessionType: "meet_greet" },
    auth: { uid: quien, token: {} as unknown as Record<string, unknown> },
  } as never);
}

async function errorDe(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as { message?: string })?.message ?? "desconocido";
  }
}

describe("getLivekitToken — estados de pago que dan acceso", () => {
  beforeAll(async () => {
    await db.collection("users").doc(CREADOR).set({ displayName: "Creador" });
    await db.collection("users").doc(COMPRADOR).set({ displayName: "Comprador" });
  });

  it("🟢 una sesión PAGADA de verdad ('paid') da token al comprador", async () => {
    const id = await sembrarSesion("paid");
    const res = (await pedirToken(id, COMPRADOR)) as { token?: string };
    expect(typeof res.token).toBe("string");
    expect((res.token ?? "").length).toBeGreaterThan(20);
  });

  it("🟢 y también al creador", async () => {
    const id = await sembrarSesion("paid");
    const res = (await pedirToken(id, CREADOR)) as { token?: string };
    expect(typeof res.token).toBe("string");
  });

  it("🟢 el flujo simulado ('simulated_paid') sigue funcionando", async () => {
    const id = await sembrarSesion("simulated_paid");
    const res = (await pedirToken(id, COMPRADOR)) as { token?: string };
    expect(typeof res.token).toBe("string");
  });

  it("🔴 una retención sin capturar ('authorized') no da token", async () => {
    const id = await sembrarSesion("authorized");
    const mensaje = await errorDe(() => pedirToken(id, COMPRADOR));
    expect(mensaje).toContain("pago");
  });

  it("🔴 un tercero no entra aunque la sesión esté pagada", async () => {
    const id = await sembrarSesion("paid");
    const mensaje = await errorDe(() => pedirToken(id, "colado"));
    expect(mensaje).toBeTruthy();
    expect(mensaje).not.toContain("pago");
  });
});
