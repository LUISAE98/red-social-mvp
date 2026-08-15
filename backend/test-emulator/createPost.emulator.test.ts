import { describe, it, expect, beforeAll } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import functionsTest from "firebase-functions-test";

import { createPost } from "../src/createPost";

// ─────────────────────────────────────────────────────────────────────────────
// B4-C03 y B4-C05 — los criterios que se movieron de las reglas al callable.
//
// Por qué existe este archivo: `posts` pasó a `create: if false` y ahora el
// documento lo escribe `createPost` con el Admin SDK, que NO pasa por las
// Firestore Rules. Los criterios que antes vivían en `validCreatePost()` —no
// colarse en la comunidad de otro (C03), que solo el dueño monetice (C05)—
// siguen aplicándose, pero ninguna prueba de reglas puede ejercitarlos ya: al
// cerrar la puerta, sus tests antiguos pasaron a verificar solo que está
// cerrada. Este hueco estaba anotado en AUDITORIAS.md y es lo que se cubre aquí.
//
// Se dispara el callable con `firebase-functions-test` contra el emulador de
// Firestore, sin emulador de Functions: lo que se prueba es la lógica de
// autorización, no el transporte HTTPS.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();
const testEnv = functionsTest();

const llamar = testEnv.wrap(createPost);

function uid(): string {
  return crypto.randomUUID();
}

/** Sesión de cuenta REAL. El proveedor importa: un anónimo no publica. */
function auth(userId: string) {
  return {
    uid: userId,
    token: {
      firebase: { sign_in_provider: "password" },
    } as unknown as Record<string, unknown>,
  };
}

async function sembrarUsuario(userId: string, extra: Record<string, unknown> = {}) {
  await db.doc(`users/${userId}`).set({
    uid: userId,
    displayName: "Usuario " + userId.slice(0, 4),
    handle: "u" + userId.slice(0, 6),
    ...extra,
  });
}

async function sembrarComunidad(
  groupId: string,
  ownerId: string,
  extra: Record<string, unknown> = {}
) {
  await db.doc(`groups/${groupId}`).set({
    ownerId,
    name: "Comunidad",
    visibility: "public",
    isActive: true,
    ...extra,
  });
}

async function sembrarMiembro(groupId: string, userId: string, status = "active") {
  await db.doc(`groups/${groupId}/members/${userId}`).set({
    userId,
    roleInGroup: "member",
    status,
  });
}

/** Borrador mínimo de post de texto. */
function borrador(extra: Record<string, unknown> = {}) {
  return {
    text: "hola",
    postType: "text",
    media: [],
    ...extra,
  };
}

async function crear(userId: string, post: Record<string, unknown>) {
  return llamar({ data: { post }, auth: auth(userId) } as never);
}

/** Ejecuta y devuelve el código de error del HttpsError, o null si pasó. */
async function codigoDeError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as { code?: string })?.code ?? "desconocido";
  }
}

describe("createPost — B4-C03: no colarse en la comunidad de otro", () => {
  let extrano: string;
  let dueno: string;
  let grupo: string;

  beforeAll(async () => {
    extrano = uid();
    dueno = uid();
    grupo = uid();
    await sembrarUsuario(extrano);
    await sembrarUsuario(dueno);
    await sembrarComunidad(grupo, dueno);
  });

  it("🔴 un no-miembro NO puede publicar en una comunidad ajena", async () => {
    const codigo = await codigoDeError(() =>
      crear(extrano, borrador({ contextType: "group", groupId: grupo }))
    );
    expect(codigo).toBe("permission-denied");
  });

  it("🔴 un post de PERFIL que además trae groupId no acaba en la comunidad", async () => {
    // El truco original de C03: contextType "profile" con el groupId de otro.
    // El servidor resuelve el contexto por su cuenta, así que el groupId sobra.
    const res = (await crear(
      extrano,
      borrador({ contextType: "profile", profileId: extrano, groupId: grupo })
    )) as { postId: string };

    const post = (await db.doc(`posts/${res.postId}`).get()).data() ?? {};
    expect(post.contextType).toBe("profile");
    expect(post.groupId).toBeNull();
    expect(post.profileId).toBe(extrano);
  });

  it("🔴 no puede publicar en el PERFIL de otro", async () => {
    const codigo = await codigoDeError(() =>
      crear(extrano, borrador({ contextType: "profile", profileId: dueno }))
    );
    expect(codigo).toBe("permission-denied");
  });

  it("🟢 un miembro activo SÍ publica en la comunidad", async () => {
    const miembro = uid();
    await sembrarUsuario(miembro);
    await sembrarMiembro(grupo, miembro);

    const res = (await crear(
      miembro,
      borrador({ contextType: "group", groupId: grupo })
    )) as { postId: string };

    const post = (await db.doc(`posts/${res.postId}`).get()).data() ?? {};
    expect(post.groupId).toBe(grupo);
    expect(post.authorId).toBe(miembro);
  });

  it("🔴 un miembro BANEADO no publica, aunque su documento siga existiendo", async () => {
    // Al sancionar no se borra el documento de miembro, se marca. Comprobar
    // solo `exists()` fue el agujero del Bloque 3; aquí se verifica el estado.
    const baneado = uid();
    await sembrarUsuario(baneado);
    await sembrarMiembro(grupo, baneado, "banned");

    const codigo = await codigoDeError(() =>
      crear(baneado, borrador({ contextType: "group", groupId: grupo }))
    );
    expect(codigo).toBe("permission-denied");
  });
});

describe("createPost — B4-C05: solo el dueño monetiza en su comunidad", () => {
  let dueno: string;
  let miembro: string;
  let grupo: string;

  beforeAll(async () => {
    dueno = uid();
    miembro = uid();
    grupo = uid();
    await sembrarUsuario(dueno);
    await sembrarUsuario(miembro);
    await sembrarComunidad(grupo, dueno);
    await sembrarMiembro(grupo, miembro);
  });

  it("🔴 un miembro NO puede publicar contenido premium ahí", async () => {
    const codigo = await codigoDeError(() =>
      crear(
        miembro,
        borrador({
          contextType: "group",
          groupId: grupo,
          premium: { enabled: true, accessMode: "members_only" },
          oneTimePrice: 100,
        })
      )
    );
    expect(codigo).toBe("permission-denied");
  });

  it("🔴 un miembro NO puede marcarlo como de pago", async () => {
    const codigo = await codigoDeError(() =>
      crear(
        miembro,
        borrador({ contextType: "group", groupId: grupo, requiresPayment: true })
      )
    );
    expect(codigo).toBe("permission-denied");
  });

  it("🟢 el dueño SÍ puede, y el precio se valida", async () => {
    const res = (await crear(
      dueno,
      borrador({
        contextType: "group",
        groupId: grupo,
        premium: { enabled: true, accessMode: "members_only" },
        accessModel: "one_time_purchase",
        oneTimePrice: 100,
      })
    )) as { postId: string };

    const post = (await db.doc(`posts/${res.postId}`).get()).data() ?? {};
    expect(post.authorId).toBe(dueno);
    expect(post.oneTimePrice).toBe(100);
  });

  it("🔴 ni el dueño puede poner un precio fuera de rango", async () => {
    const codigo = await codigoDeError(() =>
      crear(
        dueno,
        borrador({
          contextType: "group",
          groupId: grupo,
          premium: { enabled: true, accessMode: "members_only" },
          accessModel: "one_time_purchase",
          oneTimePrice: 999999,
        })
      )
    );
    expect(codigo).toBe("invalid-argument");
  });
});

describe("createPost — el servidor manda sobre el borrador", () => {
  it("🔴 el autor y los contadores no se pueden falsear", async () => {
    const yo = uid();
    const otro = uid();
    await sembrarUsuario(yo, { displayName: "El de verdad" });
    await sembrarUsuario(otro);

    const res = (await crear(
      yo,
      borrador({
        contextType: "profile",
        profileId: yo,
        // Todo esto lo pisa el servidor.
        authorId: otro,
        authorName: "Suplantado",
        counts: { comments: 9999, likes: 9999, saves: 9999 },
        isDeleted: true,
        isPinnedInGroup: true,
      })
    )) as { postId: string };

    const post = (await db.doc(`posts/${res.postId}`).get()).data() ?? {};
    expect(post.authorId).toBe(yo);
    expect(post.authorName).toBe("El de verdad");
    expect(post.counts).toEqual({ comments: 0, likes: 0, saves: 0 });
    expect(post.isDeleted).toBe(false);
    expect(post.isPinnedInGroup).toBe(false);
  });

  it("🔴 una cuenta de invitado no publica", async () => {
    const invitado = uid();
    await sembrarUsuario(invitado);

    const codigo = await codigoDeError(() =>
      llamar({
        data: { post: borrador({ contextType: "profile", profileId: invitado }) },
        auth: {
          uid: invitado,
          token: { firebase: { sign_in_provider: "anonymous" } } as unknown as Record<
            string,
            unknown
          >,
        },
      } as never)
    );
    expect(codigo).toBe("permission-denied");
  });

  it("🔴 no se puede colgar un archivo de Storage que no es tuyo", async () => {
    const yo = uid();
    const otro = uid();
    await sembrarUsuario(yo);

    const codigo = await codigoDeError(() =>
      crear(
        yo,
        borrador({
          contextType: "profile",
          profileId: yo,
          postType: "image",
          media: [
            {
              type: "image",
              url: "https://example.com/x.jpg",
              path: `posts/profile-${otro}/${otro}/images/robada.jpg`,
            },
          ],
        })
      )
    );
    expect(codigo).toBe("permission-denied");
  });
});
