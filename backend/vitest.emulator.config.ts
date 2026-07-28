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
    testTimeout: 20000,
    hookTimeout: 20000,
    // Sin paralelismo entre archivos: comparten la misma instancia de
    // firebase-admin y el emulador, así que corren en serie.
    fileParallelism: false,
  },
});
