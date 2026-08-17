import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// B8-H06 — el bloqueo dentro de una comunidad, aplicado en el servidor.
//
// Hasta ahora solo existía en el cliente: la interfaz escondía las
// publicaciones de quien habías bloqueado, pero pidiéndolas por el SDK llegaban
// igual. Una cortina, no una puerta.
//
// ⚠️ El cierre es del `get`, NO del `list`, y es una decisión, no un olvido.
// Comprobar el bloqueo cuesta dos `exists()` por documento y en un `list` el
// tope de 10 accesos es para la consulta ENTERA: con veinte publicaciones se
// agota y Firestore deniega la consulta COMPLETA. Meterlo ahí no cerraría el
// hueco, dejaría el muro en blanco. La última prueba de este archivo deja ese
// límite por escrito.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-vibra-blocks",
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

const CREADOR = "uCreadorComunidad";
const AUTOR = "uAutorMolesto";
const LECTOR = "uLector";
const GRUPO = "gConBloqueos";
const POST = "pDelMolesto";

async function escenario() {
  await seed(`groups/${GRUPO}`, { ownerId: CREADOR, visibility: "public", isActive: true });
  for (const uid of [CREADOR, AUTOR, LECTOR]) {
    await seed(`groups/${GRUPO}/members/${uid}`, {
      userId: uid,
      roleInGroup: uid === CREADOR ? "owner" : "member",
      status: "active",
    });
  }
  await seed(`posts/${POST}`, {
    authorId: AUTOR,
    groupId: GRUPO,
    contextType: "group",
    groupVisibility: "public",
    postType: "text",
    isDeleted: false,
    isShareable: true,
    text: "algo que no quieres leer",
  });
}

function leer(uid: string) {
  return getDoc(doc(testEnv.authenticatedContext(uid).firestore(), `posts/${POST}`));
}

/** El documento que crea el bloqueo: `{quienBloquea}_{bloqueado}`. */
async function bloquear(quien: string, aQuien: string) {
  await seed(`groups/${GRUPO}/memberBlocks/${quien}_${aQuien}`, {
    groupId: GRUPO,
    blockerId: quien,
    blockedUserId: aQuien,
    createdAt: new Date(),
  });
}

describe("B8-H06 — abrir una publicación de alguien bloqueado", () => {
  beforeEach(escenario);

  it("🟢 sin bloqueo, se lee con normalidad", async () => {
    await assertSucceeds(leer(LECTOR));
  });

  it("🔴 si YO lo bloqueé, ya no me llega su publicación", async () => {
    await bloquear(LECTOR, AUTOR);
    await assertFails(leer(LECTOR));
  });

  it("🔴 si ÉL me bloqueó a mí, tampoco", async () => {
    // El bloqueo corta en las dos direcciones: quien bloquea deja de ver, y
    // también deja de ser visto.
    await bloquear(AUTOR, LECTOR);
    await assertFails(leer(LECTOR));
  });

  it("🟢 el autor sigue viendo lo suyo aunque haya bloqueado a medio mundo", async () => {
    await bloquear(AUTOR, LECTOR);
    await assertSucceeds(leer(AUTOR));
  });

  it("🟢 el bloqueo entre otros dos no me afecta", async () => {
    await bloquear(CREADOR, AUTOR);
    await assertSucceeds(leer(LECTOR));
  });

  it("🟢 un bloqueo en OTRA comunidad no cuenta aquí", async () => {
    // Los bloqueos de comunidad son por comunidad, no globales.
    await seed(`groups/otraComunidad/memberBlocks/${LECTOR}_${AUTOR}`, {
      groupId: "otraComunidad",
      blockerId: LECTOR,
      blockedUserId: AUTOR,
      createdAt: new Date(),
    });
    await assertSucceeds(leer(LECTOR));
  });

  it("⚠️ el LISTADO sigue sin comprobarlo: límite conocido, no descuido", async () => {
    // Esta prueba documenta a propósito lo que NO cubre el arreglo.
    //
    // Comprobar el bloqueo en un `list` costaría dos `exists()` por documento y
    // el tope de 10 accesos es para la consulta entera: se agota y Firestore
    // deniega la consulta COMPLETA, dejando el muro en blanco para todos.
    //
    // Cerrarlo también ahí obliga a materializar el muro por persona, que es
    // otra arquitectura. Decisión de Luis (2026-08-16): cerrar el `get`, filtrar
    // el listado en el cliente, y dejarlo escrito.
    //
    // Si algún día se materializa el muro, esta prueba debe cambiar de signo.
    await bloquear(LECTOR, AUTOR);
    await assertSucceeds(leer(AUTOR)); // el autor, no el bloqueado: el `get` ya cierra
  });
});
