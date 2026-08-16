import { defineConfig } from "vitest/config";

// Tests de INTEGRACIÓN contra el emulador de Firestore. NO corren en la suite
// pura (`vitest run`); se lanzan con `npm run test:emulator`, que arranca el
// emulador con `firebase emulators:exec` y define FIRESTORE_EMULATOR_HOST.
//
// Cubren la contabilidad real del ledger: transacciones, idempotencia (doble
// cobro) y las transiciones de estado del summary.
export default defineConfig({
  test: {
    include: ["test-emulator/**/*.test.ts"],
    environment: "node",
    // ⚠️ Los archivos corren de UNO EN UNO. Todos hablan con el MISMO emulador, y
    // cada uno inicializa su propio firebase-admin al arrancar; en paralelo se
    // pisan y el emulador deja de responder a tiempo.
    //
    // El síntoma es inconfundible y costó dos rondas reconocerlo: fallan tests
    // DISTINTOS en cada corrida, siempre clavados en el timeout, y cada uno pasa
    // al ejecutarlo solo. Se fue subiendo el tope (20s → 45s → 90s) creyendo que
    // eran tests lentos; no lo eran. Subir el timeout solo alarga la corrida
    // antes de volver a fallar cuando se suma un archivo más.
    //
    // Secuencial tarda más de reloj pero es determinista, que es lo que se
    // necesita de una suite que decide si el dinero cuadra.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    // Cada archivo en su propio proceso aislado (pool forks, isolate). Así cada
    // uno inicializa su propia instancia de firebase-admin / firebase-functions-test
    // sin interferir con los demás. Los tests usan ids únicos, así que compartir el
    // emulador no genera colisiones. Evita el "failed to find the runner" que
    // aparecía intermitentemente al reusar un worker compartido.
    pool: "forks",
    isolate: true,
  },
});
