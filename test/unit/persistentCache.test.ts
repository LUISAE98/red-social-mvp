/**
 * El serializador de la caché persistente es el punto donde un fallo NO se ve.
 *
 * IndexedDB clona con el algoritmo de clonado estructurado, que no sabe de
 * clases: un `Timestamp` de Firestore entra como objeto plano y sale sin su
 * método `toDate()`. Los sitios que pintan fechas lo llaman, así que el error
 * no aparecería aquí sino más tarde, al renderizar una publicación restaurada
 * desde disco — y solo en la segunda visita, que es la más difícil de reproducir.
 *
 * Por eso se comprueba el viaje de ida y vuelta sobre la forma real de una
 * publicación: fechas anidadas, dentro de arreglos y con nulos por medio.
 */

import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";

import { desempaquetar, empaquetar } from "@/lib/cache/persistentCache";

/** Ida y vuelta completa, como haría IndexedDB por en medio. */
function viaje<T>(valor: T): T {
  return desempaquetar(empaquetar(valor)) as T;
}

describe("Timestamps", () => {
  it("vuelve siendo un Timestamp de verdad, con toDate() usable", () => {
    const original = Timestamp.fromDate(new Date("2026-09-03T18:30:00.000Z"));

    const vuelta = viaje({ createdAt: original });

    expect(vuelta.createdAt).toBeInstanceOf(Timestamp);
    expect(typeof vuelta.createdAt.toDate).toBe("function");
    expect(vuelta.createdAt.toDate().toISOString()).toBe(
      "2026-09-03T18:30:00.000Z"
    );
  });

  it("conserva los nanosegundos, no solo los segundos", () => {
    const original = new Timestamp(1_788_000_000, 123_456_789);

    const vuelta = viaje({ t: original });

    expect(vuelta.t.seconds).toBe(1_788_000_000);
    expect(vuelta.t.nanoseconds).toBe(123_456_789);
  });

  it("los encuentra anidados dentro de arreglos y objetos", () => {
    const t = Timestamp.fromDate(new Date("2026-01-01T00:00:00.000Z"));

    const vuelta = viaje({
      posts: [
        { id: "a", createdAt: t, media: [{ url: "x", subidoEn: t }] },
        { id: "b", createdAt: null },
      ],
      meta: { revisadoEn: t },
    });

    expect(vuelta.posts[0].createdAt).toBeInstanceOf(Timestamp);
    expect(vuelta.posts[0].media[0].subidoEn).toBeInstanceOf(Timestamp);
    expect(vuelta.meta.revisadoEn).toBeInstanceOf(Timestamp);
    expect(vuelta.posts[1].createdAt).toBeNull();
  });
});

describe("el resto de los datos", () => {
  it("deja intacto lo que ya era serializable", () => {
    const entrada = {
      id: "post-1",
      texto: "hola",
      likes: 42,
      publicado: true,
      etiquetas: ["a", "b"],
      precio: null,
      anidado: { profundo: { valor: 1 } },
    };

    expect(viaje(entrada)).toEqual(entrada);
  });

  it("no confunde un objeto que solo PARECE un Timestamp", () => {
    // Mismos campos numéricos, pero sin `toDate`: es un dato del dominio, no
    // una fecha, y tiene que volver tal cual.
    const entrada = { medida: { seconds: 5, nanoseconds: 10 } };

    const vuelta = viaje(entrada);

    expect(vuelta.medida).not.toBeInstanceOf(Timestamp);
    expect(vuelta.medida).toEqual({ seconds: 5, nanoseconds: 10 });
  });

  it("descarta instancias de clase que el clonado estructurado no soportaría", () => {
    class Cursor {
      constructor(public id: string) {}
    }

    const empaquetado = empaquetar({ posts: ["a"], cursor: new Cursor("x") }) as {
      posts: string[];
      cursor?: unknown;
    };

    // Se cae ANTES de guardar, en vez de reventar al leer. Es justo el caso del
    // cursor de Firestore, que por eso no se persiste.
    expect(empaquetado.posts).toEqual(["a"]);
    expect("cursor" in empaquetado).toBe(false);
  });

  it("no guarda `undefined`, que al leer no se distingue de una clave ausente", () => {
    const empaquetado = empaquetar({ a: 1, b: undefined }) as Record<string, unknown>;

    expect(empaquetado).toEqual({ a: 1 });
    expect("b" in empaquetado).toBe(false);
  });

  it("aguanta un arreglo vacío y un objeto vacío sin inventarse nada", () => {
    expect(viaje({ lista: [], objeto: {} })).toEqual({ lista: [], objeto: {} });
  });
});
