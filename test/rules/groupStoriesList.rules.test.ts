import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, collection, query, where, getDocs } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// `subscribeToGroupStories` consulta `stories` fijando SOLO `groupId == X`.
//
// La regla de lectura tiene tres ramas y la barata (`searchable == true`) NO
// sirve aquí: `searchable` no va fijado en la consulta, así que en un `list` se
// comporta como AUSENTE y esa rama da false para TODA historia, incluso las de
// una comunidad pública. Todas caen a `canReadGroupContent(groupId)`, que
// consulta otras colecciones — y en un `list` esas llamadas comparten un tope
// para la consulta ENTERA.
//
// Estas pruebas fijan el comportamiento con VARIAS historias, que es donde el
// tope se nota. Con una sola nunca se reproduce.
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
}, 60_000);

afterAll(async () => { await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const OWNER = "owner";
const MEMBER = "member";
const OUTSIDER = "outsider";
const GID = "g1";

/** Comunidad + historias. `n` historias para exponer el tope de llamadas. */
async function seedGroupWithStories(visibility: "public" | "private", n: number) {
  await seed(`groups/${GID}`, { ownerId: OWNER, visibility, isActive: true });
  for (const uid of [OWNER, MEMBER]) {
    await seed(`groups/${GID}/members/${uid}`, {
      userId: uid,
      roleInGroup: uid === OWNER ? "owner" : "member",
      status: "active",
    });
  }
  for (let i = 0; i < n; i++) {
    await seed(`stories/s${i}`, {
      creatorId: OWNER,
      groupId: GID,
      type: "saludo",
      greetingRequestId: `gr${i}`,
      searchable: visibility === "public",
      byCreator: true,
      hiddenFromReel: false,
    });
  }
}

function listarHistorias(db: ReturnType<RulesTestEnvironment["authenticatedContext"]>["firestore"] extends () => infer T ? T : never) {
  return getDocs(query(collection(db as never, "stories"), where("groupId", "==", GID)));
}

describe("stories: la consulta por comunidad", () => {
  it("un miembro ve las historias de una comunidad PRIVADA con muchas historias", async () => {
    await seedGroupWithStories("private", 15);
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(listarHistorias(db));
  });

  it("cualquiera ve las de una comunidad PÚBLICA con muchas historias", async () => {
    await seedGroupWithStories("public", 15);
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertSucceeds(listarHistorias(db));
  });

  it("un extraño NO ve las de una comunidad privada", async () => {
    await seedGroupWithStories("private", 3);
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(listarHistorias(db));
  });
});
