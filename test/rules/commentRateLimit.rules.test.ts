import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// B8-H03 — el freno para comentar no se puede saltar.
//
// Antes se pedía en una llamada APARTE (`checkRateLimitComment`) y el comentario
// se escribía directo después: dos pasos independientes, así que bastaba con no
// dar el primero.
//
// Una regla no puede exigir que ANTES ocurriera otra cosa, pero sí que ocurra A
// LA VEZ: `canCreateComment` pide que el contador quede escrito en el mismo lote
// atómico (`getAfter`).
//
// ⚠️ Esto REABRE `rateLimits` a escritura del cliente, que se cerró en un bloque
// anterior porque el dueño reiniciaba `lastAt` para saltarse el límite. La
// diferencia es que ahora `lastAt` tiene que valer EXACTAMENTE `request.time`,
// la hora del servidor: no hay forma de mentirla. Esa es la prueba que más
// importa de este archivo.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-vibra-ratelimit",
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

const AUTOR = "uAutorPost";
const QUIEN = "uComentarista";
const GRUPO = "gAbierta";
const POST = "pAbierto";

async function escenario() {
  await seed(`groups/${GRUPO}`, { ownerId: AUTOR, visibility: "public", isActive: true });
  for (const uid of [AUTOR, QUIEN]) {
    await seed(`groups/${GRUPO}/members/${uid}`, {
      userId: uid,
      roleInGroup: uid === AUTOR ? "owner" : "member",
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
    text: "hola",
  });
}

function db() {
  return testEnv.authenticatedContext(QUIEN).firestore();
}

function cuerpoComentario() {
  return {
    authorId: QUIEN,
    text: "un comentario",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    counts: { replies: 0, likes: 0 },
  };
}

/** Lo que hace el cliente: comentario y contador en el mismo lote. */
function comentarConFreno(id: string, contador: Record<string, unknown>) {
  const ctx = db();
  const lote = writeBatch(ctx);
  lote.set(doc(ctx, `posts/${POST}/comments/${id}`), cuerpoComentario());
  lote.set(doc(ctx, `rateLimits/${QUIEN}_comment`), contador);
  return lote.commit();
}

const CONTADOR_NUEVO = {
  lastAt: serverTimestamp(),
  windowStart: serverTimestamp(),
  count: 1,
};

function haceSegundos(s: number) {
  return Timestamp.fromMillis(Date.now() - s * 1000);
}

describe("B8-H03 — comentar exige el contador en el mismo lote", () => {
  beforeEach(escenario);

  it("🟢 comentario y contador juntos, pasa", async () => {
    await assertSucceeds(comentarConFreno("c1", CONTADOR_NUEVO));
  });

  it("🔴 el comentario SOLO, sin contador, ya no pasa", async () => {
    // El ataque exacto: escribir directo contra Firestore saltándose la llamada
    // del freno. Antes funcionaba.
    await assertFails(setDoc(doc(db(), `posts/${POST}/comments/cSolo`), cuerpoComentario()));
  });

  it("🔴 tampoco una respuesta sin contador", async () => {
    await seed(`posts/${POST}/comments/cPadre`, {
      authorId: AUTOR,
      text: "padre",
      isDeleted: false,
    });

    await assertFails(
      setDoc(doc(db(), `posts/${POST}/comments/cPadre/replies/r1`), {
        postId: POST,
        commentId: "cPadre",
        authorId: QUIEN,
        text: "respuesta",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe("B8-H03 — el contador no se puede falsear", () => {
  beforeEach(escenario);

  it("🔴 fechar el contador en el pasado para reiniciarse", async () => {
    // El agujero exacto que hizo cerrar esta colección en su día.
    await assertFails(
      comentarConFreno("cViejo", {
        lastAt: Timestamp.fromDate(new Date("2020-01-01")),
        windowStart: serverTimestamp(),
        count: 1,
      })
    );
  });

  it("🔴 comentar antes de que pasen los 3 segundos", async () => {
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: Timestamp.now(),
      windowStart: Timestamp.now(),
      count: 1,
    });

    await assertFails(
      comentarConFreno("cRapido", {
        lastAt: serverTimestamp(),
        windowStart: Timestamp.now(),
        count: 2,
      })
    );
  });

  it("🔴 no subir la cuenta, para no llegar nunca al tope", async () => {
    const antes = haceSegundos(10);
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: antes,
      windowStart: antes,
      count: 40,
    });

    await assertFails(
      comentarConFreno("cTrampa", { lastAt: serverTimestamp(), windowStart: antes, count: 40 })
    );
  });

  it("🔴 empezar ventana nueva antes de que pase la hora", async () => {
    const antes = haceSegundos(10);
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: antes,
      windowStart: antes,
      count: 60,
    });

    await assertFails(
      comentarConFreno("cReinicio", {
        lastAt: serverTimestamp(),
        windowStart: serverTimestamp(),
        count: 1,
      })
    );
  });

  it("🔴 al llegar a 60 en la misma hora, se acaba", async () => {
    const antes = haceSegundos(10);
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: antes,
      windowStart: antes,
      count: 60,
    });

    await assertFails(
      comentarConFreno("cTope", { lastAt: serverTimestamp(), windowStart: antes, count: 61 })
    );
  });

  it("🟢 con la hora cumplida, empieza ventana nueva", async () => {
    const haceDosHoras = haceSegundos(2 * 60 * 60);
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: haceDosHoras,
      windowStart: haceDosHoras,
      count: 60,
    });

    await assertSucceeds(
      comentarConFreno("cNuevaVentana", {
        lastAt: serverTimestamp(),
        windowStart: serverTimestamp(),
        count: 1,
      })
    );
  });

  it("🟢 dentro de la ventana y por debajo del tope, uno más", async () => {
    const antes = haceSegundos(10);
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: antes,
      windowStart: antes,
      count: 5,
    });

    await assertSucceeds(
      comentarConFreno("cUnoMas", { lastAt: serverTimestamp(), windowStart: antes, count: 6 })
    );
  });

  it("🟢 un contador del formato VIEJO cuenta como ventana nueva", async () => {
    // Los que escribió el callable anterior traen `hourTimestamps` y no
    // `windowStart`. No pueden bloquear a nadie para siempre.
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: haceSegundos(10),
      hourTimestamps: [],
    });

    await assertSucceeds(
      comentarConFreno("cLegado", {
        lastAt: serverTimestamp(),
        windowStart: serverTimestamp(),
        count: 1,
      })
    );
  });

  it("🔴 borrar el contador para reiniciarlo", async () => {
    await seed(`rateLimits/${QUIEN}_comment`, {
      lastAt: Timestamp.now(),
      windowStart: Timestamp.now(),
      count: 60,
    });

    const ctx = db();
    const lote = writeBatch(ctx);
    lote.delete(doc(ctx, `rateLimits/${QUIEN}_comment`));
    await assertFails(lote.commit());
  });

  it("🔴 el contador de PUBLICACIONES sigue cerrado al cliente", async () => {
    // Solo se reabrió el de comentarios. El de publicaciones lo lleva
    // `createPost` dentro de su propia transacción.
    await assertFails(
      setDoc(doc(db(), `rateLimits/${QUIEN}_post`), {
        lastAt: serverTimestamp(),
        windowStart: serverTimestamp(),
        count: 1,
      })
    );
  });

  it("🔴 tocar el contador de OTRA persona", async () => {
    await assertFails(
      setDoc(doc(db(), "rateLimits/otroUsuario_comment"), {
        lastAt: serverTimestamp(),
        windowStart: serverTimestamp(),
        count: 1,
      })
    );
  });
});
