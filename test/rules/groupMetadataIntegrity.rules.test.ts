import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Bloque 7, bajos 13 y 14 — datos que el usuario escribe sobre sí mismo.
//
// bajo 13: el espejo de la membresía (`users/{uid}/groupMemberships/{groupId}`)
//   copia datos de la comunidad y lo escribe el propio usuario. El rol y el
//   estado ya estaban atados al documento real de miembro, pero la visibilidad
//   copiada no, y `OwnerSidebar` la usa para esconder las comunidades ocultas de
//   tu lista.
//
// bajo 14: edad, etiquetas y el índice de búsqueda tenían sus límites de verdad
//   solo en el cliente (`lib/groups/createGroup.ts`, `lib/search/normalize.ts`).
//   El `update` de la comunidad no comprobaba ninguno de los tres.
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

// ═════════════════════════════════════════════════════════════════════════════
// bajo 13 — el espejo no puede mentir sobre la comunidad
// ═════════════════════════════════════════════════════════════════════════════
describe("B7-bajo13 — espejo de la membresía coherente con la comunidad", () => {
  const USUARIO = "u_espejo";
  const CREADOR = "creador_espejo";
  const GRUPO = "g_oculta";

  async function comunidadOcultaConMiembro() {
    await seed(`groups/${GRUPO}`, {
      ownerId: CREADOR,
      visibility: "hidden",
      isActive: true,
      discoverable: false,
    });
    await seed(`groups/${GRUPO}/members/${USUARIO}`, {
      userId: USUARIO,
      roleInGroup: "member",
      status: "active",
    });
  }

  function escribirEspejo(campos: Record<string, unknown>) {
    return setDoc(
      doc(
        testEnv.authenticatedContext(USUARIO).firestore(),
        `users/${USUARIO}/groupMemberships/${GRUPO}`
      ),
      {
        groupId: GRUPO,
        userId: USUARIO,
        roleInGroup: "member",
        status: "active",
        ...campos,
      }
    );
  }

  it("🔴 no puedo decir que una comunidad OCULTA es pública en mi copia", async () => {
    await comunidadOcultaConMiembro();
    await assertFails(escribirEspejo({ visibility: "public", groupVisibility: "public" }));
  });

  it("🔴 tampoco por el nombre largo del campo a solas", async () => {
    await comunidadOcultaConMiembro();
    await assertFails(escribirEspejo({ groupVisibility: "public" }));
  });

  it("🔴 no puedo ponerme como dueño de la comunidad en mi copia", async () => {
    await comunidadOcultaConMiembro();
    await assertFails(escribirEspejo({ ownerId: USUARIO, groupOwnerId: USUARIO }));
  });

  it("🔴 no puedo marcarla como descubrible si no lo es", async () => {
    await comunidadOcultaConMiembro();
    await assertFails(escribirEspejo({ discoverable: true, groupDiscoverable: true }));
  });

  it("🟢 la copia FIEL sí se escribe", async () => {
    await comunidadOcultaConMiembro();
    await assertSucceeds(
      escribirEspejo({
        visibility: "hidden",
        groupVisibility: "hidden",
        ownerId: CREADOR,
        groupOwnerId: CREADOR,
        isActive: true,
        groupIsActive: true,
        discoverable: false,
        groupDiscoverable: false,
      })
    );
  });

  it("🟢 `null` se acepta: es lo que escribe el alta cuando no puede leer la comunidad", async () => {
    await comunidadOcultaConMiembro();
    await assertSucceeds(
      escribirEspejo({
        visibility: null,
        groupVisibility: null,
        ownerId: null,
        groupOwnerId: null,
        isActive: null,
        groupIsActive: null,
        discoverable: null,
        groupDiscoverable: null,
      })
    );
  });

  it("🟢 el espejo sin los campos copiados sigue valiendo", async () => {
    await comunidadOcultaConMiembro();
    await assertSucceeds(escribirEspejo({}));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// bajo 14 — edad, etiquetas y tamaño del índice de búsqueda
// ═════════════════════════════════════════════════════════════════════════════
describe("B7-bajo14 — límites de edad, etiquetas y búsqueda", () => {
  const CREADOR = "creador_meta";

  function baseComunidad(extra: Record<string, unknown> = {}) {
    return {
      name: "Comunidad de prueba",
      ownerId: CREADOR,
      visibility: "public",
      discoverable: true,
      isActive: true,
      ...extra,
    };
  }

  function crear(gid: string, extra: Record<string, unknown> = {}) {
    return setDoc(
      doc(testEnv.authenticatedContext(CREADOR).firestore(), `groups/${gid}`),
      baseComunidad(extra)
    );
  }

  // ── edad ───────────────────────────────────────────────────────────────────
  it("🔴 edad mínima por debajo de 18", async () => {
    await assertFails(crear("g_edad_menor", { ageMin: 13, ageMax: 99 }));
  });

  it("🔴 edad máxima por encima de 99", async () => {
    await assertFails(crear("g_edad_mayor", { ageMin: 18, ageMax: 500 }));
  });

  it("🔴 rango al revés: mínima mayor que la máxima", async () => {
    await assertFails(crear("g_edad_reves", { ageMin: 60, ageMax: 30 }));
  });

  it("🟢 un rango válido pasa", async () => {
    await assertSucceeds(crear("g_edad_ok", { ageMin: 18, ageMax: 99 }));
  });

  it("🟢 sin edad también pasa", async () => {
    await assertSucceeds(crear("g_edad_ausente", {}));
  });

  it("🟢 edad en null también pasa", async () => {
    await assertSucceeds(crear("g_edad_null", { ageMin: null, ageMax: null }));
  });

  // ── etiquetas ──────────────────────────────────────────────────────────────
  it("🔴 más de 10 etiquetas", async () => {
    const once = Array.from({ length: 11 }, (_, i) => `etiqueta${i}`);
    await assertFails(crear("g_tags_muchas", { tags: once }));
  });

  it("🟢 exactamente 10 etiquetas, que es el tope del cliente", async () => {
    const diez = Array.from({ length: 10 }, (_, i) => `etiqueta${i}`);
    await assertSucceeds(crear("g_tags_diez", { tags: diez }));
  });

  // ── índice de búsqueda ─────────────────────────────────────────────────────
  it("🔴 índice de búsqueda inflado con miles de prefijos", async () => {
    const muchos = Array.from({ length: 3000 }, (_, i) => `p${i}`);
    await assertFails(
      crear("g_busqueda_inflada", {
        search: {
          nameNormalized: "comunidad de prueba",
          visibility: "public",
          discoverable: true,
          isActive: true,
          prefixes: muchos,
        },
      })
    );
  });

  it("🔴 más de 40 tokens", async () => {
    const muchos = Array.from({ length: 41 }, (_, i) => `t${i}`);
    await assertFails(
      crear("g_busqueda_tokens", {
        search: {
          nameNormalized: "comunidad de prueba",
          visibility: "public",
          discoverable: true,
          isActive: true,
          tokens: muchos,
        },
      })
    );
  });

  it("🟢 un índice dentro de los topes pasa", async () => {
    await assertSucceeds(
      crear("g_busqueda_ok", {
        search: {
          nameNormalized: "comunidad de prueba",
          visibility: "public",
          discoverable: true,
          isActive: true,
          tokens: ["comunidad", "prueba"],
          prefixes: ["co", "com", "pr", "pru"],
          tagsNormalized: ["musica"],
        },
      })
    );
  });

  // ── el update, que antes no comprobaba NADA de esto ────────────────────────
  describe("el `update` también valida, no solo el `create`", () => {
    const GID = "g_update_meta";

    async function comunidadValida() {
      await seed(`groups/${GID}`, {
        ...baseComunidad({ ageMin: 18, ageMax: 99, tags: ["musica"] }),
        createdAt: new Date(),
      });
    }

    function actualizar(campos: Record<string, unknown>) {
      return updateDoc(
        doc(testEnv.authenticatedContext(CREADOR).firestore(), `groups/${GID}`),
        campos
      );
    }

    it("🔴 no se puede corregir la edad a un valor prohibido después de crear", async () => {
      await comunidadValida();
      await assertFails(actualizar({ ageMin: 8 }));
    });

    it("🔴 no se puede invertir el rango con una actualización", async () => {
      await comunidadValida();
      await assertFails(actualizar({ ageMax: 12 }));
    });

    it("🔴 no se pueden añadir 50 etiquetas después", async () => {
      await comunidadValida();
      const muchas = Array.from({ length: 50 }, (_, i) => `e${i}`);
      await assertFails(actualizar({ tags: muchas }));
    });

    it("🟢 una actualización dentro de los límites sí pasa", async () => {
      await comunidadValida();
      await assertSucceeds(actualizar({ ageMin: 21, ageMax: 65 }));
    });
  });
});
