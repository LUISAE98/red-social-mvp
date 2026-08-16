import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Test de seguridad de las Firestore Rules: nadie puede auto-concederse una
// membresía de PAGO ("subscribed") sin un comprobante de pago que solo el backend
// puede crear (groupSubscriptions/{groupId}_{userId}, colección backend-only).
//
// Regresión que cierra: el flujo legítimo ya era server-authoritative
// (payGroupSubscription → Admin SDK), pero la regla de creación de miembro NO
// exigía prueba de pago, así que un cliente podía fabricarse acceso sin pagar.
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
  // Igual que en hiddenGroups: cargar un projectId más en el emulador mientras
  // las otras suites corren en paralelo tarda más que el hookTimeout de 20s.
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

describe("groups/{g}/members create — prueba de pago obligatoria", () => {
  it("🔴 cliente NO puede crearse membresía 'subscribed' en grupo de pago SIN comprobante", async () => {
    const gid = "gPago";
    const attacker = "attacker";
    await seed(`groups/${gid}`, {
      ownerId: "owner",
      visibility: "hidden",
      isActive: true,
      monetization: { subscriptionsEnabled: true },
    });

    const db = testEnv.authenticatedContext(attacker).firestore();
    await assertFails(
      setDoc(doc(db, `groups/${gid}/members/${attacker}`), {
        userId: attacker,
        roleInGroup: "member",
        status: "subscribed",
        accessType: "subscription",
      })
    );
  });

  it("✅ CON groupSubscriptions pagado (creado por el backend) el cliente SÍ puede", async () => {
    const gid = "gPago2";
    const buyer = "buyer";
    await seed(`groups/${gid}`, {
      ownerId: "owner",
      visibility: "hidden",
      isActive: true,
      monetization: { subscriptionsEnabled: true },
    });
    // Solo el backend puede crear esto (create:if false en las rules).
    // Se siembra con la MISMA forma que escribe `groupSubscriptionStripeSync`:
    // antes bastaba `{ active: true }`, pero las reglas ya no se conforman con
    // que el comprobante exista — comprueban que siga vigente y que hable de
    // esta persona y esta comunidad (ver B3-C03).
    await seed(`groupSubscriptions/${gid}_${buyer}`, {
      active: true,
      status: "authorized",
      uid: buyer,
      groupId: gid,
      accessUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const db = testEnv.authenticatedContext(buyer).firestore();
    await assertSucceeds(
      setDoc(doc(db, `groups/${gid}/members/${buyer}`), {
        userId: buyer,
        roleInGroup: "member",
        status: "subscribed",
        accessType: "subscription",
      })
    );
  });

  it("✅ unirse a un grupo PÚBLICO gratis sigue permitido (sin regresión)", async () => {
    const gid = "gPublico";
    const user = "user";
    await seed(`groups/${gid}`, { ownerId: "owner", visibility: "public", isActive: true });

    const db = testEnv.authenticatedContext(user).firestore();
    await assertSucceeds(
      setDoc(doc(db, `groups/${gid}/members/${user}`), {
        userId: user,
        roleInGroup: "member",
        status: "active",
        accessType: "standard",
      })
    );
  });

  it("🔴 un usuario no puede crear la membresía de OTRO usuario", async () => {
    const gid = "gPublico2";
    await seed(`groups/${gid}`, { ownerId: "owner", visibility: "public", isActive: true });

    const db = testEnv.authenticatedContext("user").firestore();
    await assertFails(
      setDoc(doc(db, `groups/${gid}/members/otro`), {
        userId: "otro",
        roleInGroup: "member",
        status: "active",
        accessType: "standard",
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M01 (Bloque 4) — ESQUEMA CERRADO en las creaciones que gobiernan acceso.
//
// Las reglas validaban los VALORES pero no el conjunto de claves, así que se
// podía crear una comunidad o una membresía con campos inventados y quedaban
// guardados. No concedían nada por sí solos, pero engordan el documento y dejan
// sitio a que una regla futura se fíe de uno de ellos.
//
// ⚠️ Estas pruebas usan el payload EXACTO que escribe el cliente. Es el punto:
// una lista de claves incompleta no la detecta ninguna otra prueba de la suite
// —las demás siembran con las reglas desactivadas— y el fallo aparecería en
// producción como "no puedo crear comunidades".
//
// Los `serverTimestamp()` se sustituyen por `new Date()`: a la regla le da igual
// el tipo, lo que se está comprobando es qué claves viajan.
// ─────────────────────────────────────────────────────────────────────────────
describe("M01 — esquema cerrado en creaciones de acceso", () => {
  const OWNER = "owner_m01";
  const ahora = new Date();

  /**
   * Espejo de `payload` en lib/groups/createGroup.ts.
   *
   * ⚠️ `description` va como cadena, nunca null: el código real escribe
   * `input.description.trim()`, así que sin descripción llega `""`. La regla
   * exige `is string` sin rama para null, y con null deniega — un fixture con
   * null hace fallar la prueba por un motivo que no existe en producción.
   */
  function grupoReal(extra: Record<string, unknown> = {}) {
    return {
      name: "Mi comunidad",
      description: "",
      ownerId: OWNER,
      visibility: "public",
      discoverable: true,
      isActive: true,
      imageUrl: null,
      coverUrl: null,
      avatarUrl: null,
      category: "otros",
      tags: [],
      permissions: { postingMode: "members", commentsEnabled: true },
      monetization: { isPaid: false, subscriptionsEnabled: false },
      greetingsEnabled: false,
      welcomeMessage: null,
      ageMin: null,
      ageMax: null,
      // Espejo de `buildGroupSearchIndex` en lib/groups/groupSearchIndex.ts.
      search: {
        nameNormalized: "mi comunidad",
        descriptionNormalized: "",
        categoryNormalized: "otros",
        categoryLabelNormalized: "otros",
        tagsNormalized: [],
        tokens: ["mi", "comunidad", "otros"],
        prefixes: ["mi", "co", "com"],
        visibility: "public",
        discoverable: true,
        isActive: true,
        version: 1,
        updatedAt: ahora,
      },
      createdAt: ahora,
      updatedAt: ahora,
      ...extra,
    };
  }

  /** Espejo de `ownerMemberPayload` en lib/groups/createGroup.ts. */
  function membresiaDuenoReal(extra: Record<string, unknown> = {}) {
    return {
      userId: OWNER,
      roleInGroup: "owner",
      status: "active",
      accessType: "standard",
      requiresSubscription: false,
      subscriptionActive: false,
      createdAt: ahora,
      joinedAt: ahora,
      updatedAt: ahora,
      ...extra,
    };
  }

  /** Espejo de `buildBaseMemberFields` + alta normal en lib/groups/membership.ts. */
  function membresiaMiembroReal(uid: string, extra: Record<string, unknown> = {}) {
    return {
      userId: uid,
      roleInGroup: "member",
      status: "active",
      updatedAt: ahora,
      transitionPendingAction: false,
      accessType: "standard",
      requiresSubscription: false,
      subscriptionActive: false,
      joinedAt: ahora,
      ...extra,
    };
  }

  it("🟢 el payload real de crear comunidad SÍ pasa", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(setDoc(doc(db, "groups/g_m01"), grupoReal()));
  });

  it("🔴 el mismo payload con un campo inventado NO pasa", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertFails(
      setDoc(doc(db, "groups/g_m01b"), grupoReal({ featured: true }))
    );
  });

  it("🟢 el payload real del dueño al entrar en su comunidad SÍ pasa", async () => {
    await seed("groups/g_m01c", { ownerId: OWNER, visibility: "public", isActive: true });
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await assertSucceeds(
      setDoc(doc(db, `groups/g_m01c/members/${OWNER}`), membresiaDuenoReal())
    );
  });

  it("🟢 el payload real de unirse a una comunidad pública SÍ pasa", async () => {
    await seed("groups/g_m01d", { ownerId: OWNER, visibility: "public", isActive: true });
    const db = testEnv.authenticatedContext("visitante").firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "groups/g_m01d/members/visitante"),
        membresiaMiembroReal("visitante")
      )
    );
  });

  it("🔴 no se puede nacer con un campo de sanción falseado", async () => {
    await seed("groups/g_m01e", { ownerId: OWNER, visibility: "public", isActive: true });
    const db = testEnv.authenticatedContext("visitante").firestore();
    await assertFails(
      setDoc(
        doc(db, "groups/g_m01e/members/visitante"),
        membresiaMiembroReal("visitante", { mutedUntil: null, removedAt: null })
      )
    );
  });

  it("🟢 la reserva de handle real SÍ pasa, y con un campo de más NO", async () => {
    const db = testEnv.authenticatedContext("u_handle").firestore();

    // El handle tiene que coincidir con el del perfil que se crea en el mismo lote.
    await seed("users/u_handle", { uid: "u_handle", handle: "luis" });

    await assertSucceeds(
      setDoc(doc(db, "handles/luis"), {
        uid: "u_handle",
        handle: "luis",
        createdAt: ahora,
      })
    );

    await seed("users/u_handle2", { uid: "u_handle2", handle: "luis2" });
    const db2 = testEnv.authenticatedContext("u_handle2").firestore();
    await assertFails(
      setDoc(doc(db2, "handles/luis2"), {
        uid: "u_handle2",
        handle: "luis2",
        createdAt: ahora,
        reservedForever: true,
      })
    );
  });

  it("🟢 el registro real de una sesión SÍ pasa, y con un campo de más NO", async () => {
    const db = testEnv.authenticatedContext("u_sesion").firestore();

    await assertSucceeds(
      setDoc(doc(db, "users/u_sesion/sessions/s1"), {
        userAgent: "Mozilla/5.0",
        deviceLabel: "Chrome en Windows",
        timezone: "America/Mexico_City",
        locationLabel: "México",
        createdAt: ahora,
        lastSeenAt: ahora,
        revoked: false,
        revokedAt: null,
      })
    );

    await assertFails(
      setDoc(doc(db, "users/u_sesion/sessions/s2"), {
        userAgent: "Mozilla/5.0",
        deviceLabel: "Chrome en Windows",
        timezone: "America/Mexico_City",
        locationLabel: "México",
        createdAt: ahora,
        lastSeenAt: ahora,
        revoked: false,
        revokedAt: null,
        trusted: true,
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M01 — esquema cerrado en contenido y telemetría (los 10 restantes).
//
// Mismo criterio que arriba: se escribe el payload EXACTO del cliente y se
// comprueba que pasa, más el mismo con un campo de más y se comprueba que no.
// Estos son documentos de uno o dos campos, así que el riesgo de equivocarse en
// la lista es bajo — pero es justo donde nadie lo revisaría después.
// ─────────────────────────────────────────────────────────────────────────────
describe("M01 — esquema cerrado en contenido y telemetría", () => {
  const AUTOR = "autor_m01b";
  const POST = "p_m01b";
  const ahora = new Date();

  async function sembrarPost() {
    await seed(`posts/${POST}`, {
      authorId: AUTOR,
      contextType: "profile",
      profileId: AUTOR,
      profileRestricted: false,
      isDeleted: false,
      text: "hola",
    });
  }

  it("🟢 registrar una vista SÍ pasa, y con un campo de más NO", async () => {
    await sembrarPost();
    const db = testEnv.authenticatedContext("lector").firestore();

    await assertSucceeds(
      setDoc(doc(db, `posts/${POST}/views/lector`), { viewedAt: ahora })
    );
    await assertFails(
      setDoc(doc(db, `posts/${POST}/views/lector`), { viewedAt: ahora, veces: 99 })
    );
  });

  it("🟢 la presencia de un espectador de directo SÍ pasa, y con un campo de más NO", async () => {
    await sembrarPost();
    const db = testEnv.authenticatedContext("espectador").firestore();

    await assertSucceeds(
      setDoc(doc(db, `posts/${POST}/liveViewers/espectador`), {
        uid: "espectador",
        isGuest: false,
        joinedAt: ahora,
      })
    );
    await assertFails(
      setDoc(doc(db, `posts/${POST}/liveViewers/espectador2`), {
        uid: "espectador2",
        isGuest: false,
        joinedAt: ahora,
        vip: true,
      })
    );
  });

  it("🟢 el registro de espectador único SÍ pasa, incluido el tiempo visto", async () => {
    await sembrarPost();
    const db = testEnv.authenticatedContext("unico").firestore();

    await assertSucceeds(
      setDoc(doc(db, `posts/${POST}/liveUniqueViewers/unico`), {
        uid: "unico",
        isGuest: true,
      })
    );
    await assertSucceeds(
      setDoc(
        doc(db, `posts/${POST}/liveUniqueViewers/unico`),
        { uid: "unico", watchSeconds: 30 },
        { merge: true }
      )
    );
  });

  it("🟢 el historial de edición de un post SÍ pasa con sus medios anteriores", async () => {
    await sembrarPost();
    const db = testEnv.authenticatedContext(AUTOR).firestore();

    await assertSucceeds(
      setDoc(doc(db, `posts/${POST}/editHistory/h1`), {
        editedAt: ahora,
        editedBy: AUTOR,
        previousText: "antes",
        previousMedia: [],
      })
    );
    await assertFails(
      setDoc(doc(db, `posts/${POST}/editHistory/h2`), {
        editedAt: ahora,
        editedBy: AUTOR,
        previousText: "antes",
        previousMedia: [],
        motivo: "porque sí",
      })
    );
  });

  it("🟢 el token de push SÍ pasa, y con un campo de más NO", async () => {
    const db = testEnv.authenticatedContext("u_push").firestore();

    await assertSucceeds(
      setDoc(doc(db, "users/u_push/fcmTokens/tok1"), {
        token: "tok1",
        platform: "Win32",
        userAgent: "Mozilla/5.0",
        createdAt: ahora,
        updatedAt: ahora,
      })
    );
    await assertFails(
      setDoc(doc(db, "users/u_push/fcmTokens/tok2"), {
        token: "tok2",
        platform: "Win32",
        userAgent: "Mozilla/5.0",
        createdAt: ahora,
        updatedAt: ahora,
        prioridad: "alta",
      })
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7-A3 — el índice de búsqueda tiene que decir lo mismo que la comunidad.
//
// `validGroupSearchIndex` comprobaba los TIPOS de cada campo pero no que
// concordaran con el documento: era válido guardar la comunidad como `hidden` y
// declarar a la vez `search.visibility: "public"` y `search.discoverable: true`.
// Y el descubrimiento decide con el índice —`allow list` filtra por esos campos—,
// así que una comunidad oculta podía aparecer en resultados de búsqueda.
// ─────────────────────────────────────────────────────────────────────────────
describe("B7-A3 — índice de búsqueda coherente con la visibilidad", () => {
  const DUENO = "dueno_a3";
  const ahora = new Date();

  function indice(extra: Record<string, unknown> = {}) {
    return {
      nameNormalized: "mi comunidad",
      descriptionNormalized: "",
      categoryNormalized: "otros",
      categoryLabelNormalized: "otros",
      tagsNormalized: [],
      tokens: ["mi", "comunidad"],
      prefixes: ["mi", "co"],
      visibility: "hidden",
      discoverable: false,
      isActive: true,
      version: 1,
      updatedAt: ahora,
      ...extra,
    };
  }

  function comunidad(visibility: string, search: Record<string, unknown>) {
    return {
      name: "Mi comunidad",
      description: "",
      ownerId: DUENO,
      visibility,
      discoverable: visibility === "public",
      isActive: true,
      imageUrl: null,
      coverUrl: null,
      avatarUrl: null,
      category: "otros",
      tags: [],
      permissions: { postingMode: "members", commentsEnabled: true },
      monetization: { isPaid: false, subscriptionsEnabled: false },
      greetingsEnabled: false,
      welcomeMessage: null,
      ageMin: null,
      ageMax: null,
      search,
      createdAt: ahora,
      updatedAt: ahora,
    };
  }

  it("🔴 una comunidad OCULTA no puede declararse pública en su índice", async () => {
    const db = testEnv.authenticatedContext(DUENO).firestore();
    await assertFails(
      setDoc(
        doc(db, "groups/g_a3_mentirosa"),
        comunidad("hidden", indice({ visibility: "public", discoverable: true }))
      )
    );
  });

  it("🔴 tampoco puede declararse descubrible", async () => {
    const db = testEnv.authenticatedContext(DUENO).firestore();
    await assertFails(
      setDoc(
        doc(db, "groups/g_a3_descubrible"),
        comunidad("hidden", indice({ visibility: "hidden", discoverable: true }))
      )
    );
  });

  it("🟢 una comunidad oculta con su índice coherente SÍ se crea", async () => {
    const db = testEnv.authenticatedContext(DUENO).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "groups/g_a3_coherente"),
        comunidad("hidden", indice({ visibility: "hidden", discoverable: false }))
      )
    );
  });

  it("🟢 y una pública con el suyo también", async () => {
    const db = testEnv.authenticatedContext(DUENO).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "groups/g_a3_publica"),
        comunidad("public", indice({ visibility: "public", discoverable: true }))
      )
    );
  });

  it("🔴 no se puede volver oculta dejando el índice en público", async () => {
    // El caso que de verdad ocurre: la comunidad nace pública y luego se cierra.
    await seed("groups/g_a3_update", {
      ...comunidad("public", indice({ visibility: "public", discoverable: true })),
    });

    const db = testEnv.authenticatedContext(DUENO).firestore();
    await assertFails(
      setDoc(
        doc(db, "groups/g_a3_update"),
        { visibility: "hidden", discoverable: false },
        { merge: true }
      )
    );
  });
});
