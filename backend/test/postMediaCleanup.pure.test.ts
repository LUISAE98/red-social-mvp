import { describe, it, expect } from "vitest";

import { rutasDelPost } from "../src/postMediaCleanup";

// ─────────────────────────────────────────────────────────────────────────────
// M06 (Bloque 4) — qué archivos de Storage se llevan por delante al borrar un post.
//
// Se prueba solo la recogida de rutas: es la única parte con decisiones. Borrar
// es una llamada a Storage y no necesita emulador para saber si está bien.
// ─────────────────────────────────────────────────────────────────────────────

describe("rutasDelPost", () => {
  it("recoge original y miniatura de cada imagen", () => {
    const rutas = rutasDelPost({
      media: [
        { type: "image", path: "posts/g1/u1/images/a.jpg", thumbnailPath: "posts/g1/u1/thumbnails/a.jpg" },
        { type: "image", path: "posts/g1/u1/images/b.jpg", thumbnailPath: "posts/g1/u1/thumbnails/b.jpg" },
      ],
    });

    expect(rutas.sort()).toEqual([
      "posts/g1/u1/images/a.jpg",
      "posts/g1/u1/images/b.jpg",
      "posts/g1/u1/thumbnails/a.jpg",
      "posts/g1/u1/thumbnails/b.jpg",
    ]);
  });

  it("incluye la portada del video, que vive fuera de `media`", () => {
    const rutas = rutasDelPost({
      media: [{ type: "video", thumbnailPath: "posts/g1/u1/thumbnails/cover.jpg" }],
      videoData: { provider: "mux", sourcePath: "posts/g1/u1/thumbnails/cover.jpg" },
    });

    // La misma ruta en los dos sitios no se borra dos veces.
    expect(rutas).toEqual(["posts/g1/u1/thumbnails/cover.jpg"]);
  });

  it("ignora el video de Mux, que no vive en Storage", () => {
    const rutas = rutasDelPost({
      media: [{ type: "video", url: "mux://uploads/abc123", uploadId: "abc123" }],
    });

    expect(rutas).toEqual([]);
  });

  it("aguanta un post sin medios, con `media` mal formado o vacío", () => {
    expect(rutasDelPost(undefined)).toEqual([]);
    expect(rutasDelPost({})).toEqual([]);
    expect(rutasDelPost({ media: null })).toEqual([]);
    expect(rutasDelPost({ media: [null, 3, "x", {}] })).toEqual([]);
    expect(rutasDelPost({ media: [{ path: "" }] })).toEqual([]);
  });

  it("no se inventa rutas a partir de campos que no son texto", () => {
    const rutas = rutasDelPost({
      media: [{ path: 42, thumbnailPath: { a: 1 } }],
      videoData: { sourcePath: false },
    });

    expect(rutas).toEqual([]);
  });
});
