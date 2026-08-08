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
    // 20s se quedaba corto al pasar de 3 a 4 archivos: arrancan en paralelo y
    // el primer test de cada uno espera a que su propio firebase-admin termine
    // de inicializar contra un emulador compartido (los `import` tardan ~50s
    // sumados). No es lentitud del test, es contención de arranque.
    testTimeout: 45000,
    hookTimeout: 45000,
    // Cada archivo en su propio proceso aislado (pool forks, isolate). Así cada
    // uno inicializa su propia instancia de firebase-admin / firebase-functions-test
    // sin interferir con los demás. Los tests usan ids únicos, así que compartir el
    // emulador no genera colisiones. Evita el "failed to find the runner" que
    // aparecía intermitentemente al reusar un worker compartido.
    pool: "forks",
    isolate: true,
  },
});
