/**
 * Medidor de lecturas de Firestore — SOLO DESARROLLO.
 *
 * Cuenta cuántas consultas abre cada pantalla, cuántos documentos trae cada una
 * y cuántas se sirvieron desde la caché local en vez de la red. Es el
 * instrumento con el que se cierran los bloques 2 y 3 del plan de rendimiento:
 * el bloque 2 baja el número de consultas y el bloque 3 sube el porcentaje que
 * viene de caché, y sin medirlo no hay forma de afirmar ninguna de las dos.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Cómo se enchufa, y por qué así
 *
 * Este módulo NO se importa desde ningún sitio. Se activa poniendo
 * `NEXT_PUBLIC_FS_METER=1` en `.env.local`, y entonces `next.config.ts` alía
 * `firebase/firestore` a este fichero. Los ~126 sitios que llaman a
 * `onSnapshot` siguen importando de `firebase/firestore` como siempre y pasan
 * por aquí sin tocar una línea.
 *
 * Se alía el paquete en vez de envolver cada llamada porque cualquier otra vía
 * exige editar 126 sitios y, peor, deja fuera los que se añadan después: el
 * medidor dejaría de decir la verdad justo cuando más se confía en él.
 *
 * ⚠️ Dentro se importa de `@firebase/firestore` (el paquete con arroba), NO de
 * `firebase/firestore`. Son el mismo código —el segundo reexporta al primero—
 * pero el alias solo captura el nombre sin arroba, así que esta es la puerta
 * trasera que evita que el módulo se alíe a sí mismo en un bucle infinito.
 *
 * `export *` deja pasar la API entera; los nombres declarados abajo la tapan
 * para las cinco funciones que leen. Es comportamiento de módulos ES: un export
 * local explícito gana al de `export *`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export * from "@firebase/firestore";

import {
  getDoc as _getDoc,
  getDocs as _getDocs,
  getDocFromServer as _getDocFromServer,
  getDocsFromServer as _getDocsFromServer,
  getCountFromServer as _getCountFromServer,
  onSnapshot as _onSnapshot,
} from "@firebase/firestore";

// ── tipos del registro ───────────────────────────────────────────────────────

export type TipoLectura =
  | "getDoc"
  | "getDocs"
  | "getDocFromServer"
  | "getDocsFromServer"
  | "getCountFromServer"
  | "onSnapshot:alta"
  | "onSnapshot:dato";

export type Lectura = {
  tipo: TipoLectura;
  /** Colección o documento consultado, si se pudo averiguar. */
  destino: string;
  /** Documentos que trajo esta lectura. */
  docs: number;
  /** `true` si Firestore la resolvió desde la caché local, sin ir a la red. */
  deCache: boolean | null;
  /** Fichero nuestro que la originó, sacado de la pila de llamadas. */
  origen: string;
  /** Ruta de la app en la que ocurrió. */
  pantalla: string;
  ts: number;
};

export type ResumenMedidor = {
  pantalla: string;
  /** Llamadas de lectura: cada `getDocs` y cada ALTA de `onSnapshot`. */
  consultas: number;
  /** Escuchas en vivo abiertas y todavía sin cerrar. */
  escuchasAbiertas: number;
  /** Documentos entregados en total, incluidas las reentregas de las escuchas. */
  docs: number;
  /** Consultas resueltas desde la caché local. */
  desdeCache: number;
  lecturas: Lectura[];
};

type EstadoMedidor = {
  activo: boolean;
  pantalla: string;
  lecturas: Lectura[];
  escuchasAbiertas: number;
  suscriptores: Set<() => void>;
  reiniciar: (pantalla?: string) => void;
  resumen: () => ResumenMedidor;
  porOrigen: () => Array<{ origen: string; consultas: number; docs: number }>;
  suscribir: (fn: () => void) => () => void;
  imprimir: () => void;
};

declare global {
  var __vibraFsMeter: EstadoMedidor | undefined;
}

// ── estado ───────────────────────────────────────────────────────────────────

const HAY_VENTANA = typeof window !== "undefined";

/** Tope de lecturas guardadas. Sin él, una escucha ruidosa se come la memoria. */
const MAX_LECTURAS = 2000;

function crearEstado(): EstadoMedidor {
  const estado: EstadoMedidor = {
    activo: true,
    pantalla: HAY_VENTANA ? window.location.pathname : "servidor",
    lecturas: [],
    escuchasAbiertas: 0,
    suscriptores: new Set(),

    reiniciar(pantalla?: string) {
      estado.lecturas = [];
      estado.escuchasAbiertas = 0;
      estado.pantalla =
        pantalla ?? (HAY_VENTANA ? window.location.pathname : "servidor");
      estado.suscriptores.forEach((fn) => fn());
    },

    resumen(): ResumenMedidor {
      const consultas = estado.lecturas.filter(
        (l) => l.tipo !== "onSnapshot:dato"
      ).length;
      const docs = estado.lecturas.reduce((acc, l) => acc + l.docs, 0);
      const desdeCache = estado.lecturas.filter((l) => l.deCache === true).length;

      return {
        pantalla: estado.pantalla,
        consultas,
        escuchasAbiertas: estado.escuchasAbiertas,
        docs,
        desdeCache,
        lecturas: estado.lecturas,
      };
    },

    porOrigen() {
      const mapa = new Map<string, { origen: string; consultas: number; docs: number }>();
      for (const lectura of estado.lecturas) {
        const fila = mapa.get(lectura.origen) ?? {
          origen: lectura.origen,
          consultas: 0,
          docs: 0,
        };
        if (lectura.tipo !== "onSnapshot:dato") fila.consultas += 1;
        fila.docs += lectura.docs;
        mapa.set(lectura.origen, fila);
      }
      return [...mapa.values()].sort((a, b) => b.consultas - a.consultas);
    },

    suscribir(fn: () => void) {
      estado.suscriptores.add(fn);
      return () => estado.suscriptores.delete(fn);
    },

    imprimir() {
      const r = estado.resumen();
      console.log(
        `%c[medidor firestore] ${r.pantalla}`,
        "font-weight:bold",
        `\n  consultas: ${r.consultas}` +
          `\n  escuchas abiertas: ${r.escuchasAbiertas}` +
          `\n  documentos: ${r.docs}` +
          `\n  desde caché: ${r.desdeCache}/${r.consultas}`
      );
      console.table(estado.porOrigen());
    },
  };

  return estado;
}

function medidor(): EstadoMedidor | null {
  if (!HAY_VENTANA) return null;
  if (!globalThis.__vibraFsMeter) globalThis.__vibraFsMeter = crearEstado();
  return globalThis.__vibraFsMeter;
}

// ── utilidades de inspección ─────────────────────────────────────────────────

/**
 * Saca de la pila de llamadas el primer fichero NUESTRO. Se descartan los
 * marcos de este medidor, los de Firebase y los de node_modules: el que queda
 * es quien pidió el dato, que es lo que interesa saber.
 */
function origenDeLaPila(): string {
  try {
    const pila = new Error().stack;
    if (!pila) return "desconocido";

    for (const linea of pila.split("\n").slice(2)) {
      if (linea.includes("firestoreMeter")) continue;
      if (linea.includes("node_modules")) continue;
      if (linea.includes("@firebase")) continue;

      // Marcos tipo "at useX (webpack-internal:///./lib/hooks/useX.ts:42:10)"
      const coincidencia = linea.match(/([\w[\]().-]+\.(?:tsx|ts|jsx|js)):(\d+)/);
      if (coincidencia) return `${coincidencia[1]}:${coincidencia[2]}`;
    }
  } catch {
    // La pila es un extra: si el navegador no la da, el medidor sigue contando.
  }
  return "desconocido";
}

/** Colección o documento consultado. La API pública no lo expone para `Query`. */
function destinoDe(referencia: unknown): string {
  try {
    const r = referencia as {
      path?: string;
      id?: string;
      _query?: { path?: { canonicalString?: () => string } };
      _key?: { path?: { canonicalString?: () => string } };
    };
    if (typeof r?.path === "string") return r.path;
    const deQuery = r?._query?.path?.canonicalString?.();
    if (deQuery) return deQuery;
    const deDoc = r?._key?.path?.canonicalString?.();
    if (deDoc) return deDoc;
    if (typeof r?.id === "string") return r.id;
  } catch {
    /* da igual: el destino es informativo */
  }
  return "?";
}

/** Documentos que trae una instantánea, sea de consulta o de documento suelto. */
function docsDe(snapshot: unknown): number {
  const s = snapshot as { size?: number; exists?: () => boolean };
  if (typeof s?.size === "number") return s.size;
  try {
    return s?.exists?.() ? 1 : 0;
  } catch {
    return 0;
  }
}

function deCacheDe(snapshot: unknown): boolean | null {
  const s = snapshot as { metadata?: { fromCache?: boolean } };
  return typeof s?.metadata?.fromCache === "boolean" ? s.metadata.fromCache : null;
}

function anotar(lectura: Omit<Lectura, "pantalla" | "ts">) {
  const m = medidor();
  if (!m || !m.activo) return;

  m.lecturas.push({
    ...lectura,
    pantalla: m.pantalla,
    ts: Date.now(),
  });

  if (m.lecturas.length > MAX_LECTURAS) m.lecturas.splice(0, m.lecturas.length - MAX_LECTURAS);
  m.suscriptores.forEach((fn) => fn());
}

/**
 * Envuelve una lectura de un disparo. El tipo público se conserva con el `as`
 * final: el `unknown[]` vive solo dentro de la envoltura, que es un paso a
 * través, y así ningún sitio que llame pierde su tipado.
 */
function envolverUnDisparo<T extends (...args: never[]) => Promise<unknown>>(
  original: T,
  tipo: TipoLectura
): T {
  return (async (...args: unknown[]) => {
    const origen = origenDeLaPila();
    const destino = destinoDe(args[0]);
    const resultado = await (original as unknown as (...a: unknown[]) => Promise<unknown>)(
      ...args
    );

    anotar({
      tipo,
      destino,
      docs: tipo === "getCountFromServer" ? 0 : docsDe(resultado),
      deCache: deCacheDe(resultado),
      origen,
    });

    return resultado;
  }) as unknown as T;
}

// ── API medida ───────────────────────────────────────────────────────────────

export const getDoc = envolverUnDisparo(_getDoc, "getDoc");
export const getDocs = envolverUnDisparo(_getDocs, "getDocs");
export const getDocFromServer = envolverUnDisparo(_getDocFromServer, "getDocFromServer");
export const getDocsFromServer = envolverUnDisparo(_getDocsFromServer, "getDocsFromServer");
export const getCountFromServer = envolverUnDisparo(
  _getCountFromServer,
  "getCountFromServer"
);

/**
 * `onSnapshot` se cuenta DOS veces y a propósito.
 *
 * El ALTA es lo que mide el bloque 2: cuántas escuchas abre una pantalla al
 * montarse, se usen o no. Cada ENTREGA mide lo que esa escucha cuesta después,
 * que es distinto —una escucha barata puede reentregar cien veces— y es lo que
 * delata a un listener que se resuscribe en bucle.
 *
 * La firma real tiene seis sobrecargas (referencia u observador, con o sin
 * opciones, con o sin callbacks de error). En vez de reproducirlas, se busca el
 * primer argumento que sea función —el `onNext`— o el objeto con `next`, y se
 * envuelve ese. Cualquier otra forma pasa intacta.
 */
export const onSnapshot = ((...args: unknown[]) => {
  const origen = origenDeLaPila();
  const destino = destinoDe(args[0]);

  anotar({ tipo: "onSnapshot:alta", destino, docs: 0, deCache: null, origen });

  const m = medidor();
  if (m) m.escuchasAbiertas += 1;

  const registrarEntrega = (snapshot: unknown) => {
    anotar({
      tipo: "onSnapshot:dato",
      destino,
      docs: docsDe(snapshot),
      deCache: deCacheDe(snapshot),
      origen,
    });
  };

  const argumentos = args.map((argumento) => {
    if (typeof argumento === "function") {
      const siguiente = argumento as (snapshot: unknown) => void;
      return (snapshot: unknown) => {
        registrarEntrega(snapshot);
        return siguiente(snapshot);
      };
    }

    if (
      argumento &&
      typeof argumento === "object" &&
      typeof (argumento as { next?: unknown }).next === "function"
    ) {
      const observador = argumento as { next: (snapshot: unknown) => void };
      return {
        ...observador,
        next: (snapshot: unknown) => {
          registrarEntrega(snapshot);
          return observador.next(snapshot);
        },
      };
    }

    return argumento;
  });

  // Solo el PRIMER callback es `onNext`; los siguientes son error y cierre, y
  // envolverlos contaría entregas que nunca hubo.
  let vistoPrimerCallback = false;
  const finales = argumentos.map((argumento, i) => {
    const original = args[i];
    const esCallback =
      typeof original === "function" ||
      (!!original &&
        typeof original === "object" &&
        typeof (original as { next?: unknown }).next === "function");

    if (!esCallback) return original;
    if (vistoPrimerCallback) return original;
    vistoPrimerCallback = true;
    return argumento;
  });

  const cancelar = (_onSnapshot as (...a: unknown[]) => () => void)(...finales);

  return () => {
    const actual = medidor();
    if (actual && actual.escuchasAbiertas > 0) {
      actual.escuchasAbiertas -= 1;
      actual.suscriptores.forEach((fn) => fn());
    }
    return cancelar();
  };
}) as unknown as typeof _onSnapshot;
