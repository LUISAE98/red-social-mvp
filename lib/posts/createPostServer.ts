// Puente hacia el callable `createPost` del backend.
//
// Publicar dejó de ser una escritura directa a Firestore: `posts` es ahora
// `create: if false` y el documento lo escribe `backend/src/createPost.ts`, que
// sobrescribe autor, contexto, visibilidad, índice de búsqueda y fechas, y
// además lleva el contador de ritmo en la MISMA transacción. Antes eran dos
// pasos sueltos y bastaba con no dar el primero.
//
// ⚠️ El borrador viaja como JSON, así que hay que sanearlo antes de mandarlo:
//   • los centinelas de `FieldValue` (`serverTimestamp()`) no sobreviven al
//     viaje — se descartan, porque el servidor pone sus propias fechas;
//   • los `Timestamp` y `Date` se marcan con `__ts__` en milisegundos y el
//     servidor los reconstruye. Sin esto, `scheduledStartAt` de un directo
//     llegaría como un mapa `{seconds, nanoseconds}` y se guardaría como mapa,
//     no como fecha.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

/** Marca de fecha que entiende el servidor. Debe coincidir con `TS_KEY` en `backend/src/createPost.ts`. */
const TS_KEY = "__ts__";

function esCentinelaFieldValue(value: object): boolean {
  return typeof (value as { _methodName?: unknown })._methodName === "string";
}

function esTimestamp(value: object): boolean {
  return typeof (value as { toMillis?: unknown }).toMillis === "function";
}

/** `undefined` como retorno significa "quita esta clave". */
function sanear(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (value instanceof Date) {
    return { [TS_KEY]: value.getTime() };
  }

  if (typeof value === "object") {
    if (esCentinelaFieldValue(value)) return undefined;
    if (esTimestamp(value)) {
      return { [TS_KEY]: (value as { toMillis: () => number }).toMillis() };
    }

    if (Array.isArray(value)) {
      return value.map((item) => {
        const saneado = sanear(item);
        return saneado === undefined ? null : saneado;
      });
    }

    const salida: Record<string, unknown> = {};
    for (const [clave, bruto] of Object.entries(value as Record<string, unknown>)) {
      const saneado = sanear(bruto);
      if (saneado !== undefined) salida[clave] = saneado;
    }
    return salida;
  }

  return value;
}

type RespuestaCreatePost = { postId: string };

/**
 * Crea la publicación en el servidor y devuelve su id.
 *
 * @param postId  Id fijado de antemano (flujo de video: Mux ya lo reservó).
 */
export async function createPostOnServer(
  draft: Record<string, unknown>,
  postId?: string | null,
): Promise<string> {
  const callable = httpsCallable<
    { post: unknown; postId?: string },
    RespuestaCreatePost
  >(functions, "createPost");

  try {
    const resultado = await callable({
      post: sanear(draft) as Record<string, unknown>,
      ...(postId ? { postId } : {}),
    });
    return resultado.data.postId;
  } catch (err: unknown) {
    // Los `HttpsError` del backend llegan prefijados ("functions/permission-denied").
    // El mensaje ya viene redactado para el usuario, así que se propaga tal cual.
    const message = (err as { message?: string })?.message;
    throw new Error(message || "No se pudo publicar. Inténtalo de nuevo.");
  }
}
