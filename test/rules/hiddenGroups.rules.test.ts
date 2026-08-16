import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Privacidad de COMUNIDADES OCULTAS.
//
// El doc del post de una comunidad oculta ya estaba cerrado, pero varias
// subcolecciones "abiertas" del post no miraban la visibilidad del grupo y
// filtraban su contenido a cualquiera que conociera el postId:
//
//   - comments / replies : la rama "live compartible" y la "premium público"
//                          no comprobaban `groupVisibility`.
//   - reactions          : ídem (además revela QUIÉN está dentro).
//   - superComments      : `allow list, get: if true`.
//   - liveViewers        : `allow get, list: if signedIn()`.
//   - liveChats/messages : `allow get, list: if true`.
//
// El postId se filtra sin esfuerzo (p. ej. `users/{uid}.activeLivePostId`, que
// es legible por cualquiera), así que no era una barrera real.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // projectId propio: `clearFirestore()` borra TODO el proyecto, y vitest corre
    // los archivos de test en paralelo — compartir projectId con otra suite le
    // vacía los datos a media prueba.
    projectId: "demo-vibra-hidden",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8085,
    },
  });
  // Cargar un segundo projectId en el emulador mientras la otra suite corre en
  // paralelo tarda más que el hookTimeout por defecto (20 s).
}, 60_000);
afterAll(async () => {
  await testEnv.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Siembra un doc saltándose las reglas (simula lo que escribe el backend). */
async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const OWNER = "owner";
const MEMBER = "member";
const OUTSIDER = "outsider";

/**
 * Live dentro de una comunidad, con `isShareable: true` — el peor caso: el autor
 * puede poner esa bandera desde el cliente (`canEditLivePost` la deja cambiar),
 * así que la protección no puede depender de ella.
 */
async function seedLive(groupVisibility: "hidden" | "public", postId: string, groupId: string) {
  await seed(`groups/${groupId}`, {
    ownerId: OWNER,
    visibility: groupVisibility,
    isActive: true,
  });
  await seed(`groups/${groupId}/members/${OWNER}`, {
    userId: OWNER,
    roleInGroup: "owner",
    status: "active",
  });
  await seed(`groups/${groupId}/members/${MEMBER}`, {
    userId: MEMBER,
    roleInGroup: "member",
    status: "active",
  });
  await seed(`posts/${postId}`, {
    authorId: OWNER,
    contextType: "group",
    groupId,
    groupVisibility,
    postType: "live",
    isShareable: true,
    isDeleted: false,
    text: "en vivo",
  });
  await seed(`posts/${postId}/comments/c1`, { authorId: MEMBER, text: "hola", isDeleted: false });
  await seed(`posts/${postId}/reactions/${MEMBER}`, { userId: MEMBER, type: "like" });
  await seed(`posts/${postId}/superComments/s1`, { userId: MEMBER, text: "!", status: "paid" });
  await seed(`posts/${postId}/liveViewers/${MEMBER}`, { uid: MEMBER });
  await seed(`posts/${postId}/liveUniqueViewers/${MEMBER}`, { uid: MEMBER });
  await seed(`liveChats/${postId}/messages/m1`, {
    userId: MEMBER,
    liveId: postId,
    text: "hola",
    isDeleted: false,
  });
}

describe("comunidad OCULTA — subcolecciones del live no se filtran", () => {
  const gid = "gOculta";
  const postId = "pOculto";

  beforeEach(async () => {
    await seedLive("hidden", postId, gid);
  });

  it("🔴 un ajeno NO puede leer los comentarios", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDocs(collection(db, `posts/${postId}/comments`)));
  });

  it("🔴 un DESLOGUEADO NO puede leer los comentarios", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, `posts/${postId}/comments`)));
  });

  it("🔴 un ajeno NO puede listar las reacciones (revelan quién está dentro)", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDocs(collection(db, `posts/${postId}/reactions`)));
  });

  it("🔴 un ajeno NO puede leer los supercomentarios", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDocs(collection(db, `posts/${postId}/superComments`)));
  });

  it("🔴 un ajeno NO puede listar los espectadores", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDocs(collection(db, `posts/${postId}/liveViewers`)));
    await assertFails(getDocs(collection(db, `posts/${postId}/liveUniqueViewers`)));
  });

  it("🔴 un ajeno NO puede leer el chat del live", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDocs(collection(db, `liveChats/${postId}/messages`)));
  });

  it("🔴 un DESLOGUEADO NO puede leer el chat del live", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, `liveChats/${postId}/messages`)));
  });

  it("✅ un MIEMBRO sí puede leer todo lo anterior (sin regresión)", async () => {
    const db = testEnv.authenticatedContext(MEMBER).firestore();
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/comments`)));
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/reactions`)));
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/superComments`)));
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/liveViewers`)));
    await assertSucceeds(getDocs(collection(db, `liveChats/${postId}/messages`)));
  });
});

describe("comunidad PÚBLICA — el live abierto sigue funcionando", () => {
  const gid = "gPublica";
  const postId = "pPublico";

  beforeEach(async () => {
    await seedLive("public", postId, gid);
  });

  it("✅ un DESLOGUEADO puede leer comentarios, supercomentarios y chat", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/comments`)));
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/superComments`)));
    await assertSucceeds(getDocs(collection(db, `liveChats/${postId}/messages`)));
  });

  it("✅ un ajeno logueado puede listar reacciones y espectadores", async () => {
    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/reactions`)));
    await assertSucceeds(getDocs(collection(db, `posts/${postId}/liveViewers`)));
  });
});

describe("comunidad OCULTA — copia denormalizada desactualizada", () => {
  // Si el grupo pasó a oculto y un post legado se quedó con
  // `groupVisibility: "public"`, el doc del grupo (fuente de verdad) debe
  // bastar para cerrar el acceso.
  it("🔴 el post miente ('public') pero el grupo es oculto → sigue cerrado", async () => {
    const gid = "gDesfasada";
    const postId = "pDesfasado";
    await seed(`groups/${gid}`, { ownerId: OWNER, visibility: "hidden", isActive: true });
    await seed(`posts/${postId}`, {
      authorId: OWNER,
      contextType: "group",
      groupId: gid,
      groupVisibility: "public", // copia rancia
      postType: "live",
      isShareable: true,
      isDeleted: false,
      text: "en vivo",
    });
    await seed(`posts/${postId}/comments/c1`, { authorId: OWNER, text: "hola", isDeleted: false });

    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(getDocs(collection(db, `posts/${postId}/comments`)));
  });
});

describe("liveOverlays — solo el autor del live alimenta su overlay", () => {
  it("🔴 un ajeno NO puede inyectar un supercomentario en el overlay de otro", async () => {
    const postId = "pOverlay";
    await seed(`posts/${postId}`, {
      authorId: OWNER,
      contextType: "profile",
      profileId: OWNER,
      postType: "live",
      isDeleted: false,
      text: "en vivo",
    });

    const db = testEnv.authenticatedContext(OUTSIDER).firestore();
    await assertFails(
      setDoc(doc(db, `liveOverlays/${postId}`), { activeSuper: { text: "spam" } })
    );
  });

  it("✅ el autor sí puede escribirlo, y OBS (sin sesión) puede leerlo", async () => {
    const postId = "pOverlay2";
    await seed(`posts/${postId}`, {
      authorId: OWNER,
      contextType: "profile",
      profileId: OWNER,
      postType: "live",
      isDeleted: false,
      text: "en vivo",
    });

    const authorDb = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(authorDb, `liveOverlays/${postId}`), { activeSuper: { text: "hola" } })
    );

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anonDb, `liveOverlays/${postId}`)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Historias — no se cuelan en el carrusel de una comunidad ajena.
//
// La creación exigía autor, tipo y un `greetingRequestId` no vacío, pero NO
// comprobaba el `groupId`. Como la lectura y los carruseles se resuelven por ese
// campo, cualquiera podía crear una historia con el id de una comunidad a la que
// no pertenece y aparecer dentro. Mismo patrón que B4-C03 con las publicaciones.
// ─────────────────────────────────────────────────────────────────────────────
describe("stories create — el groupId tiene que ser de una comunidad propia", () => {
  const AJENA = "g_stories_ajena";
  const EXTRANO = "extrano_stories";

  /**
   * ⚠️ `searchable`, `byCreator` y `hiddenFromReel` son OBLIGATORIOS al crear, y
   * `searchable` además tiene que COINCIDIR con la visibilidad real: la regla lo
   * ata a `storyHasNoGroup || isGroupPublic(groupId)`, porque la lectura se apoya
   * en ese campo y mentir abriría la historia al mundo.
   *
   * Por eso aquí va `true`: los dos casos que deben pasar son una comunidad
   * pública y una historia de perfil. Este fixture se quedó viejo cuando la regla
   * se endureció, y fallaba por eso, no por lo que se está probando.
   */
  function historia(extra: Record<string, unknown> = {}) {
    return {
      creatorId: EXTRANO,
      type: "saludo",
      greetingRequestId: "req_1",
      source: "group",
      searchable: true,
      byCreator: true,
      hiddenFromReel: false,
      ...extra,
    };
  }

  it("🔴 un no-miembro NO puede publicar una historia en una comunidad ajena", async () => {
    await seed(`groups/${AJENA}`, { ownerId: "otro", visibility: "public", isActive: true });

    const db = testEnv.authenticatedContext(EXTRANO).firestore();
    await assertFails(
      setDoc(doc(db, "stories/s_colada"), historia({ groupId: AJENA }))
    );
  });

  it("🟢 un miembro SÍ puede", async () => {
    await seed(`groups/${AJENA}`, { ownerId: "otro", visibility: "public", isActive: true });
    await seed(`groups/${AJENA}/members/${EXTRANO}`, {
      userId: EXTRANO,
      roleInGroup: "member",
      status: "active",
    });

    const db = testEnv.authenticatedContext(EXTRANO).firestore();
    await assertSucceeds(
      setDoc(doc(db, "stories/s_legitima"), historia({ groupId: AJENA }))
    );
  });

  it("🟢 una historia de PERFIL, sin comunidad, sigue pasando", async () => {
    const db = testEnv.authenticatedContext(EXTRANO).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "stories/s_perfil"),
        historia({ source: "profile", groupId: null })
      )
    );
  });
});
