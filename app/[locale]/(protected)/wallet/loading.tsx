import { WalletCardsSkeleton } from "./components/WalletListSkeleton";

/**
 * Wallet y sus subpestañas (finanzas, historial, pendientes, estadísticas,
 * calendario). Todas abren con tarjetas apiladas, así que un solo fallback
 * sirve para el grupo entero.
 */
export default function Loading() {
  return (
    <main style={{ minHeight: "100dvh", width: "100%" }}>
      <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", padding: "14px" }}>
        <WalletCardsSkeleton count={5} />
      </div>
    </main>
  );
}
