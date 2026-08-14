import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// CONTENCIÓN DE CUENTAS ANÓNIMAS + ACAPARAMIENTO DE HANDLES — Bloque 2 (C01, C02).
//
// Las cuentas anónimas existen para UNA cosa: comprar sin login. `signedIn()` es
// `request.auth != null`, así que también las cumplían, y con acceso directo al
// SDK un invitado podía fabricarse un perfil, crear comunidades, publicar,
// comentar y reservar nombres de usuario sin límite ni forma de liberarlos.
//
// Lo que se verifica aquí:
//   - un anónimo NO participa socialmente (perfil, handle, comunidad, post,
//     comentario, seguir, bloquear, historia, chat de live, reporte, sesión),
//   - una cuenta real SÍ puede hacer esas mismas cosas (que el gate no se pasó
//     de frenada),
//   - un uid no puede acumular handles: cada uno queda atado al `handle` que
//     declara su propio perfil, en la misma transacción.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // projectId propio: `clearFirestore()` vacía TODO el proyecto y vitest corre
    // los archivos en paralelo — compartirlo le borraría los datos a otra suite.
    projectId: "demo-vibra-anon",
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

const GUEST = "guest_uid";
const REAL = "real_uid";

/** Contexto de invitado: el token lleva sign_in_provider = "anonymous". */
function guestDb() {
  return testEnv
    .authenticatedContext(GUEST, { firebase: { sign_in_provider: "anonymous" } })
    .firestore();
}

/** Contexto de cuenta real (email/contraseña). */
function realDb() {
  return testEnv
    .authenticatedContext(REAL, { firebase: { sign_in_provider: "password" } })
    .firestore();
}

async function seedAll(entries: Array<[string, Record<string, unknown>]>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [path, data] of entries) {
      await setDoc(doc(db, path), data);
    }
  });
}

/**
 * Seguir exige escribir el doc Y su espejo en el MISMO lote: las reglas se
 * comprueban cruzadas con `existsAfter`/`getAfter`. Sin el espejo la regla falla
 * por forma, no por identidad, y el test verificaría lo que no es.
 */
function followBatch(db: ReturnType<typeof realDb>, followerUid: string, targetUid: string) {
  const batch = writeBatch(db);
  batch.set(doc(db, `users/${followerUid}/following/${targetUid}`), {
    userId: followerUid,
    targetUserId: targetUid,
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, `users/${targetUid}/followers/${followerUid}`), {
    userId: targetUid,
    followerUserId: followerUid,
    createdAt: serverTimestamp(),
  });
  return batch.commit();
}

/** Perfil mínimo que `validUserBase` acepta. */
function profile(uid: string, handle: string) {
  return {
    uid,
    handle,
    displayName: "Nombre Visible",
    firstName: "Nombre",
    lastName: "Apellido",
    birthDate: "1990-01-01",
    sex: "other",
    photoURL: null,
  };
}

describe("C01 — un invitado anónimo no participa socialmente", () => {
  it("no puede crearse un perfil", async () => {
    await assertFails(
      setDoc(doc(guestDb(), `users/${GUEST}`), profile(GUEST, "invitado"))
    );
  });

  it("no puede reservar un handle", async () => {
    await assertFails(
      setDoc(doc(guestDb(), "handles/invitado"), { uid: GUEST })
    );
  });

  it("no puede crear una comunidad", async () => {
    await assertFails(
      setDoc(doc(guestDb(), "groups/g1"), {
        ownerId: GUEST,
        name: "Comunidad del invitado",
        visibility: "public",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("no puede seguir a nadie", async () => {
    await seedAll([[`users/${REAL}`, profile(REAL, "real")]]);
    // Lote bien formado: lo único que lo tumba es ser anónimo.
    await assertFails(followBatch(guestDb(), GUEST, REAL));
  });

  it("no puede bloquear a nadie", async () => {
    await seedAll([[`users/${REAL}`, profile(REAL, "real")]]);
    await assertFails(
      setDoc(doc(guestDb(), `users/${GUEST}/blockedUsers/${REAL}`), {
        userId: GUEST,
        blockedUserId: REAL,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("no puede registrar una sesión de dispositivo", async () => {
    await assertFails(
      setDoc(doc(guestDb(), `users/${GUEST}/sessions/s1`), {
        userAgent: "x",
        revoked: false,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("no puede registrar un token de push", async () => {
    await assertFails(
      setDoc(doc(guestDb(), `users/${GUEST}/fcmTokens/t1`), {
        token: "t1",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("no puede reportar contenido", async () => {
    await assertFails(
      setDoc(doc(guestDb(), "reports/r1"), {
        reporterId: GUEST,
        targetType: "post",
        targetId: "p1",
        reason: "spam",
        createdAt: serverTimestamp(),
      })
    );
  });
});

describe("C01 — una cuenta real sigue pudiendo hacer lo mismo", () => {
  it("puede crear su perfil y reservar su handle en un lote", async () => {
    const db = realDb();
    const batch = writeBatch(db);
    batch.set(doc(db, `users/${REAL}`), profile(REAL, "realuser"));
    batch.set(doc(db, "handles/realuser"), { uid: REAL });
    await assertSucceeds(batch.commit());
  });

  it("puede seguir a otra persona", async () => {
    await seedAll([
      [`users/${REAL}`, profile(REAL, "realuser")],
      ["users/otro", profile("otro", "otro")],
    ]);
    await assertSucceeds(followBatch(realDb(), REAL, "otro"));
  });

  it("puede registrar su sesión de dispositivo", async () => {
    await assertSucceeds(
      setDoc(doc(realDb(), `users/${REAL}/sessions/s1`), {
        userAgent: "x",
        revoked: false,
        createdAt: serverTimestamp(),
      })
    );
  });
});

describe("C02 — un uid no acumula handles", () => {
  it("no puede reservar un handle sin perfil que lo declare", async () => {
    await assertFails(
      setDoc(doc(realDb(), "handles/marca_conocida"), { uid: REAL })
    );
  });

  it("no puede reservar un SEGUNDO handle teniendo ya perfil", async () => {
    await seedAll([
      [`users/${REAL}`, profile(REAL, "realuser")],
      ["handles/realuser", { uid: REAL }],
    ]);
    // El perfil declara "realuser": cualquier otro nombre queda fuera.
    await assertFails(
      setDoc(doc(realDb(), "handles/marca_conocida"), { uid: REAL })
    );
  });

  it("no puede apuntar un handle a otro uid", async () => {
    await seedAll([[`users/${REAL}`, profile(REAL, "realuser")]]);
    await assertFails(
      setDoc(doc(realDb(), "handles/realuser"), { uid: "otro_uid" })
    );
  });

  it("no puede robar un handle ya tomado", async () => {
    await seedAll([
      ["handles/ocupado", { uid: "otro_uid" }],
      [`users/${REAL}`, profile(REAL, "ocupado")],
    ]);
    await assertFails(setDoc(doc(realDb(), "handles/ocupado"), { uid: REAL }));
  });

  it("los handles siguen siendo inmutables e imborrables", async () => {
    await seedAll([
      [`users/${REAL}`, profile(REAL, "realuser")],
      ["handles/realuser", { uid: REAL }],
    ]);
    await assertFails(setDoc(doc(realDb(), "handles/realuser"), { uid: REAL, x: 1 }));
    await assertFails(deleteDoc(doc(realDb(), "handles/realuser")));
  });
});
