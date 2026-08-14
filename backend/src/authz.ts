// Frontera de autorización de las funciones privilegiadas.
//
// Cada callable comprobaba el rol por su cuenta, y no todas igual: las de
// moderación exigían claim + proveedor Google, pero las de DINERO (capturar un
// cobro, resolver una devolución, healthchecks con secretos) se conformaban con
// el claim. O sea que la regla "los moderadores entran con Google" no valía
// justo donde más importa. Y dos backfills ni siquiera miraban el claim: se
// fiaban de un correo escrito en el código.
//
// Un solo sitio donde decidirlo evita que la próxima función privilegiada nazca
// con un criterio distinto.

import { HttpsError } from "firebase-functions/v2/https";

/** El dueño de la plataforma. Solo para operaciones de una sola vez. */
const OWNER_EMAIL = "luis@consumed.mx";

type CallableAuth = {
  auth?: { uid?: string; token?: Record<string, unknown> } | null;
};

function tokenOf(request: CallableAuth): Record<string, unknown> {
  return (request.auth?.token ?? {}) as Record<string, unknown>;
}

function signInProvider(request: CallableAuth): string | null {
  const firebaseClaim = tokenOf(request)["firebase"] as
    | { sign_in_provider?: string }
    | undefined;
  return firebaseClaim?.sign_in_provider ?? null;
}

/**
 * Supermoderador de plataforma: claim `role=moderator` Y sesión de Google.
 *
 * Las dos condiciones, siempre. El claim solo dice quién eres; el proveedor dice
 * cómo entraste, y es lo que sostiene el segundo factor que aplica Google.
 */
export function requirePlatformMod(request: CallableAuth): string {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
  if (tokenOf(request)["role"] !== "moderator") {
    throw new HttpsError("permission-denied", "Acceso solo para moderadores.");
  }
  if (signInProvider(request) !== "google.com") {
    throw new HttpsError(
      "permission-denied",
      "Esta operación exige haber iniciado sesión con Google."
    );
  }
  return uid;
}

/**
 * Dueño de la plataforma: lo anterior MÁS que el correo sea el suyo.
 *
 * Para migraciones y backfills, que se corren una vez y tocan la base entera.
 * Antes bastaba con el correo, sin claim ni proveedor: quien registrara esa
 * dirección en Firebase Auth heredaba el permiso.
 */
export function requirePlatformOwner(request: CallableAuth): string {
  const uid = requirePlatformMod(request);
  if (tokenOf(request)["email"] !== OWNER_EMAIL) {
    throw new HttpsError("permission-denied", "Solo administración.");
  }
  return uid;
}
