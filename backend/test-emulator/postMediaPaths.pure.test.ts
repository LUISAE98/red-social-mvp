import { describe, it, expect } from "vitest";

import {
  contextoDeStorage,
  prefijoDeMedios,
  rutaPerteneceAlPost,
  separarRutas,
} from "../src/postMediaPaths";
import { rutasDelPost, separarRutasDelPost } from "../src/postMediaCleanup";

// ─────────────────────────────────────────────────────────────────────────────
// B8-C01 — el autor podía reclamar archivos ajenos como suyos.
//
// `media` se reescribe al editar y las Firestore Rules no saben validar los
// elementos de una lista. Con una ruta ajena metida ahí, `getRestrictedMediaUrls`
// la FIRMABA y `postMediaCleanup` la BORRABA, las dos con privilegios de
// administrador. Lectura y borrado de cualquier archivo del bucket.
//
// Estas pruebas son puras a propósito: la decisión de qué ruta es legítima no
// necesita emulador y conviene que se pueda leer de un vistazo.
// ─────────────────────────────────────────────────────────────────────────────

const AUTOR = "uAutor";
const OTRO = "uOtro";

const postDeComunidad = { authorId: AUTOR, groupId: "g1" };
const postDePerfil = { authorId: AUTOR };

describe("contexto y prefijo", () => {
  it("una publicación de comunidad usa el id de la comunidad", () => {
    expect(contextoDeStorage(postDeComunidad)).toBe("g1");
    expect(prefijoDeMedios(postDeComunidad)).toBe(`posts/g1/${AUTOR}/`);
  });

  it("una publicación de perfil usa `profile-{uid}`", () => {
    expect(contextoDeStorage(postDePerfil)).toBe(`profile-${AUTOR}`);
    expect(prefijoDeMedios(postDePerfil)).toBe(`posts/profile-${AUTOR}/${AUTOR}/`);
  });

  it("sin autor no hay prefijo, y sin prefijo no pasa nada", () => {
    expect(prefijoDeMedios({ groupId: "g1" })).toBeNull();
    expect(rutaPerteneceAlPost("posts/g1/u/images/a.jpg", { groupId: "g1" })).toBe(false);
  });
});

describe("qué rutas acepta", () => {
  it("🟢 la ruta que construye el cliente", () => {
    expect(rutaPerteneceAlPost(`posts/g1/${AUTOR}/images/123-abc.jpg`, postDeComunidad)).toBe(true);
    expect(
      rutaPerteneceAlPost(`posts/g1/${AUTOR}/thumbnails/123-abc.jpg`, postDeComunidad)
    ).toBe(true);
  });

  it("🔴 un archivo de OTRA comunidad", () => {
    expect(rutaPerteneceAlPost(`posts/g2/${AUTOR}/images/secreto.jpg`, postDeComunidad)).toBe(false);
  });

  it("🔴 un archivo de OTRA persona en la misma comunidad", () => {
    // El uid va en la ruta, así que acertar la comunidad no basta.
    expect(rutaPerteneceAlPost(`posts/g1/${OTRO}/images/secreto.jpg`, postDeComunidad)).toBe(false);
  });

  it("🔴 otra sección entera del bucket", () => {
    expect(rutaPerteneceAlPost("avatars/otro/foto.jpg", postDeComunidad)).toBe(false);
    expect(rutaPerteneceAlPost("groupCovers/g9/portada.jpg", postDeComunidad)).toBe(false);
  });

  it("🔴 salirse del prefijo con `..` aunque empiece bien", () => {
    expect(
      rutaPerteneceAlPost(`posts/g1/${AUTOR}/../../g2/${OTRO}/images/secreto.jpg`, postDeComunidad)
    ).toBe(false);
  });

  it("🔴 un prefijo que solo se PARECE al bueno", () => {
    // `posts/g1/uAutorMalo/` empieza igual que `posts/g1/uAutor` si uno se
    // olvida de la barra final.
    expect(
      rutaPerteneceAlPost(`posts/g1/${AUTOR}Malo/images/secreto.jpg`, postDeComunidad)
    ).toBe(false);
  });

  it("🔴 lo que no es texto, o está vacío", () => {
    for (const basura of [null, undefined, 42, {}, [], ""]) {
      expect(rutaPerteneceAlPost(basura, postDeComunidad)).toBe(false);
    }
  });

  it("🔴 una publicación de perfil no alcanza las comunidades", () => {
    expect(rutaPerteneceAlPost(`posts/g1/${AUTOR}/images/a.jpg`, postDePerfil)).toBe(false);
  });
});

describe("separarRutas", () => {
  it("reparte cada ruta en su montón", () => {
    const { propias, ajenas } = separarRutas(
      [
        `posts/g1/${AUTOR}/images/mia.jpg`,
        `posts/g2/${OTRO}/images/ajena.jpg`,
        `posts/g1/${AUTOR}/thumbnails/mia.jpg`,
      ],
      postDeComunidad
    );

    expect(propias).toEqual([
      `posts/g1/${AUTOR}/images/mia.jpg`,
      `posts/g1/${AUTOR}/thumbnails/mia.jpg`,
    ]);
    expect(ajenas).toEqual([`posts/g2/${OTRO}/images/ajena.jpg`]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// El ataque completo, tal y como se ejecutaría
// ═════════════════════════════════════════════════════════════════════════════
describe("B8-C01 — el borrado no toca archivos ajenos", () => {
  it("🔴 un `media` envenenado no consigue que se borre nada ajeno", () => {
    const postEnvenenado = {
      authorId: AUTOR,
      groupId: "g1",
      media: [
        // La foto de verdad del autor.
        { path: `posts/g1/${AUTOR}/images/mia.jpg` },
        // Lo que el autor añadió a mano editando la publicación.
        { path: `posts/gPrivada/${OTRO}/images/secreto.jpg` },
        { path: "avatars/otro/perfil.jpg", thumbnailPath: "groupCovers/g9/portada.jpg" },
      ],
      videoData: { sourcePath: `posts/g2/${OTRO}/thumbnails/robada.jpg` },
    };

    const { propias, ajenas } = separarRutasDelPost(postEnvenenado);

    expect(propias).toEqual([`posts/g1/${AUTOR}/images/mia.jpg`]);
    expect(ajenas).toHaveLength(4);
    // `rutasDelPost` es lo que consume el borrado: solo lo propio.
    expect(rutasDelPost(postEnvenenado)).toEqual([`posts/g1/${AUTOR}/images/mia.jpg`]);
  });

  it("🟢 una publicación normal sigue borrando todo lo suyo", () => {
    const postNormal = {
      authorId: AUTOR,
      groupId: "g1",
      media: [
        {
          path: `posts/g1/${AUTOR}/images/a.jpg`,
          thumbnailPath: `posts/g1/${AUTOR}/thumbnails/a.jpg`,
        },
      ],
      videoData: { sourcePath: `posts/g1/${AUTOR}/thumbnails/video.jpg` },
    };

    expect(rutasDelPost(postNormal)).toEqual([
      `posts/g1/${AUTOR}/images/a.jpg`,
      `posts/g1/${AUTOR}/thumbnails/a.jpg`,
      `posts/g1/${AUTOR}/thumbnails/video.jpg`,
    ]);
  });

  it("🟢 una publicación de perfil también", () => {
    const postNormal = {
      authorId: AUTOR,
      media: [{ path: `posts/profile-${AUTOR}/${AUTOR}/images/a.jpg` }],
    };

    expect(rutasDelPost(postNormal)).toEqual([`posts/profile-${AUTOR}/${AUTOR}/images/a.jpg`]);
  });
});
