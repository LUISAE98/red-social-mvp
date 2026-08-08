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
    // Un solo emulador atiende a todas las suites, y cada una carga su propio
    // projectId. Con 4 en paralelo se satura y muere a media corrida (ECONNRESET
    // al cargar rules, luego ECONNREFUSED). Serializar los archivos cuesta unos
    // segundos y hace la suite determinista.
    fileParallelism: false,
  },
});
