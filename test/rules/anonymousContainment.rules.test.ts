import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore";

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

// Los contextos se crean UNA vez y se reutilizan. Cada `authenticatedContext()`
// levanta una app de Firebase nueva, y llamarlos dentro de cada aserción abría
// ~90 en esta suite: el emulador se queda sin recursos y muere a media corrida
// (se ve como ECONNREFUSED en la suite que toque correr después, no en esta).
let guestFs: ReturnType<ReturnType<RulesTestEnvironment["authenticatedContext"]>["firestore"]>;
let realFs: typeof guestFs;

beforeAll(() => {
  guestFs = testEnv
    .authenticatedContext(GUEST, { firebase: { sign_in_provider: "anonymous" } })
    .firestore();
  realFs = testEnv
    .authenticatedContext(REAL, {
      email: `${REAL}@example.com`,
      firebase: { sign_in_provider: "password" },
    })
    .firestore();
});

/** Contexto de invitado: el token lleva sign_in_provider = "anonymous". */
function guestDb() {
  return guestFs;
}

/** Contexto de cuenta real (email/contraseña). */
function realDb() {
  return realFs;
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

/**
 * Perfil válido: refleja lo que escribe `profileOnboarding.ts`. El correo y el
 * proveedor tienen que coincidir con el token, así que se derivan de él.
 */
function profile(
  uid: string,
  handle: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    uid,
    photoURL: null,
    coverUrl: null,
    handle,
    username: handle,
    displayName: "Nombre Visible",
    firstName: "Nombre",
    lastName: "Apellido",
    bio: "",
    role: "user",
    profileReserved: false,
    profileRestricted: false,
    profileCommentsEnabled: true,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
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

describe("C03 — el cliente no puede tocar la revocación de sus sesiones", () => {
  it("puede registrar y refrescar su sesión", async () => {
    const db = realDb();
    await assertSucceeds(
      setDoc(doc(db, `users/${REAL}/sessions/s1`), {
        userAgent: "x",
        revoked: false,
        createdAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      setDoc(
        doc(db, `users/${REAL}/sessions/s1`),
        { userAgent: "x", revoked: false, lastSeenAt: serverTimestamp() },
        { merge: true }
      )
    );
  });

  it("NO puede crear una sesión ya marcada como revocada", async () => {
    await assertFails(
      setDoc(doc(realDb(), `users/${REAL}/sessions/s2`), {
        userAgent: "x",
        revoked: true,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("NO puede revocar desde el cliente", async () => {
    await seedAll([[`users/${REAL}/sessions/s3`, { userAgent: "x", revoked: false }]]);
    await assertFails(
      setDoc(
        doc(realDb(), `users/${REAL}/sessions/s3`),
        { revoked: true },
        { merge: true }
      )
    );
  });

  it("NO puede DES-revocarse (el agujero que hacía inútil el panel)", async () => {
    await seedAll([[`users/${REAL}/sessions/s4`, { userAgent: "x", revoked: true }]]);
    await assertFails(
      setDoc(
        doc(realDb(), `users/${REAL}/sessions/s4`),
        { revoked: false },
        { merge: true }
      )
    );
  });

  it("NO puede borrar el documento para tapar el rastro", async () => {
    await seedAll([[`users/${REAL}/sessions/s5`, { userAgent: "x", revoked: true }]]);
    await assertFails(deleteDoc(doc(realDb(), `users/${REAL}/sessions/s5`)));
  });

  it("un heartbeat sobre una sesión revocada NO la resucita", async () => {
    await seedAll([[`users/${REAL}/sessions/s6`, { userAgent: "x", revoked: true }]]);
    // Refrescar metadata sí, tocar `revoked` no.
    await assertSucceeds(
      setDoc(
        doc(realDb(), `users/${REAL}/sessions/s6`),
        { lastSeenAt: serverTimestamp() },
        { merge: true }
      )
    );
    await assertFails(
      setDoc(
        doc(realDb(), `users/${REAL}/sessions/s6`),
        { lastSeenAt: serverTimestamp(), revoked: false },
        { merge: true }
      )
    );
  });
});

/**
 * Identidad privada: lo que escribe `profileOnboarding.ts` en
 * `users/{uid}/private/identity`. El correo y el proveedor tienen que coincidir
 * con el token, así que se derivan de él.
 */
function identity(uid: string, overrides: Record<string, unknown> = {}) {
  const email = `${uid}@example.com`;
  return {
    email,
    emailLower: email.toLowerCase(),
    birthDate: "1990-01-01",
    sex: "other",
    provider: "password",
    authProvider: "password",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

/** Alta completa: perfil público + handle + identidad privada, en un lote. */
function signUpBatch(overrides: Record<string, unknown> = {}) {
  const db = realDb();
  const batch = writeBatch(db);
  batch.set(doc(db, `users/${REAL}`), profile(REAL, "realuser"));
  batch.set(doc(db, "handles/realuser"), { uid: REAL });
  batch.set(doc(db, `users/${REAL}/private/identity`), identity(REAL, overrides));
  return batch.commit();
}

describe("H01 — los datos personales salen del documento público", () => {
  it("el alta completa funciona", async () => {
    await assertSucceeds(signUpBatch());
  });

  it("el perfil público YA NO acepta correo ni fecha de nacimiento", async () => {
    const db = realDb();
    const batch = writeBatch(db);
    batch.set(
      doc(db, `users/${REAL}`),
      profile(REAL, "realuser", { email: "x@y.com", birthDate: "1990-01-01" })
    );
    batch.set(doc(db, "handles/realuser"), { uid: REAL });
    await assertFails(batch.commit());
  });

  it("el dueño SÍ lee su identidad privada", async () => {
    await seedAll([[`users/${REAL}/private/identity`, { email: "a@b.com" }]]);
    await assertSucceeds(getDoc(doc(realDb(), `users/${REAL}/private/identity`)));
  });

  it("otra persona NO la lee, aunque el perfil sea público", async () => {
    await seedAll([[`users/otro/private/identity`, { email: "victima@banco.com" }]]);
    await assertFails(getDoc(doc(realDb(), "users/otro/private/identity")));
  });

  it("un invitado anónimo tampoco", async () => {
    await seedAll([[`users/${REAL}/private/identity`, { email: "a@b.com" }]]);
    await assertFails(getDoc(doc(guestDb(), `users/${REAL}/private/identity`)));
  });

  it("es inmutable, ni el dueño la reescribe", async () => {
    await seedAll([[`users/${REAL}/private/identity`, identity(REAL)]]);
    await assertFails(
      setDoc(
        doc(realDb(), `users/${REAL}/private/identity`),
        { email: "otro@correo.com" },
        { merge: true }
      )
    );
    await assertFails(deleteDoc(doc(realDb(), `users/${REAL}/private/identity`)));
  });
});

describe("H03 — la identidad no se puede falsificar", () => {
  it("NO puede inventarse el correo", async () => {
    await assertFails(
      signUpBatch({ email: "victima@banco.com", emailLower: "victima@banco.com" })
    );
  });

  it("NO puede mentir sobre el proveedor", async () => {
    await assertFails(signUpBatch({ authProvider: "google.com", provider: "google" }));
  });

  it("NO puede colar campos que nadie validó", async () => {
    await assertFails(signUpBatch({ verificado: true, saldo: 999999 }));
  });

  it("NO puede nacer con rol de moderador", async () => {
    const db = realDb();
    const batch = writeBatch(db);
    batch.set(doc(db, `users/${REAL}`), profile(REAL, "realuser", { role: "moderator" }));
    batch.set(doc(db, "handles/realuser"), { uid: REAL });
    batch.set(doc(db, `users/${REAL}/private/identity`), identity(REAL));
    await assertFails(batch.commit());
  });

  it("NO puede desalinear username y handle", async () => {
    const db = realDb();
    const batch = writeBatch(db);
    batch.set(doc(db, `users/${REAL}`), profile(REAL, "realuser", { username: "otro" }));
    batch.set(doc(db, "handles/realuser"), { uid: REAL });
    batch.set(doc(db, `users/${REAL}/private/identity`), identity(REAL));
    await assertFails(batch.commit());
  });
});

describe("H04 — la edad mínima deja de ser solo del cliente", () => {
  it("acepta a una persona adulta", async () => {
    await assertSucceeds(signUpBatch({ birthDate: "1990-01-01" }));
  });

  it("RECHAZA a un menor de edad", async () => {
    await assertFails(signUpBatch({ birthDate: "2015-06-15" }));
  });

  it("RECHAZA una fecha futura", async () => {
    await assertFails(signUpBatch({ birthDate: "2090-01-01" }));
  });

  it("RECHAZA una fecha inexistente", async () => {
    await assertFails(signUpBatch({ birthDate: "2000-13-45" }));
  });

  it("RECHAZA una fecha absurda", async () => {
    await assertFails(signUpBatch({ birthDate: "1523-01-01" }));
  });
});

describe("H07 — el moderador tiene que entrar con Google", () => {
  const MOD = "mod_uid";

  /** Claim de moderador con el proveedor indicado. */
  function modDb(provider: "google.com" | "password") {
    return testEnv
      .authenticatedContext(MOD, {
        role: "moderator",
        email: `${MOD}@example.com`,
        firebase: { sign_in_provider: provider },
      })
      .firestore();
  }

  it("con Google SÍ ve el registro de auditoría", async () => {
    await seedAll([["adminAuditLog/a1", { action: "x" }]]);
    await assertSucceeds(getDoc(doc(modDb("google.com"), "adminAuditLog/a1")));
  });

  it("con contraseña NO, aunque tenga el claim", async () => {
    await seedAll([["adminAuditLog/a1", { action: "x" }]]);
    await assertFails(getDoc(doc(modDb("password"), "adminAuditLog/a1")));
  });

  it("sin el claim NO, aunque entre con Google", async () => {
    await seedAll([["adminAuditLog/a1", { action: "x" }]]);
    await assertFails(getDoc(doc(realDb(), "adminAuditLog/a1")));
  });
});

describe("B3-C01 — el supermoderador ya no lee todo", () => {
  const SUPER = "super_uid";
  const OTRO = "otro_uid";

  function superDb() {
    return testEnv
      .authenticatedContext(SUPER, {
        role: "moderator",
        email: `${SUPER}@example.com`,
        firebase: { sign_in_provider: "google.com" },
      })
      .firestore();
  }

  it("NO lee las claves de transmisión de un live ajeno", async () => {
    await seedAll([
      ["posts/p1", { authorId: OTRO, isDeleted: false }],
      ["posts/p1/liveStream/credentials", { streamKey: "SECRETO", whipUrl: "https://x" }],
    ]);
    await assertFails(getDoc(doc(superDb(), "posts/p1/liveStream/credentials")));
  });

  it("NO lee los datos fiscales de un creador", async () => {
    await seedAll([["creatorTaxProfiles/otro_uid", { rfc: "XAXX010101000" }]]);
    await assertFails(getDoc(doc(superDb(), "creatorTaxProfiles/otro_uid")));
  });

  it("NO lee las cuentas de retiro", async () => {
    await seedAll([[`users/${OTRO}/payoutAccounts/a1`, { clabe: "0123456789" }]]);
    await assertFails(getDoc(doc(superDb(), `users/${OTRO}/payoutAccounts/a1`)));
  });

  it("NO lee el movimiento de wallet de nadie", async () => {
    await seedAll([[`users/${OTRO}/walletLedger/e1`, { amount: 500 }]]);
    await assertFails(getDoc(doc(superDb(), `users/${OTRO}/walletLedger/e1`)));
  });

  it("NO lee las sesiones ni los dispositivos de nadie", async () => {
    await seedAll([[`users/${OTRO}/sessions/s1`, { userAgent: "x" }]]);
    await assertFails(getDoc(doc(superDb(), `users/${OTRO}/sessions/s1`)));
  });
});

describe("B3-C01 — mensajes privados: solo los denunciados", () => {
  const SUPER = "super_uid";
  const CONV_LIMPIA = "aaa_bbb";
  const CONV_DENUNCIADA = "ccc_ddd";

  function superDb() {
    return testEnv
      .authenticatedContext(SUPER, {
        role: "moderator",
        email: `${SUPER}@example.com`,
        firebase: { sign_in_provider: "google.com" },
      })
      .firestore();
  }

  async function seedConversaciones() {
    await seedAll([
      [`conversations/${CONV_LIMPIA}`, { participants: ["aaa", "bbb"], status: "active" }],
      [`conversations/${CONV_LIMPIA}/messages/m1`, { senderId: "aaa", text: "hola" }],
      [
        `conversations/${CONV_DENUNCIADA}`,
        { participants: ["ccc", "ddd"], status: "active", underReview: true },
      ],
      [`conversations/${CONV_DENUNCIADA}/messages/m1`, { senderId: "ccc", text: "acoso" }],
    ]);
  }

  it("NO lee una conversación que nadie denunció", async () => {
    await seedConversaciones();
    await assertFails(getDoc(doc(superDb(), `conversations/${CONV_LIMPIA}`)));
  });

  it("NO lee los mensajes de una conversación que nadie denunció", async () => {
    await seedConversaciones();
    await assertFails(getDoc(doc(superDb(), `conversations/${CONV_LIMPIA}/messages/m1`)));
  });

  it("SÍ lee la conversación denunciada", async () => {
    await seedConversaciones();
    await assertSucceeds(getDoc(doc(superDb(), `conversations/${CONV_DENUNCIADA}`)));
  });

  it("SÍ lee los mensajes de la conversación denunciada", async () => {
    await seedConversaciones();
    await assertSucceeds(
      getDoc(doc(superDb(), `conversations/${CONV_DENUNCIADA}/messages/m1`))
    );
  });

  it("un participante NO puede marcar su propio hilo como denunciado", async () => {
    await seedAll([
      [`conversations/${CONV_LIMPIA}`, { participants: [REAL, "bbb"], status: "active" }],
    ]);
    await assertFails(
      setDoc(
        doc(realDb(), `conversations/${CONV_LIMPIA}`),
        { underReview: true },
        { merge: true }
      )
    );
  });
});

describe("B3-C03 — una suscripción vencida no reconstruye el acceso", () => {
  const GRUPO = "g_pago";

  /** Miembro que el cliente intenta crearse a sí mismo como suscriptor. */
  function membresiaSuscrita() {
    return {
      userId: REAL,
      roleInGroup: "member",
      status: "subscribed",
      accessType: "subscription",
    };
  }

  function suscripcion(extra: Record<string, unknown>) {
    return { uid: REAL, groupId: GRUPO, ...extra };
  }

  const dentroDeUnMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const haceUnMes = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  async function sembrarGrupo(sub: Record<string, unknown> | null) {
    const seeds: Array<[string, Record<string, unknown>]> = [
      [
        `groups/${GRUPO}`,
        {
          ownerId: "dueno",
          visibility: "private",
          isActive: true,
          monetization: { subscriptionsEnabled: true, isPaid: true },
        },
      ],
      [`users/${REAL}`, profile(REAL, "realuser")],
    ];
    if (sub) seeds.push([`groupSubscriptions/${GRUPO}_${REAL}`, sub]);
    await seedAll(seeds);
  }

  it("con suscripción viva SÍ puede", async () => {
    await sembrarGrupo(suscripcion({ active: true, status: "authorized", accessUntil: dentroDeUnMes }));
    await assertSucceeds(
      setDoc(doc(realDb(), `groups/${GRUPO}/members/${REAL}`), membresiaSuscrita())
    );
  });

  it("con suscripción CANCELADA no puede", async () => {
    await sembrarGrupo(suscripcion({ active: false, status: "cancelled", accessUntil: dentroDeUnMes }));
    await assertFails(
      setDoc(doc(realDb(), `groups/${GRUPO}/members/${REAL}`), membresiaSuscrita())
    );
  });

  it("con suscripción TERMINADA no puede", async () => {
    await sembrarGrupo(suscripcion({ active: false, status: "ended", accessUntil: haceUnMes }));
    await assertFails(
      setDoc(doc(realDb(), `groups/${GRUPO}/members/${REAL}`), membresiaSuscrita())
    );
  });

  it("con suscripción VENCIDA aunque siga marcada activa, no puede", async () => {
    await sembrarGrupo(suscripcion({ active: true, status: "authorized", accessUntil: haceUnMes }));
    await assertFails(
      setDoc(doc(realDb(), `groups/${GRUPO}/members/${REAL}`), membresiaSuscrita())
    );
  });

  it("con el comprobante de OTRA persona no puede", async () => {
    await sembrarGrupo(
      suscripcion({ uid: "otra_persona", active: true, status: "authorized", accessUntil: dentroDeUnMes })
    );
    await assertFails(
      setDoc(doc(realDb(), `groups/${GRUPO}/members/${REAL}`), membresiaSuscrita())
    );
  });

  it("sin ningún comprobante no puede", async () => {
    await sembrarGrupo(null);
    await assertFails(
      setDoc(doc(realDb(), `groups/${GRUPO}/members/${REAL}`), membresiaSuscrita())
    );
  });
});
