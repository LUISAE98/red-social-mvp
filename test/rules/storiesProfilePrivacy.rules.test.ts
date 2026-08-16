import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, serverTimestamp, Timestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// B8-C03 — las historias de un perfil CERRADO eran públicas.
//
// La regla consideraba legible por cualquiera toda historia sin comunidad, sin
// mirar `profileRestricted`, `showPosts` ni los bloqueos. Las publicaciones sí
// lo miraban desde hace bloques (`canReadProfileContent`); las historias se
// quedaron fuera.
//
// ⚠️ El orden importa y estas pruebas lo cubren: `searchable == true` sigue
// delante, porque es lo que hace que el feed de reels no gaste ni un `get()`.
// Por eso el arreglo tiene DOS mitades: esta regla, y que `searchable` deje de
// mentir (cliente + disparador `onStoryCreatedEnforceSearchable`).
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

const CERRADO = "uPerfilCerrado";
const ABIERTO = "uPerfilAbierto";
const CURIOSO = "uCurioso";

/** Una historia de perfil, con `searchable` honesto (lo que ahora escribe el cliente). */
async function historiaDePerfil(id: string, creatorId: string, searchable: boolean) {
  await seed(`stories/${id}`, {
    creatorId,
    creatorName: "Alguien",
    type: "saludo",
    source: "profile",
    groupId: null,
    greetingRequestId: "req1",
    searchable,
    byCreator: true,
    hiddenFromReel: false,
    viewsCount: 0,
    muxPlaybackId: "pb123",
    createdAt: new Date(),
  });
}

function leer(uid: string | null, storyId: string) {
  const ctx = uid
    ? testEnv.authenticatedContext(uid).firestore()
    : testEnv.unauthenticatedContext().firestore();

  return getDoc(doc(ctx, `stories/${storyId}`));
}

describe("B8-C03 — historias de un perfil cerrado", () => {
  beforeEach(async () => {
    await seed(`users/${CERRADO}`, { profileRestricted: true, showPosts: true });
    await seed(`users/${ABIERTO}`, { profileRestricted: false, showPosts: true });
    await seed(`users/${CURIOSO}`, { profileRestricted: false, showPosts: true });
  });

  it("🔴 un desconocido no puede leer la historia de un perfil cerrado", async () => {
    await historiaDePerfil("sCerrada", CERRADO, false);
    await assertFails(leer(CURIOSO, "sCerrada"));
  });

  it("🔴 sin sesión tampoco", async () => {
    await historiaDePerfil("sCerrada2", CERRADO, false);
    await assertFails(leer(null, "sCerrada2"));
  });

  it("🟢 su propio dueño sí la lee", async () => {
    await historiaDePerfil("sPropia", CERRADO, false);
    await assertSucceeds(leer(CERRADO, "sPropia"));
  });

  it("🟢 la historia de un perfil abierto sigue siendo pública", async () => {
    await historiaDePerfil("sAbierta", ABIERTO, true);
    await assertSucceeds(leer(CURIOSO, "sAbierta"));
    await assertSucceeds(leer(null, "sAbierta"));
  });

  it("🔴 un perfil que esconde sus publicaciones también esconde sus historias", async () => {
    await seed(`users/${ABIERTO}`, { profileRestricted: false, showPosts: false });
    await historiaDePerfil("sSinPosts", ABIERTO, false);
    await assertFails(leer(CURIOSO, "sSinPosts"));
  });

  it("🔴 si hay un bloqueo entre los dos, tampoco", async () => {
    await historiaDePerfil("sBloqueada", ABIERTO, false);
    await seed(`users/${ABIERTO}/blockedUsers/${CURIOSO}`, { blockedAt: new Date() });
    await assertFails(leer(CURIOSO, "sBloqueada"));
  });

  it("⚠️ con `searchable: true` sigue siendo legible: por eso el campo NO puede mentir", async () => {
    // Esta prueba documenta el límite de la regla a propósito. `searchable`
    // manda, porque quitarlo de delante costaría un `get()` por documento y
    // tumbaría el feed de reels al agotar el tope de 10. Que sea honesto lo
    // garantizan el cliente y `onStoryCreatedEnforceSearchable`, no esta regla.
    await historiaDePerfil("sMentirosa", CERRADO, true);
    await assertSucceeds(leer(CURIOSO, "sMentirosa"));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// B8-H05 — forma y tamaño de lo que se guarda al crear una historia.
//
// `hasOnly` fijaba QUÉ claves podían venir, pero no lo que traían dentro. La
// fecha, el contador de vistas, los prefijos de búsqueda y las categorías no se
// comprobaban en absoluto.
// ═════════════════════════════════════════════════════════════════════════════
describe("B8-H05 — límites al crear una historia", () => {
  const AUTOR = "uAutorHistoria";

  function historia(extra: Record<string, unknown> = {}) {
    return {
      creatorId: AUTOR,
      creatorName: "Alguien",
      type: "saludo",
      source: "profile",
      greetingRequestId: "req_1",
      muxPlaybackId: "pb123",
      thumbnailUrl: "https://image.mux.com/pb123/thumbnail.jpg?time=0",
      videoDuration: 10,
      searchable: true,
      searchPrefixes: ["al", "alg"],
      categories: ["musica"],
      byCreator: true,
      hiddenFromReel: false,
      viewsCount: 0,
      createdAt: serverTimestamp(),
      ...extra,
    };
  }

  function crear(id: string, extra: Record<string, unknown> = {}) {
    return setDoc(
      doc(testEnv.authenticatedContext(AUTOR).firestore(), `stories/${id}`),
      historia(extra)
    );
  }

  beforeEach(async () => {
    await seed(`users/${AUTOR}`, { profileRestricted: false, showPosts: true });
  });

  it("🟢 una historia normal se crea", async () => {
    await assertSucceeds(crear("sNormal"));
  });

  it("🔴 fechada en el futuro para quedarse clavada arriba del reel", async () => {
    await assertFails(
      crear("sFutura", { createdAt: Timestamp.fromDate(new Date("2099-01-01")) })
    );
  });

  it("🔴 fechada en el pasado", async () => {
    await assertFails(
      crear("sPasada", { createdAt: Timestamp.fromDate(new Date("2020-01-01")) })
    );
  });

  it("🔴 estrenando con el contador de vistas inflado", async () => {
    await assertFails(crear("sInflada", { viewsCount: 99999 }));
  });

  it("🔴 con miles de prefijos para salir en toda búsqueda", async () => {
    const muchos = Array.from({ length: 500 }, (_, i) => `p${i}`);
    await assertFails(crear("sPrefijos", { searchPrefixes: muchos }));
  });

  it("🔴 con más categorías que las que existen, para salir en toda recomendación", async () => {
    const muchas = Array.from({ length: 50 }, (_, i) => `cat${i}`);
    await assertFails(crear("sCategorias", { categories: muchas }));
  });

  it("🔴 con una portada apuntando fuera de Mux (baliza de IP)", async () => {
    await assertFails(
      crear("sBaliza", { thumbnailUrl: "https://rastreador.example.com/pixel.gif" })
    );
  });

  it("🟢 la portada real de Mux sí pasa", async () => {
    await assertSucceeds(
      crear("sMux", {
        thumbnailUrl: "https://image.mux.com/AbC123/thumbnail.jpg?time=0",
      })
    );
  });

  it("🔴 una duración imposible", async () => {
    await assertFails(crear("sEterna", { videoDuration: 999_999 }));
  });
});
