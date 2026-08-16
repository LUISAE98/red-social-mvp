import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";

import { consumeVideoUploadQuota, MAX_VIDEOS_POR_DIA } from "../src/quotas";

// ─────────────────────────────────────────────────────────────────────────────
// B5-C07 — techo diario de subidas de video.
//
// Las funciones que crean subidas en Mux aceptaban cualquier UID autenticado sin
// tope persistente: una granja de cuentas podía generar subidas indefinidamente y
// la factura del proveedor la paga Vibra, sin necesidad de saltarse ninguna regla.
//
// ⚠️ No es lo mismo que el control de ritmo de `rateLimiter.ts`: aquel limita la
// VELOCIDAD y su ventana se vacía sola; este pone un techo al día. Un abuso lento
// y constante pasa por debajo del primero sin despeinarse.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();

function uid(): string {
  return crypto.randomUUID();
}

async function intentar(u: string): Promise<string | null> {
  try {
    await consumeVideoUploadQuota(u);
    return null;
  } catch (error) {
    return (error as { code?: string })?.code ?? "desconocido";
  }
}

describe("consumeVideoUploadQuota", () => {
  it("🟢 deja subir hasta el tope y 🔴 rechaza la siguiente", async () => {
    const u = uid();

    for (let i = 0; i < MAX_VIDEOS_POR_DIA; i++) {
      expect(await intentar(u)).toBeNull();
    }

    expect(await intentar(u)).toBe("resource-exhausted");
  });

  it("🟢 el tope es por persona, no global", async () => {
    const primero = uid();
    const segundo = uid();

    for (let i = 0; i < MAX_VIDEOS_POR_DIA; i++) await consumeVideoUploadQuota(primero);
    expect(await intentar(primero)).toBe("resource-exhausted");

    // El segundo no arrastra el consumo del primero.
    expect(await intentar(segundo)).toBeNull();
  });

  it("🟢 un contador de otro día cuenta como cero", async () => {
    const u = uid();
    // Se simula el documento de ayer, agotado.
    await db.collection("dailyQuotas").doc(`${u}_videoUpload`).set({
      day: "2020-01-01",
      count: MAX_VIDEOS_POR_DIA,
    });

    expect(await intentar(u)).toBeNull();
  });

  it("🔴 varias llamadas a la vez no se cuelan por encima del tope", async () => {
    // Leer y sumar por separado dejaría que dos simultáneas leyeran el mismo
    // número y pasaran las dos. Por eso va en transacción.
    //
    // ⚠️ Se comprueba "NO MÁS de 10", no "exactamente 10". Esa era la garantía
    // real desde el principio: bajo contención Firestore aborta alguna
    // transacción tras sus reintentos, y ese intento se rechaza de forma
    // legítima. Exigir el número exacto hacía la prueba intermitente sin que
    // hubiera nada roto —falló al añadirse una lectura previa que alargó la
    // ventana—. Lo que sí se exige es que el contador guardado coincida con lo
    // aceptado: si se colara una de más, aquí se vería.
    const u = uid();
    const intentos = MAX_VIDEOS_POR_DIA + 5;

    const resultados = await Promise.all(
      Array.from({ length: intentos }, () => intentar(u))
    );

    const aceptados = resultados.filter((r) => r === null).length;
    expect(aceptados).toBeGreaterThan(0);
    expect(aceptados).toBeLessThanOrEqual(MAX_VIDEOS_POR_DIA);

    const guardado = (await db.collection("dailyQuotas").doc(`${u}_videoUpload`).get()).get("count");
    expect(guardado).toBe(aceptados);
  });
});
