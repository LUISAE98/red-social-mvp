/**
 * Filtro de mensajes técnicos antes de enseñarlos a una persona.
 *
 * Los `catch` del producto hacen `setError(e.message)` y ese texto acaba en un
 * VibraToast. Cuando el error viene del SDK de Firestore, `e.message` NO es una
 * frase: es el volcado interno con la traza y las URL de los chunks. En
 * pantalla se veía media pantalla de `firebase_firestore_dist_index_esm...`.
 *
 * En vez de perseguir los ~185 sitios que leen `.message`, se filtra en el
 * único punto por el que pasan todos: el toast. Lo que parece técnico se
 * sustituye por una frase entendible; lo que ya era una frase se respeta,
 * porque el backend sí manda mensajes escritos para leerse.
 */

/** Señales de que el texto es un volcado interno y no un mensaje para leer. */
const SENALES: RegExp[] = [
  /https?:\/\//i,                    // URLs de chunks o del SDK
  /\bat\s+[A-Za-z_$][\w$.]*\s*\(/,   // marcos de pila: "at Foo ("
  /_dist_index|node_modules|webpack|__PRIVATE_/i,
  /\.(js|ts|tsx|mjs|cjs):\d+/,       // archivo:línea
  /\bFIRESTORE\b|\[code=|@firebase\//i,
  /\bError:\s.*\bError:\s/,          // errores anidados
];

/**
 * Códigos crudos de Firebase que a veces llegan como mensaje entero.
 *
 * Cuando una callable falla antes de ejecutarse, el SDK lanza un error cuyo
 * `message` es literalmente el código —"internal", "unavailable"— y el `catch`
 * del producto lo pinta tal cual. Son cortos y sin señales técnicas, así que
 * el resto del filtro los dejaba pasar.
 */
const CODIGOS_CRUDOS = new Set([
  "internal", "unknown", "unavailable", "cancelled", "aborted", "data-loss",
  "deadline-exceeded", "resource-exhausted", "unauthenticated", "not-found",
  "permission-denied", "failed-precondition", "invalid-argument",
  "already-exists", "out-of-range", "unimplemented",
]);

/** Un mensaje para leer no ocupa un párrafo ni trae saltos de línea. */
const LARGO_MAXIMO = 220;

export function esMensajeTecnico(texto: string): boolean {
  const t = texto.trim();
  if (!t) return false;
  if (CODIGOS_CRUDOS.has(t.toLowerCase().replace(/^functions\//, ""))) return true;
  if (t.length > LARGO_MAXIMO) return true;
  if (/\n/.test(t)) return true;
  return SENALES.some((re) => re.test(t));
}

/**
 * Devuelve el texto si se puede enseñar, o `respaldo` si es un volcado técnico.
 * `respaldo` lo pone quien llama, ya traducido.
 */
export function mensajeSeguro(texto: string | null | undefined, respaldo: string): string {
  if (!texto) return respaldo;
  return esMensajeTecnico(texto) ? respaldo : texto.trim();
}
