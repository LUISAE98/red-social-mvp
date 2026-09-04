"use client";

/**
 * Caché que SOBREVIVE a la recarga.
 *
 * Las listas de la app ya se guardaban en un `Map` a nivel de módulo, y eso
 * aguanta la navegación dentro de la pestaña pero muere en cuanto se recarga,
 * se cierra la pestaña o se vuelve de una pasarela de pago. Justo entonces —que
 * es cuando más se nota— la pantalla arrancaba de cero: consulta, hidratación de
 * autores y comunidades, estado del visor, y solo después el primer píxel.
 *
 * Esto añade el piso de abajo: IndexedDB. El `Map` sigue siendo el primer nivel
 * (es inmediato y no cuesta nada); esto se lee cuando el `Map` está vacío.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Por qué IndexedDB y no localStorage
 *
 * Una página de feed hidratada son cientos de KB. `localStorage` es SÍNCRONO
 * —bloquea el hilo de la interfaz justo mientras se pinta— y todo el origen
 * comparte unos 5 MB. IndexedDB es asíncrono y no tiene ese techo.
 *
 * Por qué hace falta serializar a mano
 *
 * IndexedDB clona con el algoritmo de clonado estructurado, que no sabe de
 * clases: un `Timestamp` de Firestore entraría como un objeto plano y saldría
 * SIN su método `toDate()`. Los ~74 sitios que pintan fechas lo llaman, así que
 * saldría al aire como un error en tiempo de ejecución. Aquí se marcan al
 * guardar y se reconstruyen al leer.
 *
 * Nada de esto puede tumbar la app: en modo privado, sin cuota o con IndexedDB
 * bloqueado, todas las funciones fallan en silencio y la pantalla sigue su
 * camino normal —consultar— como si la caché no existiera.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Timestamp } from "firebase/firestore";

const BASE = "vibra-cache";
const ALMACEN = "entradas";
const VERSION = 1;

/** Marca de un Timestamp serializado. Improbable de chocar con datos reales. */
const MARCA_TS = "__vibraTs";

type Entrada = {
  clave: string;
  valor: unknown;
  guardadoEn: number;
};

let promesaBase: Promise<IDBDatabase | null> | null = null;

function abrirBase(): Promise<IDBDatabase | null> {
  if (promesaBase) return promesaBase;

  promesaBase = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    try {
      const peticion = indexedDB.open(BASE, VERSION);

      peticion.onupgradeneeded = () => {
        const base = peticion.result;
        if (!base.objectStoreNames.contains(ALMACEN)) {
          base.createObjectStore(ALMACEN, { keyPath: "clave" });
        }
      };

      peticion.onsuccess = () => resolve(peticion.result);
      peticion.onerror = () => resolve(null);
      // Modo privado de Safari y algunos bloqueadores dejan la petición colgada
      // en vez de fallar. Sin este corte, la primera pintura esperaría para
      // siempre a una caché que no va a llegar.
      peticion.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return promesaBase;
}

// ── serialización ────────────────────────────────────────────────────────────

function esTimestamp(valor: unknown): valor is Timestamp {
  return (
    !!valor &&
    typeof valor === "object" &&
    typeof (valor as { toDate?: unknown }).toDate === "function" &&
    typeof (valor as { seconds?: unknown }).seconds === "number" &&
    typeof (valor as { nanoseconds?: unknown }).nanoseconds === "number"
  );
}

/** Convierte Timestamps en objetos planos marcados. Lo demás pasa igual. */
export function empaquetar(valor: unknown): unknown {
  if (esTimestamp(valor)) {
    return { [MARCA_TS]: true, s: valor.seconds, n: valor.nanoseconds };
  }

  if (Array.isArray(valor)) return valor.map(empaquetar);

  if (valor && typeof valor === "object") {
    // Solo objetos planos. Cualquier otra instancia de clase no sobreviviría al
    // clonado estructurado de todos modos, así que se descarta antes de guardar
    // en vez de fallar al leer.
    const proto = Object.getPrototypeOf(valor);
    if (proto !== Object.prototype && proto !== null) return undefined;

    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) {
      const empaquetado = empaquetar(v);
      if (empaquetado !== undefined) salida[k] = empaquetado;
    }
    return salida;
  }

  // `undefined` no se guarda: IndexedDB lo acepta pero al leer no se distingue
  // de una clave ausente.
  return valor === undefined ? undefined : valor;
}

/** Reconstruye los Timestamps marcados. Inversa exacta de `empaquetar`. */
export function desempaquetar(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(desempaquetar);

  if (valor && typeof valor === "object") {
    const marcado = valor as Record<string, unknown>;

    if (marcado[MARCA_TS] === true) {
      return new Timestamp(marcado.s as number, marcado.n as number);
    }

    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(marcado)) salida[k] = desempaquetar(v);
    return salida;
  }

  return valor;
}

// ── API ──────────────────────────────────────────────────────────────────────

export async function guardarEnCache(clave: string, valor: unknown): Promise<void> {
  try {
    const base = await abrirBase();
    if (!base) return;

    const empaquetado = empaquetar(valor);
    if (empaquetado === undefined) return;

    const entrada: Entrada = { clave, valor: empaquetado, guardadoEn: Date.now() };

    await new Promise<void>((resolve) => {
      const tx = base.transaction(ALMACEN, "readwrite");
      tx.objectStore(ALMACEN).put(entrada);
      tx.oncomplete = () => resolve();
      // Cuota llena o almacenamiento bloqueado: se abandona sin ruido. Perder
      // la caché es aceptable; romper la publicación no.
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* la caché nunca es motivo para tumbar una pantalla */
  }
}

/**
 * Devuelve lo guardado si no ha pasado de `maxEdadMs`, o `null`. La entrada
 * caducada se borra al leerla, para que no se quede ocupando sitio.
 */
export async function leerDeCache<T>(
  clave: string,
  maxEdadMs: number
): Promise<T | null> {
  try {
    const base = await abrirBase();
    if (!base) return null;

    const entrada = await new Promise<Entrada | null>((resolve) => {
      const tx = base.transaction(ALMACEN, "readonly");
      const peticion = tx.objectStore(ALMACEN).get(clave);
      peticion.onsuccess = () => resolve((peticion.result as Entrada) ?? null);
      peticion.onerror = () => resolve(null);
    });

    if (!entrada) return null;

    if (Date.now() - entrada.guardadoEn > maxEdadMs) {
      void borrarDeCache(clave);
      return null;
    }

    return desempaquetar(entrada.valor) as T;
  } catch {
    return null;
  }
}

export async function borrarDeCache(clave: string): Promise<void> {
  try {
    const base = await abrirBase();
    if (!base) return;

    await new Promise<void>((resolve) => {
      const tx = base.transaction(ALMACEN, "readwrite");
      tx.objectStore(ALMACEN).delete(clave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* nada que hacer */
  }
}

/** Vacía la caché entera. Se usa al cerrar sesión: los datos son de quien miraba. */
export async function vaciarCache(): Promise<void> {
  try {
    const base = await abrirBase();
    if (!base) return;

    await new Promise<void>((resolve) => {
      const tx = base.transaction(ALMACEN, "readwrite");
      tx.objectStore(ALMACEN).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    /* nada que hacer */
  }
}
