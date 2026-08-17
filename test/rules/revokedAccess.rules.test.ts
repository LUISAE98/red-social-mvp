import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// El acceso revocado tiene que dejar de dar acceso.
//
// B6-C03 cerró el contracargo: quien reclama el cargo a su banco pierde el post
// de pago y la entrada al directo. Pero la revocación MARCA el documento
// (`revoked: true`) en vez de borrarlo —hace falta para investigar la disputa— y
// las reglas comprobaban solo `exists()`. O sea que se anunció cerrado y no lo
// estaba: te devolvían el dinero y te quedabas el contenido.
//
// Mismo patrón que mordió en el bloque 7 con los miembros sancionados: los
// documentos se marcan, no se borran.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-vibra-revoked",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8085,
    },
  });
}, 60_000);

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const CREADOR = "uCreadorPago";
const COMPRADOR = "uComprador";
const GRUPO = "gDePago";
const POST = "pPremium";

async function postPremium() {
  await seed(`groups/${GRUPO}`, { ownerId: CREADOR, visibility: "public", isActive: true });
  await seed(`groups/${GRUPO}/members/${CREADOR}`, {
    userId: CREADOR, roleInGroup: "owner", status: "active",
  });
  await seed(`groups/${GRUPO}/members/${COMPRADOR}`, {
    userId: COMPRADOR, roleInGroup: "member", status: "active",
  });
  await seed(`posts/${POST}`, {
    authorId: CREADOR,
    groupId: GRUPO,
    contextType: "group",
    groupVisibility: "public",
    postType: "text",
    isDeleted: false,
    text: "contenido de pago",
    premium: { enabled: true, price: 100 },
    requiresPayment: true,
    accessModel: "paid",
  });
}

// ⚠️ B8-H03: comentar exige ahora que el contador del freno viaje en el MISMO
// lote atómico. Sin él la regla deniega, y este test dejaría de medir lo que
// quiere medir (el acceso revocado) para medir el freno.
function comentar() {
  const ctx = testEnv.authenticatedContext(COMPRADOR).firestore();
  const lote = writeBatch(ctx);
  lote.set(doc(ctx, `rateLimits/${COMPRADOR}_comment`), {
    lastAt: serverTimestamp(),
    windowStart: serverTimestamp(),
    count: 1,
  });
  lote.set(
    doc(ctx, `posts/${POST}/comments/c1`),
    {
      authorId: COMPRADOR,
      text: "ya lo vi",
      // El esquema cerrado de comentarios (B8) ancla las fechas a
      // `request.time`, que es en lo que se resuelve `serverTimestamp()`.
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      counts: { replies: 0, likes: 0 },
    }
  );
  return lote.commit();
}

describe("acceso comprado y luego revocado", () => {
  it("🟢 con el acceso vigente puede comentar el post de pago", async () => {
    await postPremium();
    await seed(`postAccess/${COMPRADOR}_${POST}`, { status: "active" });
    await assertSucceeds(comentar());
  });

  it("🔴 tras el contracargo, ya no", async () => {
    await postPremium();
    await seed(`postAccess/${COMPRADOR}_${POST}`, {
      status: "revoked",
      revoked: true,
      revokedReason: "chargeback",
    });
    await assertFails(comentar());
  });

  it("🟢 un documento antiguo sin el campo sigue dando acceso", async () => {
    // El default es `false` a propósito: no romper compras anteriores al campo.
    await postPremium();
    await seed(`postAccess/${COMPRADOR}_${POST}`, { status: "active" });
    await assertSucceeds(comentar());
  });

  it("🔴 sin ningún acceso, tampoco", async () => {
    await postPremium();
    await assertFails(comentar());
  });

  it("🔴 el ticket de directo revocado tampoco sirve", async () => {
    await postPremium();
    await seed(`liveAccess/${POST}/users/${COMPRADOR}`, {
      status: "revoked",
      revoked: true,
    });
    await assertFails(comentar());
  });

  it("🟢 el ticket de directo vigente sí", async () => {
    await postPremium();
    await seed(`liveAccess/${POST}/users/${COMPRADOR}`, { status: "paid" });
    await assertSucceeds(comentar());
  });
});
