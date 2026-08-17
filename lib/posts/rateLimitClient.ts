// Llamada al control de ritmo SERVER-SIDE de publicaciones y comentarios.
//
// El conteo vive en `backend/src/rateLimiter.ts` (`checkAndRecord`), en una
// transacción sobre `rateLimits/{uid}_{accion}`. Esa colección pasó a ser de
// solo lectura para el cliente: antes el dueño podía escribir su propio
// documento y reiniciar la ventana, así que el límite era decorativo.
//
// ⚠️ RESIDUAL CONOCIDO — solo COMENTARIOS. Comentar sigue siendo una escritura
// DIRECTA a Firestore, y las reglas no pueden consultar el contador: quien llame
// a la API por su cuenta se salta esta comprobación entera.
//
// Las PUBLICACIONES ya no: `posts` es `create: if false` y todo pasa por el
// callable `createPost`, donde el contador y la escritura son la MISMA
// transacción. Cerrar los comentarios pide el mismo movimiento —moverlos a un
// callable server-authoritative—, que es un cambio de arquitectura, no un
// parche.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

// `checkRateLimitComment` se retiró: el freno de los comentarios lo llevan las
// Firestore Rules en el mismo lote que el comentario (B8-H03).
type RateLimitFn = "checkRateLimitPost";

export async function callCheckRateLimit(fn: RateLimitFn): Promise<void> {
  try {
    await httpsCallable(functions, fn)();
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    const message = (err as { message?: string })?.message;

    // `resource-exhausted` es el límite alcanzado: se propaga con el mensaje que
    // arma el servidor ("Espera 7s…", "Alcanzaste el límite de 20…").
    if (code === "functions/resource-exhausted" || code === "resource-exhausted") {
      throw new Error(message || "Vas demasiado rápido, espera un momento.");
    }

    // Cualquier otro fallo (red, función caída) NO debe impedir publicar: el
    // control de ritmo es antiabuso, no una puerta del producto.
    console.error(`[${fn}] no se pudo verificar el ritmo:`, err);
  }
}
