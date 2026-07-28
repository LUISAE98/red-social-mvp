import { defineConfig } from "vitest/config";

// Tests de las Firestore Rules (@firebase/rules-unit-testing) contra el emulador.
// Se lanzan con `npm run test:rules`, que arranca el emulador con las rules reales
// (firestore.rules) y corre estas aserciones con distintos contextos de auth.
export default defineConfig({
  test: {
    include: ["test/rules/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 20000,
    pool: "forks",
    isolate: true,
  },
});
