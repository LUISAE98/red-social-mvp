import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// MENSAJES DIRECTOS (DM) — Bloque 1.
//
// Todo el control de acceso del DM vive en el `create` de la conversación. Si
// ese gate cede, no hay segunda barrera: una vez abierto el hilo, escribir ya
// no vuelve a mirar la política del destinatario.
//
// Lo que se verifica aquí:
//   - las 3 políticas (everyone / following / none),
//   - que el cliente NO puede elegir el estado inicial y saltarse Solicitudes,
//   - que las cuentas anónimas (invitados de compra) no pueden escribir,
//   - que el bloqueo corta en ambos sentidos y solo lo levanta quien bloqueó,
//   - que el ID determinista impide hilos duplicados,
//   - que `lastMessage` es territorio exclusivo de la Cloud Function.
// ─────────────────────────────────────────────────────────────────────────────

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    // projectId propio: `clearFirestore()` vacía TODO el proyecto y vitest corre
    // los archivos en paralelo — compartirlo le borraría los datos a otra suite.
    projectId: "demo-vibra-dm",
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

type Seeds = Array<[string, Record<string, unknown>]>;

/**
 * Siembra docs saltándose las reglas (simula lo que escribe el backend).
 *
 * Recibe TODOS los docs de una vez a propósito: cada `withSecurityRulesDisabled`
 * levanta una app de Firebase nueva, y sembrando doc a doc esta suite abría ~150
 * y tumbaba al emulador por agotamiento a mitad de la corrida. Una llamada por
 * test lo mantiene en pie.
 */
async function seedAll(entries: Seeds) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [path, data] of entries) {
      await setDoc(doc(db, path), data);
    }
  });
}

// Ordenados alfabéticamente: ALICE < BOB. El participantsKey lo exige.
const ALICE = "alice";
const BOB = "bob";
const CAROL = "carol";
const CONV = `${ALICE}_${BOB}`;

type Policy = "everyone" | "following" | "following_and_followers" | "none" | undefined;

/** Alice sigue a Bob. Solo lo mira la política "following_and_followers". */
function aliceFollowsBob(): Seeds {
  return [[`users/${ALICE}/following/${BOB}`, { userId: ALICE, targetUserId: BOB }]];
}

/** Los dos perfiles; `bobPolicy` undefined simula un perfil antiguo sin el campo. */
function users(bobPolicy: Policy): Seeds {
  return [
    [`users/${ALICE}`, { displayName: "Alice" }],
    [
      `users/${BOB}`,
      bobPolicy === undefined
        ? { displayName: "Bob" }
        : { displayName: "Bob", messagePolicy: bobPolicy },
    ],
  ];
}

/** Bob sigue a Alice: lo que mira la política "following" y el estado inicial. */
function bobFollowsAlice(): Seeds {
  return [[`users/${BOB}/following/${ALICE}`, { userId: BOB, followerUserId: ALICE }]];
}

function blocked(blocker: string, target: string): Seeds {
  return [[`users/${blocker}/blockedUsers/${target}`, { uid: target }]];
}

/** Conversación ya existente, sembrada por detrás. */
function conversation(
  status: "active" | "request" | "blocked",
  blockedBy: string | null = null,
  createdBy = ALICE
): Seeds {
  return [
    [
      `conversations/${CONV}`,
      {
        participants: [ALICE, BOB],
        participantsKey: CONV,
        status,
        createdBy,
        lastMessage: null,
        lastMessageAt: null,
        blockedBy,
        unread: {},
        lastReadAt: {},
        firstMessageId: "m1",
      },
    ],
  ];
}

function existingMessage(senderId = ALICE, id = "m1"): Seeds {
  return [
    [`conversations/${CONV}/messages/${id}`, { senderId, text: "hola", isDeleted: false }],
  ];
}

/**
 * Crea la conversación como lo hace el cliente real: hilo + primer mensaje en un
 * único lote atómico. Los parámetros permiten torcer cada pieza por separado
 * para comprobar que las rules la rechazan.
 */
function createConversation(
  db: ReturnType<typeof as>,
  options: {
    convId?: string;
    status: "active" | "request";
    createdBy?: string;
    senderId?: string;
    participants?: string[];
    participantsKey?: string;
    /** Declara un firstMessageId pero NO escribe el mensaje. */
    omitMessage?: boolean;
  }
) {
  const {
    convId = CONV,
    status,
    createdBy = ALICE,
    senderId = ALICE,
    participants = [ALICE, BOB],
    participantsKey = CONV,
    omitMessage = false,
  } = options;

  const batch = writeBatch(db);
  const messageRef = doc(collection(db, `conversations/${convId}/messages`));

  batch.set(doc(db, `conversations/${convId}`), {
    participants,
    participantsKey,
    status,
    createdBy,
    lastMessage: null,
    lastMessageAt: null,
    blockedBy: null,
    unread: {},
    lastReadAt: {},
    firstMessageId: messageRef.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (!omitMessage) {
    batch.set(messageRef, {
      senderId,
      text: "hola",
      createdAt: serverTimestamp(),
      isDeleted: false,
    });
  }

  return batch.commit();
}

function as(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function asAnonymous(uid: string) {
  return testEnv
    .authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } })
    .firestore();
}

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — política de recepción del destinatario", () => {
  // El predeterminado de la plataforma es "following": un perfil que nunca tocó
  // la configuración NO tiene la bandeja abierta de par en par.
  it("🔴 sin campo messagePolicy, un desconocido NO puede escribir (default = following)", async () => {
    await seedAll(users(undefined));
    await assertFails(createConversation(as(ALICE), { status: "request" }));
  });

  it("🟢 sin campo messagePolicy, quien el destinatario sigue SÍ puede escribir", async () => {
    await seedAll([...users(undefined), ...bobFollowsAlice()]);
    await assertSucceeds(createConversation(as(ALICE), { status: "active" }));
  });

  it("🟢 'everyone' + el destinatario NO me sigue ⇒ nace en Solicitudes", async () => {
    await seedAll(users("everyone"));
    await assertSucceeds(createConversation(as(ALICE), { status: "request" }));
  });

  it("🔴 el emisor NO puede forzar 'active' para saltarse la bandeja de Solicitudes", async () => {
    await seedAll(users("everyone"));
    await assertFails(createConversation(as(ALICE), { status: "active" }));
  });

  it("🟢 'everyone' + el destinatario me sigue ⇒ nace activa", async () => {
    await seedAll([...users("everyone"), ...bobFollowsAlice()]);
    await assertSucceeds(createConversation(as(ALICE), { status: "active" }));
  });

  it("🔴 'following' + el destinatario NO me sigue ⇒ ni siquiera se abre el hilo", async () => {
    await seedAll(users("following"));
    await assertFails(createConversation(as(ALICE), { status: "request" }));
    await assertFails(createConversation(as(ALICE), { status: "active" }));
  });

  it("🟢 'following' + el destinatario me sigue ⇒ pasa, y nace activa", async () => {
    await seedAll([...users("following"), ...bobFollowsAlice()]);
    await assertSucceeds(createConversation(as(ALICE), { status: "active" }));
  });

  it("🔴 con 'following' tampoco puede nacer en Solicitudes", async () => {
    await seedAll([...users("following"), ...bobFollowsAlice()]);
    await assertFails(createConversation(as(ALICE), { status: "request" }));
  });

  it("🔴 'none' ⇒ nadie puede abrir hilo, ni aunque el destinatario me siga", async () => {
    await seedAll([...users("none"), ...bobFollowsAlice()]);
    await assertFails(createConversation(as(ALICE), { status: "active" }));
    await assertFails(createConversation(as(ALICE), { status: "request" }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — política 'a quien sigo y a quien me sigue'", () => {
  it("🟢 pasa si el destinatario me sigue", async () => {
    await seedAll([...users("following_and_followers"), ...bobFollowsAlice()]);
    await assertSucceeds(createConversation(as(ALICE), { status: "active" }));
  });

  // La diferencia real con "following": aquí basta con que YO le siga.
  it("🟢 pasa también si soy yo quien sigue al destinatario, y entra DIRECTO", async () => {
    await seedAll([...users("following_and_followers"), ...aliceFollowsBob()]);
    await assertSucceeds(createConversation(as(ALICE), { status: "active" }));
  });

  // Solicitudes es exclusivo de "everyone": esta política ya filtró por relación,
  // así que lo que la pasa no necesita triaje.
  it("🔴 NO puede nacer en Solicitudes con esta política", async () => {
    await seedAll([...users("following_and_followers"), ...aliceFollowsBob()]);
    await assertFails(createConversation(as(ALICE), { status: "request" }));
  });

  it("🔴 sin ninguna relación de seguimiento NO pasa", async () => {
    await seedAll(users("following_and_followers"));
    await assertFails(createConversation(as(ALICE), { status: "request" }));
    await assertFails(createConversation(as(ALICE), { status: "active" }));
  });

  it("🔴 con 'following' a secas, seguir al destinatario NO basta", async () => {
    await seedAll([...users("following"), ...aliceFollowsBob()]);
    await assertFails(createConversation(as(ALICE), { status: "request" }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — un hilo nunca nace vacío (y la solicitud, con un solo mensaje)", () => {
  it("🔴 crear la conversación SIN escribir su primer mensaje se rechaza", async () => {
    await seedAll(users("everyone"));
    await assertFails(
      createConversation(as(ALICE), { status: "request", omitMessage: true })
    );
  });

  it("🔴 tampoco vale crearla suelta con setDoc, sin lote ni firstMessageId", async () => {
    await seedAll(users("everyone"));
    await assertFails(
      setDoc(doc(as(ALICE), `conversations/${CONV}`), {
        participants: [ALICE, BOB],
        participantsKey: CONV,
        status: "request",
        createdBy: ALICE,
        lastMessage: null,
        lastMessageAt: null,
        blockedBy: null,
        unread: {},
        lastReadAt: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  // El hueco que quedó abierto a propósito en el Bloque 1: sin esto, un
  // desconocido podía vaciar su bandeja encima de alguien que no le respondía.
  it("🔴 el solicitante NO puede mandar un segundo mensaje mientras no le acepten", async () => {
    await seedAll([
      ...users("everyone"),
      ...conversation("request", null, ALICE),
      ...existingMessage(ALICE),
    ]);
    await assertFails(
      addDoc(collection(as(ALICE), `conversations/${CONV}/messages`), {
        senderId: ALICE,
        text: "otra vez",
        createdAt: serverTimestamp(),
        isDeleted: false,
      })
    );
  });

  it("🟢 el DESTINATARIO sí puede responder a una solicitud", async () => {
    await seedAll([
      ...users("everyone"),
      ...conversation("request", null, ALICE),
      ...existingMessage(ALICE),
    ]);
    await assertSucceeds(
      addDoc(collection(as(BOB), `conversations/${CONV}/messages`), {
        senderId: BOB,
        text: "hola",
        createdAt: serverTimestamp(),
        isDeleted: false,
      })
    );
  });

  // Sin este guard, el remitente pasaba su propia solicitud a "active" y el
  // límite de un mensaje quedaba en nada.
  it("🔴 el REMITENTE no puede auto-aceptar su solicitud", async () => {
    await seedAll([...users("everyone"), ...conversation("request", null, ALICE)]);
    await assertFails(
      updateDoc(doc(as(ALICE), `conversations/${CONV}`), {
        status: "active",
        blockedBy: null,
      })
    );
  });

  it("🟢 el DESTINATARIO sí acepta la solicitud", async () => {
    await seedAll([...users("everyone"), ...conversation("request", null, ALICE)]);
    await assertSucceeds(
      updateDoc(doc(as(BOB), `conversations/${CONV}`), {
        status: "active",
        blockedBy: null,
      })
    );
  });

  it("🟢 rechazar es bloquear: el destinatario puede hacerlo", async () => {
    await seedAll([...users("everyone"), ...conversation("request", null, ALICE)]);
    await assertSucceeds(
      updateDoc(doc(as(BOB), `conversations/${CONV}`), {
        status: "blocked",
        blockedBy: BOB,
      })
    );
  });

  it("🟢 el remitente puede retirar su solicitud bloqueándola", async () => {
    await seedAll([...users("everyone"), ...conversation("request", null, ALICE)]);
    await assertSucceeds(
      updateDoc(doc(as(ALICE), `conversations/${CONV}`), {
        status: "blocked",
        blockedBy: ALICE,
      })
    );
  });

  it("🟢 una vez aceptada, el solicitante ya escribe libremente", async () => {
    await seedAll([
      ...users("everyone"),
      ...conversation("active", null, ALICE),
      ...existingMessage(ALICE),
    ]);
    await assertSucceeds(
      addDoc(collection(as(ALICE), `conversations/${CONV}/messages`), {
        senderId: ALICE,
        text: "gracias por aceptar",
        createdAt: serverTimestamp(),
        isDeleted: false,
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — guardar mi política de recepción", () => {
  it("🟢 puedo cambiar mi propia política a cualquiera de los 4 valores", async () => {
    await seedAll(users("everyone"));
    const db = as(BOB);
    for (const policy of ["everyone", "following_and_followers", "following", "none"]) {
      await assertSucceeds(
        updateDoc(doc(db, `users/${BOB}`), { messagePolicy: policy, updatedAt: serverTimestamp() })
      );
    }
  });

  it("🔴 un valor fuera de los 3 permitidos se rechaza", async () => {
    await seedAll(users("everyone"));
    await assertFails(
      updateDoc(doc(as(BOB), `users/${BOB}`), {
        messagePolicy: "nobody_except_fans",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("🔴 no puedo cambiarle la política a otra persona", async () => {
    await seedAll(users("everyone"));
    await assertFails(
      updateDoc(doc(as(ALICE), `users/${BOB}`), {
        messagePolicy: "everyone",
        updatedAt: serverTimestamp(),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — invitados anónimos", () => {
  it("🔴 una cuenta anónima NO puede abrir una conversación", async () => {
    await seedAll(users("everyone"));
    await assertFails(createConversation(asAnonymous(ALICE), { status: "request" }));
  });

  it("🔴 una cuenta anónima NO puede escribir en un hilo ya abierto", async () => {
    await seedAll([...users("everyone"), ...conversation("active")]);
    await assertFails(
      addDoc(collection(asAnonymous(ALICE), `conversations/${CONV}/messages`), {
        senderId: ALICE,
        text: "hola",
        createdAt: serverTimestamp(),
        isDeleted: false,
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — bloqueo entre usuarios", () => {
  it("🔴 si el destinatario me bloqueó, no puedo abrir hilo", async () => {
    await seedAll([...users("everyone"), ...blocked(BOB, ALICE)]);
    await assertFails(createConversation(as(ALICE), { status: "request" }));
  });

  it("🔴 si yo bloqueé al destinatario, tampoco", async () => {
    await seedAll([...users("everyone"), ...blocked(ALICE, BOB)]);
    await assertFails(createConversation(as(ALICE), { status: "request" }));
  });

  it("🔴 en un hilo bloqueado no se puede escribir", async () => {
    await seedAll([...users("everyone"), ...conversation("blocked", BOB)]);
    await assertFails(
      addDoc(collection(as(ALICE), `conversations/${CONV}/messages`), {
        senderId: ALICE,
        text: "hola",
        createdAt: serverTimestamp(),
        isDeleted: false,
      })
    );
  });

  it("🔴 el BLOQUEADO no puede desbloquearse a sí mismo", async () => {
    await seedAll([...users("everyone"), ...conversation("blocked", BOB)]);
    await assertFails(
      updateDoc(doc(as(ALICE), `conversations/${CONV}`), { status: "active", blockedBy: null })
    );
  });

  it("🟢 quien bloqueó sí puede desbloquear", async () => {
    await seedAll([...users("everyone"), ...conversation("blocked", BOB)]);
    await assertSucceeds(
      updateDoc(doc(as(BOB), `conversations/${CONV}`), { status: "active", blockedBy: null })
    );
  });

  it("🔴 no se puede bloquear en nombre del otro", async () => {
    await seedAll([...users("everyone"), ...conversation("active")]);
    await assertFails(
      updateDoc(doc(as(ALICE), `conversations/${CONV}`), { status: "blocked", blockedBy: BOB })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — identidad del hilo (sin duplicados)", () => {
  it("🔴 el ID del doc debe ser el participantsKey", async () => {
    await seedAll(users("everyone"));
    await assertFails(
      createConversation(as(ALICE), { status: "request", convId: "otro-id-cualquiera" })
    );
  });

  it("🔴 participants sin ordenar alfabéticamente ⇒ rechazado (evita el hilo espejo)", async () => {
    await seedAll(users("everyone"));
    await assertFails(
      createConversation(as(ALICE), {
        status: "request",
        convId: `${BOB}_${ALICE}`,
        participants: [BOB, ALICE],
        participantsKey: `${BOB}_${ALICE}`,
      })
    );
  });

  it("🔴 no puedo crear un hilo en el que yo no participo", async () => {
    await seedAll([...users("everyone"), [`users/${CAROL}`, { displayName: "Carol" }]]);
    await assertFails(
      createConversation(as(CAROL), { status: "request", createdBy: CAROL, senderId: CAROL })
    );
  });

  it("🔴 no puedo atribuirle la autoría del hilo a otra persona", async () => {
    await seedAll(users("everyone"));
    await assertFails(createConversation(as(ALICE), { status: "request", createdBy: BOB }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — lectura del hilo", () => {
  const base = () => [...users("everyone"), ...conversation("active"), ...existingMessage()];

  it("🟢 un participante lee la conversación y sus mensajes", async () => {
    await seedAll(base());
    const db = as(BOB);
    await assertSucceeds(getDoc(doc(db, `conversations/${CONV}`)));
    await assertSucceeds(getDocs(collection(db, `conversations/${CONV}/messages`)));
  });

  it("🔴 un tercero NO lee la conversación ni sus mensajes", async () => {
    await seedAll(base());
    const db = as(CAROL);
    await assertFails(getDoc(doc(db, `conversations/${CONV}`)));
    await assertFails(getDocs(collection(db, `conversations/${CONV}/messages`)));
  });

  it("🔴 un deslogueado no lee nada", async () => {
    await seedAll(base());
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `conversations/${CONV}`)));
  });

  it("🟢 el inbox (query por participants) funciona para su dueño", async () => {
    await seedAll(base());
    await assertSucceeds(
      getDocs(
        query(collection(as(ALICE), "conversations"), where("participants", "array-contains", ALICE))
      )
    );
  });

  // Forma EXACTA de la query de producción (subscribeToInbox): array-contains +
  // in + orderBy + limit. Firestore limita cuántas cláusulas de este tipo se
  // pueden combinar, así que esto verifica que la combinación es legal, no solo
  // que las rules la dejan pasar.
  it("🟢 la query real del inbox (array-contains + in + orderBy + limit) es válida", async () => {
    await seedAll(base());
    await assertSucceeds(
      getDocs(
        query(
          collection(as(ALICE), "conversations"),
          where("participants", "array-contains", ALICE),
          where("status", "in", ["active", "blocked"]),
          orderBy("lastMessageAt", "desc"),
          limit(20)
        )
      )
    );
  });

  it("🟢 la bandeja de Solicitudes se consulta por separado", async () => {
    await seedAll([...users("everyone"), ...conversation("request")]);
    await assertSucceeds(
      getDocs(
        query(
          collection(as(BOB), "conversations"),
          where("participants", "array-contains", BOB),
          where("status", "in", ["request"]),
          orderBy("lastMessageAt", "desc"),
          limit(20)
        )
      )
    );
  });

  it("🔴 no puedo listar el inbox de otra persona", async () => {
    await seedAll(base());
    await assertFails(
      getDocs(
        query(collection(as(CAROL), "conversations"), where("participants", "array-contains", ALICE))
      )
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — mensajes", () => {
  const base = () => [...users("everyone"), ...conversation("active")];

  function message(overrides: Record<string, unknown> = {}) {
    return {
      senderId: ALICE,
      text: "hola",
      createdAt: serverTimestamp(),
      isDeleted: false,
      ...overrides,
    };
  }

  it("🟢 un participante envía un mensaje", async () => {
    await seedAll(base());
    await assertSucceeds(
      addDoc(collection(as(ALICE), `conversations/${CONV}/messages`), message())
    );
  });

  it("🔴 un tercero no puede enviar", async () => {
    await seedAll(base());
    await assertFails(
      addDoc(collection(as(CAROL), `conversations/${CONV}/messages`), message({ senderId: CAROL }))
    );
  });

  it("🔴 no puedo firmar un mensaje con el nombre del otro", async () => {
    await seedAll(base());
    await assertFails(
      addDoc(collection(as(ALICE), `conversations/${CONV}/messages`), message({ senderId: BOB }))
    );
  });

  it("🔴 texto vacío", async () => {
    await seedAll(base());
    await assertFails(
      addDoc(collection(as(ALICE), `conversations/${CONV}/messages`), message({ text: "" }))
    );
  });

  it("🔴 texto por encima del límite de 2000", async () => {
    await seedAll(base());
    await assertFails(
      addDoc(
        collection(as(ALICE), `conversations/${CONV}/messages`),
        message({ text: "x".repeat(2001) })
      )
    );
  });

  // Una imagen por mensaje. El texto pasa a ser opcional cuando la hay.
  // Solo se guardan RUTAS: la URL la firma la Cloud Function y caduca.
  const IMAGE = {
    path: `dmImages/${CONV}/${ALICE}/images/a.jpg`,
    thumbnailPath: `dmImages/${CONV}/${ALICE}/thumbnails/a.jpg`,
    width: 800,
    height: 600,
  };

  it("🟢 un mensaje SOLO imagen (sin texto) se permite", async () => {
    await seedAll(base());
    await assertSucceeds(
      addDoc(
        collection(as(ALICE), `conversations/${CONV}/messages`),
        message({ text: "", image: IMAGE })
      )
    );
  });

  it("🟢 imagen con pie de foto también", async () => {
    await seedAll(base());
    await assertSucceeds(
      addDoc(
        collection(as(ALICE), `conversations/${CONV}/messages`),
        message({ text: "mira esto", image: IMAGE })
      )
    );
  });

  it("🔴 una imagen mal formada se rechaza", async () => {
    await seedAll(base());
    const col = collection(as(ALICE), `conversations/${CONV}/messages`);
    // Sin thumbnailPath. Se OMITE la clave en vez de ponerla a undefined: el SDK
    // rechaza undefined en el cliente y las rules no llegarían a evaluarse.
    const { thumbnailPath: _omitted, ...noThumb } = IMAGE;
    await assertFails(addDoc(col, message({ text: "", image: noThumb })));
    // Con un campo de más.
    await assertFails(
      addDoc(col, message({ text: "", image: { ...IMAGE, evil: true } }))
    );
    // No es un mapa.
    await assertFails(addDoc(col, message({ text: "", image: "https://x/a.jpg" })));
  });

  // Sin esto se podría apuntar el mensaje a una imagen de OTRO hilo y, al pedir
  // la URL firmada, la función la firmaría creyendo que es de esta conversación.
  it("🔴 una ruta de OTRA conversación se rechaza", async () => {
    await seedAll(base());
    await assertFails(
      addDoc(
        collection(as(ALICE), `conversations/${CONV}/messages`),
        message({
          text: "",
          image: {
            path: `dmImages/otro_hilo/${ALICE}/images/a.jpg`,
            thumbnailPath: `dmImages/otro_hilo/${ALICE}/thumbnails/a.jpg`,
          },
        })
      )
    );
  });

  it("🔴 sin texto y sin imagen sigue siendo un mensaje vacío", async () => {
    await seedAll(base());
    await assertFails(
      addDoc(collection(as(ALICE), `conversations/${CONV}/messages`), message({ text: "" }))
    );
  });

  it("🔴 no se puede nacer ya borrado ni colar campos extra", async () => {
    await seedAll(base());
    const col = collection(as(ALICE), `conversations/${CONV}/messages`);
    await assertFails(addDoc(col, message({ isDeleted: true })));
    await assertFails(addDoc(col, message({ pinned: true })));
  });

  it("🟢 borrado suave del mensaje propio", async () => {
    await seedAll([...base(), ...existingMessage(ALICE)]);
    await assertSucceeds(
      updateDoc(doc(as(ALICE), `conversations/${CONV}/messages/m1`), { isDeleted: true })
    );
  });

  it("🔴 no puedo borrar el mensaje del otro", async () => {
    await seedAll([...base(), ...existingMessage(ALICE)]);
    await assertFails(
      updateDoc(doc(as(BOB), `conversations/${CONV}/messages/m1`), { isDeleted: true })
    );
  });

  it("🔴 el texto enviado es inmutable: no se puede reescribir", async () => {
    await seedAll([...base(), ...existingMessage(ALICE)]);
    await assertFails(
      updateDoc(doc(as(ALICE), `conversations/${CONV}/messages/m1`), { text: "otra cosa" })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("DM — campos que solo puede escribir la Cloud Function", () => {
  const base = () => [...users("everyone"), ...conversation("active")];

  it("🔴 el cliente no puede falsear el resumen del inbox (lastMessage)", async () => {
    await seedAll(base());
    const db = as(ALICE);
    await assertFails(
      updateDoc(doc(db, `conversations/${CONV}`), {
        lastMessage: { text: "falso", senderId: BOB, createdAt: serverTimestamp() },
      })
    );
    await assertFails(
      updateDoc(doc(db, `conversations/${CONV}`), { lastMessageAt: serverTimestamp() })
    );
  });

  it("🔴 el cliente no puede reescribir los participantes del hilo", async () => {
    await seedAll(base());
    await assertFails(
      updateDoc(doc(as(ALICE), `conversations/${CONV}`), { participants: [ALICE, CAROL] })
    );
  });

  it("🟢 pero sí puede marcar como leído (recibo agregado) y poner su contador a 0", async () => {
    await seedAll(base());
    await assertSucceeds(
      updateDoc(doc(as(BOB), `conversations/${CONV}`), {
        [`lastReadAt.${BOB}`]: serverTimestamp(),
        [`unread.${BOB}`]: 0,
      })
    );
  });

  it("🔴 el hilo no se puede borrar, solo bloquear", async () => {
    await seedAll(base());
    await assertFails(deleteDoc(doc(as(ALICE), `conversations/${CONV}`)));
  });
});
