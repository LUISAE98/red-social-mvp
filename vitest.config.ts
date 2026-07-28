import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests unitarios PUROS del frontend (sin Firebase ni red). Por ahora cubren la
// lógica de dinero agnóstica de framework: impuestos (lib/tax) y conversión de
// moneda/FX (lib/currency). Scope acotado a test/unit para no interferir con el
// build de Next ni intentar renderizar componentes.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["test/unit/**/*.test.ts"],
    environment: "node",
  },
});
