import { defineConfig } from "vitest/config";

// Tests unitarios PUROS del backend (sin emulador de Firestore).
// Cubren la aritmética del dinero, la firma anti-fraude del webhook de MP y la
// normalización de estados de pago. Los tests que tocan Firestore (ledger,
// triggers, reconcile) van aparte con el emulador.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
