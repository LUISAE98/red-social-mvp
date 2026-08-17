// El freno de ritmo, escrito en el MISMO lote que la acción que frena.
//
// B8-H03 y B8-H05. Comentar y publicar historias tenían el mismo defecto: el
// freno vivía en un paso APARTE (o directamente no existía), así que bastaba con
// escribir contra Firestore sin pasar por la interfaz.
//
// Una regla de Firestore no puede exigir que ANTES ocurriera otra cosa, pero sí
// puede exigir que ocurra A LA VEZ. Las reglas de creación piden con `getAfter`
// que el contador quede escrito en el mismo lote atómico: sin contador no hay
// acción, y el contador pasa por las reglas de `/rateLimits`, que comprueban la
// espera y el tope.
//
// ⚠️ Los números viven en DOS sitios y tienen que coincidir: aquí y en
// `firestore.rules` (función `contadorAvanza`). Los de aquí son solo para poder
// dar un mensaje entendible; quien manda de verdad son las reglas. Si se
// saltara esta comprobación, la regla denegaría igual, pero con un "permiso
// denegado" seco que no le dice nada a nadie.

import {
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  type WriteBatch,
  type Transaction,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type AccionConFreno = "comment" | "story";

type Config = {
  /** Mínimo entre dos acciones. 0 = sin espera. */
  esperaMs: number;
  /** Cuánto dura la ventana antes de reiniciarse. */
  ventanaMs: number;
  /** Cuántas acciones caben en una ventana. */
  tope: number;
  mensajeEspera: (segundos: number) => string;
  mensajeTope: (tope: number) => string;
};

const HORA = 60 * 60 * 1000;

const CONFIG: Record<AccionConFreno, Config> = {
  comment: {
    esperaMs: 3_000,
    ventanaMs: HORA,
    tope: 60,
    mensajeEspera: (s) => `Espera ${s}s antes de comentar de nuevo.`,
    mensajeTope: (n) => `Alcanzaste el límite de ${n} comentarios por hora.`,
  },
  story: {
    // Sin espera entre una y otra: publicar dos seguidas es normal. Quien manda
    // aquí es el tope diario.
    esperaMs: 0,
    ventanaMs: 24 * HORA,
    tope: 20,
    mensajeEspera: (s) => `Espera ${s}s antes de publicar otra historia.`,
    mensajeTope: (n) => `Alcanzaste el límite de ${n} historias por día.`,
  },
};

export class LimiteDeRitmoError extends Error {}

export type FrenoPreparado = {
  ref: ReturnType<typeof doc>;
  datos: Record<string, unknown>;
};

/**
 * Comprueba el freno y devuelve lo que hay que escribir en el contador.
 *
 * Lanza `LimiteDeRitmoError` con un mensaje legible si toca frenar.
 */
export async function prepararFreno(
  uid: string,
  accion: AccionConFreno
): Promise<FrenoPreparado> {
  const config = CONFIG[accion];
  const ref = doc(db, "rateLimits", `${uid}_${accion}`);
  const snap = await getDoc(ref);
  const ahoraMs = Date.now();

  const ventanaNueva = () => ({
    ref,
    datos: { lastAt: serverTimestamp(), windowStart: serverTimestamp(), count: 1 },
  });

  if (!snap.exists()) return ventanaNueva();

  const actual = snap.data() as Record<string, unknown>;
  const lastAt = actual.lastAt instanceof Timestamp ? actual.lastAt.toMillis() : 0;
  const desde = ahoraMs - lastAt;

  if (config.esperaMs > 0 && desde < config.esperaMs) {
    const segundos = Math.ceil((config.esperaMs - desde) / 1000);
    throw new LimiteDeRitmoError(config.mensajeEspera(segundos));
  }

  // Un documento del formato viejo no tiene ventana: cuenta como ventana nueva.
  const windowStart = actual.windowStart instanceof Timestamp ? actual.windowStart : null;
  const vigente = windowStart !== null && ahoraMs - windowStart.toMillis() < config.ventanaMs;

  if (!vigente) return ventanaNueva();

  const cuenta = typeof actual.count === "number" ? actual.count : 0;

  if (cuenta >= config.tope) {
    throw new LimiteDeRitmoError(config.mensajeTope(config.tope));
  }

  return {
    ref,
    // ⚠️ Se reescribe el MISMO `windowStart`, no uno nuevo: la regla exige que
    // sea idéntico al que ya había. Cambiarlo sería empezar otra ventana, que es
    // justo la forma de no llegar nunca al tope.
    datos: { lastAt: serverTimestamp(), windowStart, count: cuenta + 1 },
  };
}

/**
 * Añade el contador al lote de la acción.
 *
 * ⚠️ Las sobrecargas de `set` de `WriteBatch` y `Transaction` no son compatibles
 * entre sí para TypeScript, así que la unión no se puede llamar directamente. Se
 * separan los dos casos en vez de forzar con `any`.
 */
export function aplicarFreno(
  destino: WriteBatch | Transaction,
  preparado: FrenoPreparado
): void {
  if ("commit" in destino) {
    (destino as WriteBatch).set(preparado.ref, preparado.datos);
    return;
  }

  (destino as Transaction).set(preparado.ref, preparado.datos);
}
