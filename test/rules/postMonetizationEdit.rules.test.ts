import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Bloque 8 — lo que se puede cambiar DESPUÉS de publicar.
//
// C04: `createPost` garantiza tres cosas sobre el dinero —en una comunidad solo
//   cobra su creador, el precio va entre 10 y 100000, y los tres campos donde
//   vive el precio se escriben iguales— y la edición deshacía las tres.
//
// C02: la copia del post en `users/{uid}/profileFeed` se leía sin sesión
//   siquiera, incluyendo la de comunidades PRIVADAS enteras.
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

const DUENO = "uDuenoComunidad";
const MIEMBRO = "uMiembroNormal";
const GRUPO = "gComunidad";

async function comunidad() {
  await seed(`groups/${GRUPO}`, {
    ownerId: DUENO,
    visibility: "public",
    isActive: true,
  });
  for (const uid of [DUENO, MIEMBRO]) {
    await seed(`groups/${GRUPO}/members/${uid}`, {
      userId: uid,
      roleInGroup: uid === DUENO ? "owner" : "member",
      status: "active",
    });
  }
}

/** Un post de live gratis, que es el punto de partida del ataque. */
async function liveGratis(postId: string, authorId: string, groupId: string | null) {
  await seed(`posts/${postId}`, {
    authorId,
    groupId,
    contextType: groupId ? "group" : "profile",
    groupVisibility: groupId ? "public" : null,
    postType: "live",
    isDeleted: false,
    text: "Mi transmisión",
    requiresPayment: false,
    accessModel: "free",
    oneTimePrice: null,
    currency: null,
    purchaseType: null,
    isShareable: true,
    liveData: {
      hlsUrl: "https://algo.cloudflarestream.com/x.m3u8",
      accessType: "free",
      ticketPrice: null,
      visibilityMode: "everyone",
      allowLoggedOutViewers: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

function comoUsuario(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

/** Lo que escribe `updateLivePost` al poner precio a un live. */
function ponerPrecio(uid: string, postId: string, precio: number) {
  return updateDoc(doc(comoUsuario(uid), `posts/${postId}`), {
    requiresPayment: true,
    accessModel: "paid",
    oneTimePrice: precio,
    currency: "MXN",
    purchaseType: "one_time",
    "liveData.accessType": "paid",
    "liveData.ticketPrice": precio,
    editedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

describe("B8-C04 — monetizar editando", () => {
  it("🔴 un MIEMBRO normal no puede ponerle precio a su live en la comunidad de otro", async () => {
    await comunidad();
    await liveGratis("pMiembro", MIEMBRO, GRUPO);
    await assertFails(ponerPrecio(MIEMBRO, "pMiembro", 500));
  });

  it("🟢 el CREADOR de la comunidad sí puede", async () => {
    await comunidad();
    await liveGratis("pDueno", DUENO, GRUPO);
    await assertSucceeds(ponerPrecio(DUENO, "pDueno", 500));
  });

  it("🟢 en su PROPIO perfil cualquiera puede cobrar por lo suyo", async () => {
    await liveGratis("pPerfil", MIEMBRO, null);
    await assertSucceeds(ponerPrecio(MIEMBRO, "pPerfil", 500));
  });

  it("🔴 un precio por debajo del mínimo", async () => {
    await comunidad();
    await liveGratis("pBarato", DUENO, GRUPO);
    await assertFails(ponerPrecio(DUENO, "pBarato", 1));
  });

  it("🔴 un precio por encima del máximo", async () => {
    await comunidad();
    await liveGratis("pCaro", DUENO, GRUPO);
    await assertFails(ponerPrecio(DUENO, "pCaro", 999_999));
  });

  it("🔴 enseñar un precio y cobrar otro", async () => {
    // El cobro lee `oneTimePrice ?? liveData.ticketPrice`. Separarlos era la
    // forma de enseñar 10 en la tarjeta y cobrar 100000.
    await comunidad();
    await liveGratis("pMentira", DUENO, GRUPO);

    await assertFails(
      updateDoc(doc(comoUsuario(DUENO), "posts/pMentira"), {
        requiresPayment: true,
        accessModel: "paid",
        oneTimePrice: 10,
        currency: "MXN",
        purchaseType: "one_time",
        "liveData.accessType": "paid",
        "liveData.ticketPrice": 100_000,
        editedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("🔴 tampoco se separan por la puerta de atrás de `liveData`", async () => {
    // `canUpdateLivePeakViewers` / `canUpdateLiveRuntimeData` solo dejan tocar
    // `liveData`, pero el precio del ticket vive DENTRO de `liveData`.
    await comunidad();
    await seed("posts/pRendija", {
      authorId: DUENO,
      groupId: GRUPO,
      contextType: "group",
      groupVisibility: "public",
      postType: "live",
      isDeleted: false,
      requiresPayment: true,
      accessModel: "paid",
      oneTimePrice: 100,
      currency: "MXN",
      purchaseType: "one_time",
      liveData: {
        hlsUrl: "https://algo.cloudflarestream.com/x.m3u8",
        accessType: "paid",
        ticketPrice: 100,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assertFails(
      updateDoc(doc(comoUsuario(DUENO), "posts/pRendija"), {
        "liveData.ticketPrice": 90_000,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("🟢 editar un live SIN tocar el dinero sigue funcionando para cualquier autor", async () => {
    await comunidad();
    await liveGratis("pTexto", MIEMBRO, GRUPO);

    await assertSucceeds(
      updateDoc(doc(comoUsuario(MIEMBRO), "posts/pTexto"), {
        text: "Título nuevo",
        shareTitle: "Título nuevo",
        editedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("🔴 `premium` ya no se puede tocar en un post normal", async () => {
    await comunidad();
    await seed("posts/pNormal", {
      authorId: MIEMBRO,
      groupId: GRUPO,
      contextType: "group",
      groupVisibility: "public",
      postType: "text",
      isDeleted: false,
      text: "hola",
      premium: { enabled: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assertFails(
      updateDoc(doc(comoUsuario(MIEMBRO), "posts/pNormal"), {
        premium: { enabled: true, price: 5000 },
        editedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("🟢 editar el texto y los medios de un post normal sigue funcionando", async () => {
    await comunidad();
    await seed("posts/pEditable", {
      authorId: MIEMBRO,
      groupId: GRUPO,
      contextType: "group",
      groupVisibility: "public",
      postType: "text",
      isDeleted: false,
      text: "hola",
      media: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await assertSucceeds(
      updateDoc(doc(comoUsuario(MIEMBRO), "posts/pEditable"), {
        text: "hola corregido",
        media: [],
        editedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
describe("B8-C02 — la copia del perfil ya no es pública", () => {
  const AUTOR = "uAutorPrivado";
  const CURIOSO = "uCurioso";

  async function copiaDeComunidadPrivada() {
    await seed(`users/${AUTOR}/profileFeed/pPrivado`, {
      postId: "pPrivado",
      authorId: AUTOR,
      groupId: "gPrivada",
      groupVisibility: "private",
      isDeleted: false,
      text: "Esto es de una comunidad privada",
    });
  }

  function leer(ctx: ReturnType<typeof comoUsuario>) {
    return getDoc(doc(ctx, `users/${AUTOR}/profileFeed/pPrivado`));
  }

  it("🔴 alguien SIN sesión ya no puede leerla", async () => {
    await copiaDeComunidadPrivada();
    await assertFails(leer(testEnv.unauthenticatedContext().firestore()));
  });

  it("🔴 otra cuenta con sesión tampoco", async () => {
    await copiaDeComunidadPrivada();
    await assertFails(leer(comoUsuario(CURIOSO)));
  });

  it("🟢 el dueño de la copia sí la lee", async () => {
    await copiaDeComunidadPrivada();
    await assertSucceeds(leer(comoUsuario(AUTOR)));
  });
});
