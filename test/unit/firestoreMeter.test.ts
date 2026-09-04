/**
 * El medidor de lecturas de Firestore envuelve el camino caliente de TODA la
 * base de datos cuando está encendido. Si envuelve mal, el fallo no se ve como
 * un error: se ve como datos que no llegan, y eso es lo peor que puede hacer un
 * instrumento de medición.
 *
 * Lo que se comprueba aquí es que el envoltorio sea transparente —los argumentos
 * llegan intactos, el valor devuelto es el original, cancelar sigue cancelando—
 * y que el conteo sea el que dice ser.
 *
 * `@firebase/firestore` se sustituye por un doble: el medidor solo necesita que
 * existan esas seis funciones, y así el test no toca red ni emulador.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const dobles = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getDocFromServer: vi.fn(),
  getDocsFromServer: vi.fn(),
  getCountFromServer: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock("@firebase/firestore", () => dobles);

// El medidor solo se activa en navegador; el test finge uno mínimo.
vi.stubGlobal("window", { location: { pathname: "/inicio" } });

const medidorModulo = await import("@/lib/dev/firestoreMeter");
const { getDoc, getDocs, onSnapshot } = medidorModulo;

type Medidor = {
  reiniciar: () => void;
  resumen: () => {
    consultas: number;
    escuchasAbiertas: number;
    docs: number;
    desdeCache: number;
  };
};

function medidor(): Medidor {
  return (globalThis as unknown as { __vibraFsMeter: Medidor }).__vibraFsMeter;
}

/** Instantánea de consulta como la que devuelve Firestore. */
function snapshotDeConsulta(size: number, fromCache = false) {
  return { size, metadata: { fromCache } };
}

/** Instantánea de documento suelto. */
function snapshotDeDoc(existe: boolean, fromCache = false) {
  return { exists: () => existe, metadata: { fromCache } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // La primera lectura crea el medidor; a partir de ahí se reinicia entre tests.
  medidor()?.reiniciar();
});

describe("lecturas de un disparo", () => {
  it("devuelve intacto lo que devuelve Firestore y pasa los argumentos tal cual", async () => {
    const esperado = snapshotDeConsulta(3);
    dobles.getDocs.mockResolvedValue(esperado);

    const consulta = { path: "users/abc/homeFeed" };
    const resultado = await getDocs(consulta as never);

    expect(resultado).toBe(esperado);
    expect(dobles.getDocs).toHaveBeenCalledWith(consulta);
  });

  it("cuenta una consulta y los documentos que trajo", async () => {
    dobles.getDocs.mockResolvedValue(snapshotDeConsulta(7));

    await getDocs({ path: "posts" } as never);

    const r = medidor().resumen();
    expect(r.consultas).toBe(1);
    expect(r.docs).toBe(7);
  });

  it("un documento que existe cuenta como uno, y como cero si no existe", async () => {
    dobles.getDoc.mockResolvedValueOnce(snapshotDeDoc(true));
    dobles.getDoc.mockResolvedValueOnce(snapshotDeDoc(false));

    await getDoc({ path: "users/abc" } as never);
    await getDoc({ path: "users/xyz" } as never);

    const r = medidor().resumen();
    expect(r.consultas).toBe(2);
    expect(r.docs).toBe(1);
  });

  it("distingue lo que vino de la caché local de lo que fue a la red", async () => {
    dobles.getDocs.mockResolvedValueOnce(snapshotDeConsulta(2, true));
    dobles.getDocs.mockResolvedValueOnce(snapshotDeConsulta(2, false));

    await getDocs({ path: "a" } as never);
    await getDocs({ path: "b" } as never);

    expect(medidor().resumen().desdeCache).toBe(1);
  });
});

describe("escuchas en vivo", () => {
  it("cuenta el alta y deja la escucha marcada como abierta", () => {
    dobles.onSnapshot.mockReturnValue(() => {});

    onSnapshot({ path: "groups" } as never, () => {});

    const r = medidor().resumen();
    expect(r.consultas).toBe(1);
    expect(r.escuchasAbiertas).toBe(1);
  });

  it("cancelar cierra la escucha y llama a la cancelación real", () => {
    const cancelarReal = vi.fn();
    dobles.onSnapshot.mockReturnValue(cancelarReal);

    const cancelar = onSnapshot({ path: "groups" } as never, () => {});
    expect(medidor().resumen().escuchasAbiertas).toBe(1);

    cancelar();

    expect(cancelarReal).toHaveBeenCalledTimes(1);
    expect(medidor().resumen().escuchasAbiertas).toBe(0);
  });

  it("entrega el dato al callback original y suma sus documentos", () => {
    let entregar: ((snap: unknown) => void) | null = null;
    dobles.onSnapshot.mockImplementation((...args: unknown[]) => {
      entregar = args[1] as (snap: unknown) => void;
      return () => {};
    });

    const recibido: unknown[] = [];
    onSnapshot({ path: "groups" } as never, (snap: unknown) => recibido.push(snap));

    const primera = snapshotDeConsulta(4);
    entregar!(primera);

    expect(recibido).toEqual([primera]);

    const r = medidor().resumen();
    // El alta cuenta como consulta; la entrega NO vuelve a contar como consulta,
    // pero sus documentos sí suman.
    expect(r.consultas).toBe(1);
    expect(r.docs).toBe(4);
  });

  it("las reentregas suman documentos sin inflar el número de consultas", () => {
    let entregar: ((snap: unknown) => void) | null = null;
    dobles.onSnapshot.mockImplementation((...args: unknown[]) => {
      entregar = args[1] as (snap: unknown) => void;
      return () => {};
    });

    onSnapshot({ path: "groups" } as never, () => {});
    entregar!(snapshotDeConsulta(2));
    entregar!(snapshotDeConsulta(3));
    entregar!(snapshotDeConsulta(1));

    const r = medidor().resumen();
    expect(r.consultas).toBe(1);
    expect(r.docs).toBe(6);
  });

  it("NO envuelve el callback de error: solo el primero es el de datos", () => {
    const alFallar = vi.fn();
    dobles.onSnapshot.mockReturnValue(() => {});

    onSnapshot({ path: "groups" } as never, () => {}, alFallar);

    // El tercer argumento tiene que llegar a Firestore siendo el MISMO objeto:
    // envolverlo contaría entregas que nunca hubo.
    const argumentos = dobles.onSnapshot.mock.calls[0];
    expect(argumentos[2]).toBe(alFallar);
  });

  it("acepta la forma de observador con `next`", () => {
    let observadorPasado: { next: (s: unknown) => void } | null = null;
    dobles.onSnapshot.mockImplementation((...args: unknown[]) => {
      observadorPasado = args[1] as { next: (s: unknown) => void };
      return () => {};
    });

    const recibido: unknown[] = [];
    onSnapshot({ path: "groups" } as never, {
      next: (snap: unknown) => recibido.push(snap),
    } as never);

    const snap = snapshotDeConsulta(5);
    observadorPasado!.next(snap);

    expect(recibido).toEqual([snap]);
    expect(medidor().resumen().docs).toBe(5);
  });
});

describe("reinicio por pantalla", () => {
  it("pone a cero el conteo, que es lo que hace el marcador al navegar", async () => {
    dobles.getDocs.mockResolvedValue(snapshotDeConsulta(9));
    await getDocs({ path: "posts" } as never);
    expect(medidor().resumen().consultas).toBe(1);

    medidor().reiniciar();

    const r = medidor().resumen();
    expect(r.consultas).toBe(0);
    expect(r.docs).toBe(0);
  });
});
