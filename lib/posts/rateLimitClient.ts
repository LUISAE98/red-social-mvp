// Llamada al control de ritmo SERVER-SIDE de publicaciones y comentarios.
//
// El conteo vive en `backend/src/rateLimiter.ts` (`checkAndRecord`), en una
// transacción sobre `rateLimits/{uid}_{accion}`. Esa colección pasó a ser de
// solo lectura para el cliente: antes el dueño podía escribir su propio
// documento y reiniciar la ventana, así que el límite era decorativo.
//
// ⚠️ RESIDUAL CONOCIDO: crear posts y comentarios sigue siendo una escritura
// DIRECTA a Firestore desde el cliente, y las reglas no consultan el contador.
// Quien llame a la API por su cuenta puede saltarse esta comprobación entera.
// Cerrarlo del todo obliga a mover la creación a un callable server-authoritative,
// que es un cambio de arquitectura en `post-service`, no un parche de seguridad.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type RateLimitFn = "checkRateLimitPost" | "checkRateLimitComment";

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
