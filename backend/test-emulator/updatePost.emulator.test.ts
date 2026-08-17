import { describe, it, expect } from "vitest";
import * as crypto from "crypto";
import * as admin from "firebase-admin";
import functionsTest from "firebase-functions-test";

import { updatePost } from "../src/updatePost";

// ─────────────────────────────────────────────────────────────────────────────
// B8-C01 — la otra mitad: que las rutas ajenas no se puedan ESCRIBIR.
//
// Los dos consumidores ya las ignoran (`postMediaPaths.pure.test.ts`), así que
// el ataque estaba muerto. Esto impide además que lleguen al documento.
//
// Por qué un callable y no una regla: las Firestore Rules no saben recorrer una
// lista, y `media` es una lista de objetos con rutas de Storage.
// ─────────────────────────────────────────────────────────────────────────────

if (admin.apps.length === 0) admin.initializeApp({ projectId: "demo-vibra" });
const db = admin.firestore();
const testEnv = functionsTest();

const editar = testEnv.wrap(updatePost);

function uid(): string {
  return crypto.randomUUID();
}

function auth(userId: string) {
  return {
    uid: userId,
    token: { firebase: { sign_in_provider: "password" } } as unknown as Record<string, unknown>,
  };
}

async function escenario(opciones: { groupId?: string | null } = {}) {
  const autor = uid();
  const postId = uid();
  const groupId = opciones.groupId === undefined ? uid() : opciones.groupId;
  const contexto = groupId ?? `profile-${autor}`;

  await db.doc(`posts/${postId}`).set({
    authorId: autor,
    groupId,
    contextType: groupId ? "group" : "profile",
    isDeleted: false,
    text: "original",
    media: [{ type: "image", url: "https://firebasestorage.googleapis.com/a.jpg", path: `posts/${contexto}/${autor}/images/a.jpg` }],
  });

  return { autor, postId, groupId, contexto };
}

async function codigo(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    return (error as { code?: string })?.code ?? "desconocido";
  }
}

describe("updatePost — rutas de medios", () => {
  it("🟢 el autor edita el texto y sus propios archivos", async () => {
    const e = await escenario();

    await editar({
      data: {
        postId: e.postId,
        text: "corregido",
        media: [
          {
            type: "image",
            url: "https://firebasestorage.googleapis.com/b.jpg",
            path: `posts/${e.contexto}/${e.autor}/images/b.jpg`,
          },
        ],
      },
      auth: auth(e.autor),
    } as never);

    const post = (await db.doc(`posts/${e.postId}`).get()).data() ?? {};
    expect(post.text).toBe("corregido");
    expect(post.media).toHaveLength(1);
    expect((post.media as { path: string }[])[0].path).toContain(`${e.autor}/images/b.jpg`);
  });

  it("🔴 no puede reclamar el archivo de OTRA comunidad", async () => {
    const e = await escenario();

    expect(
      await codigo(() =>
        editar({
          data: {
            postId: e.postId,
            text: "x",
            media: [
              {
                type: "image",
                url: "https://firebasestorage.googleapis.com/x.jpg",
                path: `posts/otraComunidad/${e.autor}/images/secreto.jpg`,
              },
            ],
          },
          auth: auth(e.autor),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 ni el de OTRA persona en su misma comunidad", async () => {
    const e = await escenario();
    const otro = uid();

    expect(
      await codigo(() =>
        editar({
          data: {
            postId: e.postId,
            text: "x",
            media: [
              {
                type: "image",
                url: "https://firebasestorage.googleapis.com/x.jpg",
                path: `posts/${e.contexto}/${otro}/images/secreto.jpg`,
              },
            ],
          },
          auth: auth(e.autor),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 ni por `thumbnailPath`, que es la otra ruta que se borra", async () => {
    const e = await escenario();

    expect(
      await codigo(() =>
        editar({
          data: {
            postId: e.postId,
            text: "x",
            media: [
              {
                type: "image",
                url: "https://firebasestorage.googleapis.com/x.jpg",
                path: `posts/${e.contexto}/${e.autor}/images/a.jpg`,
                thumbnailPath: "avatars/otro/perfil.jpg",
              },
            ],
          },
          auth: auth(e.autor),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 una URL externa, que sirve de baliza para registrar la IP de quien la abra", async () => {
    const e = await escenario();

    expect(
      await codigo(() =>
        editar({
          data: {
            postId: e.postId,
            text: "x",
            media: [{ type: "image", url: "https://rastreador.example.com/pixel.gif" }],
          },
          auth: auth(e.autor),
        } as never)
      )
    ).toBe("invalid-argument");
  });

  it("🟢 las URL de Mux sí pasan: el vídeo vive ahí", async () => {
    const e = await escenario();

    await editar({
      data: {
        postId: e.postId,
        text: "con video",
        media: [{ type: "video", url: "https://stream.mux.com/abc.m3u8" }],
      },
      auth: auth(e.autor),
    } as never);

    const post = (await db.doc(`posts/${e.postId}`).get()).data() ?? {};
    expect(post.media).toHaveLength(1);
  });
});

describe("updatePost — quién y qué", () => {
  it("🔴 alguien que no es el autor", async () => {
    const e = await escenario();
    expect(
      await codigo(() =>
        editar({
          data: { postId: e.postId, text: "mío ahora", media: [] },
          auth: auth(uid()),
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🔴 una publicación ya borrada", async () => {
    const e = await escenario();
    await db.doc(`posts/${e.postId}`).update({ isDeleted: true });

    expect(
      await codigo(() =>
        editar({
          data: { postId: e.postId, text: "revivida", media: [] },
          auth: auth(e.autor),
        } as never)
      )
    ).toBe("failed-precondition");
  });

  it("🔴 un texto por encima del tope", async () => {
    const e = await escenario();
    expect(
      await codigo(() =>
        editar({
          data: { postId: e.postId, text: "x".repeat(5001), media: [] },
          auth: auth(e.autor),
        } as never)
      )
    ).toBe("invalid-argument");
  });

  it("🔴 más archivos de los permitidos", async () => {
    const e = await escenario();
    const muchos = Array.from({ length: 11 }, () => ({
      type: "image",
      url: "https://firebasestorage.googleapis.com/a.jpg",
      path: `posts/${e.contexto}/${e.autor}/images/a.jpg`,
    }));

    expect(
      await codigo(() =>
        editar({
          data: { postId: e.postId, text: "x", media: muchos },
          auth: auth(e.autor),
        } as never)
      )
    ).toBe("invalid-argument");
  });

  it("🔴 una sesión de invitado", async () => {
    const e = await escenario();
    expect(
      await codigo(() =>
        editar({
          data: { postId: e.postId, text: "x", media: [] },
          auth: {
            uid: e.autor,
            token: { firebase: { sign_in_provider: "anonymous" } } as never,
          },
        } as never)
      )
    ).toBe("permission-denied");
  });

  it("🟢 los campos inventados dentro de un medio se descartan", async () => {
    const e = await escenario();

    await editar({
      data: {
        postId: e.postId,
        text: "x",
        media: [
          {
            type: "image",
            url: "https://firebasestorage.googleapis.com/a.jpg",
            path: `posts/${e.contexto}/${e.autor}/images/a.jpg`,
            campoInventado: "no debería llegar",
          },
        ],
      },
      auth: auth(e.autor),
    } as never);

    const post = (await db.doc(`posts/${e.postId}`).get()).data() ?? {};
    expect((post.media as Record<string, unknown>[])[0].campoInventado).toBeUndefined();
  });

  it("🟢 el historial de edición se escribe con el cambio", async () => {
    const e = await escenario();

    await editar({
      data: { postId: e.postId, text: "nuevo", media: [] },
      auth: auth(e.autor),
    } as never);

    const historial = await db.collection(`posts/${e.postId}/editHistory`).get();
    expect(historial.size).toBe(1);
    expect(historial.docs[0].get("previousText")).toBe("original");
    expect(historial.docs[0].get("editedBy")).toBe(e.autor);
  });

  it("🟢 una publicación de PERFIL usa su propio prefijo", async () => {
    const e = await escenario({ groupId: null });

    await editar({
      data: {
        postId: e.postId,
        text: "de perfil",
        media: [
          {
            type: "image",
            url: "https://firebasestorage.googleapis.com/p.jpg",
            path: `posts/profile-${e.autor}/${e.autor}/images/p.jpg`,
          },
        ],
      },
      auth: auth(e.autor),
    } as never);

    const post = (await db.doc(`posts/${e.postId}`).get()).data() ?? {};
    expect(post.media).toHaveLength(1);
  });
});
