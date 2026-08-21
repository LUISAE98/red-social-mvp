import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Editar y borrar comentarios, por combinación.
//
// Reporte de Luis (2026-08-21): dejó de poder borrar y editar sus propios
// comentarios. Este archivo fija las combinaciones que el producto promete, para
// que la próxima vez que se rompan lo diga una prueba y no un usuario:
//
//   · el AUTOR del comentario edita y borra el suyo, en perfil y en comunidad
//   · el AUTOR DEL POST borra comentarios ajenos en su publicación
//   · el DUEÑO de la comunidad borra comentarios ajenos aunque el post no sea suyo
//   · un TERCERO no puede ni editar ni borrar lo que no es suyo
//
// El borrado del producto es SUAVE: marca `isDeleted`, no destruye el documento.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-vibra-commentedit",
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

const DUENO = "uDuenoComunidad";
const AUTOR_POST = "uAutorPost";
const COMENTARISTA = "uComentarista";
const TERCERO = "uTercero";

const GRUPO = "gAbierta";
const POST_GRUPO = "pDeGrupo";
const POST_PERFIL = "pDePerfil";

function db(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

async function escenario() {
  await seed(`groups/${GRUPO}`, { ownerId: DUENO, visibility: "public", isActive: true });
  for (const uid of [DUENO, AUTOR_POST, COMENTARISTA, TERCERO]) {
    await seed(`groups/${GRUPO}/members/${uid}`, {
      userId: uid,
      roleInGroup: uid === DUENO ? "owner" : "member",
      status: "active",
    });
  }

  // Publicación DENTRO de la comunidad, de alguien que no es el dueño.
  await seed(`posts/${POST_GRUPO}`, {
    authorId: AUTOR_POST,
    groupId: GRUPO,
    contextType: "group",
    groupVisibility: "public",
    postType: "text",
    isDeleted: false,
    text: "post de comunidad",
    counts: { comments: 1, likes: 0, saves: 0 },
  });

  // Publicación de PERFIL, sin comunidad detrás. Es el caso que Luis probó.
  await seed(`posts/${POST_PERFIL}`, {
    authorId: AUTOR_POST,
    profileId: AUTOR_POST,
    contextType: "profile",
    postType: "text",
    visibility: "public",
    isDeleted: false,
    text: "post de perfil",
    counts: { comments: 1, likes: 0, saves: 0 },
  });

  for (const postId of [POST_GRUPO, POST_PERFIL]) {
    await seed(`posts/${postId}/comments/cPropio`, {
      authorId: COMENTARISTA,
      authorName: "Comentarista",
      authorAvatarUrl: null,
      authorUsername: "comentarista",
      text: "mi comentario",
      counts: { replies: 0, likes: 0 },
    });
  }
}

/** Lo que escribe `updatePostComment`. */
function editar(uid: string, postId: string) {
  return updateDoc(doc(db(uid), `posts/${postId}/comments/cPropio`), {
    text: "mi comentario, corregido",
    mentions: [],
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** El historial que `updatePostComment` escribe ANTES de editar. */
function historial(uid: string, postId: string) {
  return setDoc(doc(db(uid), `posts/${postId}/comments/cPropio/editHistory/h1`), {
    editedAt: serverTimestamp(),
    editedBy: uid,
    previousText: "mi comentario",
  });
}

/** Lo que escribe `deletePostComment`: borrado suave. */
function borrar(uid: string, postId: string) {
  return updateDoc(doc(db(uid), `posts/${postId}/comments/cPropio`), {
    isDeleted: true,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** El segundo write de `deletePostComment`: bajar el contador del post. */
function bajarContador(uid: string, postId: string) {
  return updateDoc(doc(db(uid), `posts/${postId}`), {
    counts: { comments: 0, likes: 0, saves: 0 },
    updatedAt: serverTimestamp(),
  });
}

describe("editar el propio comentario", () => {
  beforeEach(escenario);

  it("🟢 el autor edita el suyo en un post de PERFIL", async () => {
    await assertSucceeds(editar(COMENTARISTA, POST_PERFIL));
  });

  it("🟢 el autor edita el suyo en un post de COMUNIDAD", async () => {
    await assertSucceeds(editar(COMENTARISTA, POST_GRUPO));
  });

  it("🟢 el historial de edición se deja escribir, en perfil", async () => {
    await assertSucceeds(historial(COMENTARISTA, POST_PERFIL));
  });

  it("🟢 el historial de edición se deja escribir, en comunidad", async () => {
    await assertSucceeds(historial(COMENTARISTA, POST_GRUPO));
  });

  it("🔴 un tercero NO edita lo ajeno", async () => {
    await assertFails(editar(TERCERO, POST_PERFIL));
  });

  it("🔴 ni el dueño de la comunidad edita lo ajeno", async () => {
    await assertFails(editar(DUENO, POST_GRUPO));
  });
});

describe("borrar comentarios", () => {
  beforeEach(escenario);

  it("🟢 el autor borra el suyo en un post de PERFIL", async () => {
    await assertSucceeds(borrar(COMENTARISTA, POST_PERFIL));
  });

  it("🟢 el autor borra el suyo en un post de COMUNIDAD", async () => {
    await assertSucceeds(borrar(COMENTARISTA, POST_GRUPO));
  });

  it("🟢 el autor del post borra un comentario ajeno en su publicación", async () => {
    await assertSucceeds(borrar(AUTOR_POST, POST_PERFIL));
  });

  it("🟢 el dueño de la comunidad borra un comentario ajeno en un post que no es suyo", async () => {
    await assertSucceeds(borrar(DUENO, POST_GRUPO));
  });

  it("🔴 un tercero NO borra lo ajeno", async () => {
    await assertFails(borrar(TERCERO, POST_PERFIL));
  });
});

describe("el contador del post NO lo toca el cliente", () => {
  beforeEach(escenario);

  // Esta denegación es CORRECTA y hay que dejarla escrita: `canUpdateCommentCount`
  // se quitó de las reglas a propósito, porque permitía a cualquiera con sesión
  // subir o bajar el contador de cualquier post sin escribir un comentario. Quien
  // cuenta ahora es el servidor (`commentCounters.ts`).
  //
  // Lo que estaba mal era el CLIENTE, que seguía intentándolo después de marcar el
  // comentario. Estas pruebas fijan el límite para que nadie lo reponga.
  it("🔴 el autor del comentario no puede bajarlo, en perfil", async () => {
    await assertFails(bajarContador(COMENTARISTA, POST_PERFIL));
  });

  it("🔴 tampoco en comunidad", async () => {
    await assertFails(bajarContador(COMENTARISTA, POST_GRUPO));
  });

  it("🔴 ni el autor del post, que es de quien es el contador", async () => {
    await assertFails(bajarContador(AUTOR_POST, POST_PERFIL));
  });
});

describe("el borrado ya no arrastra a la edición", () => {
  beforeEach(escenario);

  // Esta es la cadena que reportó Luis, en orden.
  //
  // `deletePostComment` hace DOS escrituras seguidas, no atómicas: primero marca
  // el comentario, después baja el contador del post. La segunda está denegada
  // desde que el contador pasó a llevarlo el servidor, pero la PRIMERA ya
  // aterrizó. Resultado: el comentario queda marcado como borrado en la base sin
  // que la interfaz lo sepa —se quedó en el `catch`—, y a partir de ahí tampoco
  // se puede editar, porque editar exige que no esté borrado.
  //
  // Por eso el mismo comentario falla de las dos formas: no son dos averías.
  it("🔴 tras el borrado suave, el propio autor ya no puede editarlo", async () => {
    await assertSucceeds(borrar(COMENTARISTA, POST_PERFIL));
    await assertFails(editar(COMENTARISTA, POST_PERFIL));
  });
});

describe("responder a un comentario", () => {
  beforeEach(escenario);

  // `createPostCommentReply` mete en la MISMA transacción la respuesta, el freno
  // anti-spam y los dos contadores. Si los contadores están denegados, no se cae
  // solo el contador: se cae la transacción entera y la respuesta no se escribe.
  it("🔴 la respuesta junto con los contadores NO pasa", async () => {
    const ctx = db(COMENTARISTA);
    await assertFails(
      (async () => {
        const { runTransaction } = await import("firebase/firestore");
        await runTransaction(ctx, async (tx) => {
          await tx.get(doc(ctx, `posts/${POST_GRUPO}`));
          await tx.get(doc(ctx, `posts/${POST_GRUPO}/comments/cPropio`));
          tx.set(doc(ctx, `rateLimits/${COMENTARISTA}_comment`), {
            lastAt: serverTimestamp(),
            windowStart: serverTimestamp(),
            count: 1,
          });
          tx.set(doc(ctx, `posts/${POST_GRUPO}/comments/cPropio/replies/r1`), {
            postId: POST_GRUPO,
            commentId: "cPropio",
            authorId: COMENTARISTA,
            authorName: "Comentarista",
            authorAvatarUrl: null,
            authorUsername: "comentarista",
            text: "una respuesta",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          tx.update(doc(ctx, `posts/${POST_GRUPO}/comments/cPropio`), {
            counts: { replies: 1, likes: 0 },
            updatedAt: serverTimestamp(),
          });
          tx.update(doc(ctx, `posts/${POST_GRUPO}`), {
            counts: { comments: 2, likes: 0, saves: 0 },
            updatedAt: serverTimestamp(),
          });
        });
      })()
    );
  });

  // La misma respuesta, con el freno pero SIN los contadores, sí pasa. Es la
  // prueba de que lo que sobra son las dos escrituras de contador.
  it("🟢 la respuesta con el freno y sin contadores sí pasa", async () => {
    const ctx = db(COMENTARISTA);
    await assertSucceeds(
      (async () => {
        const { writeBatch } = await import("firebase/firestore");
        const lote = writeBatch(ctx);
        lote.set(doc(ctx, `posts/${POST_GRUPO}/comments/cPropio/replies/r2`), {
          postId: POST_GRUPO,
          commentId: "cPropio",
          authorId: COMENTARISTA,
          authorName: "Comentarista",
          authorAvatarUrl: null,
          authorUsername: "comentarista",
          text: "una respuesta",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        lote.set(doc(ctx, `rateLimits/${COMENTARISTA}_comment`), {
          lastAt: serverTimestamp(),
          windowStart: serverTimestamp(),
          count: 1,
        });
        await lote.commit();
      })()
    );
  });
});
