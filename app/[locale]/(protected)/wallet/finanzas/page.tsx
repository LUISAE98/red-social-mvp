"use client";

import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";

export default function WalletFinanzasPage() {
  return (
    <WalletSectionShell activeTab="finances">
      <WalletCard
        title="Finanzas"
        description="Aquí irá tu panel financiero del creador con balance, comisiones, neto, disponibles y movimientos."
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 8,
            paddingTop: 2,
          }}
        >
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "#fff",
            }}
          >
            Panel financiero en preparación
          </div>

          <div
            style={{
              maxWidth: 640,
              color: "rgba(255,255,255,0.68)",
              fontSize: 13,
              lineHeight: 1.6,
              fontWeight: 400,
            }}
          >
            En la siguiente fase conectaremos balance general, pendientes,
            liberados, comisiones e historial financiero detallado.
          </div>
        </div>
      </WalletCard>
    </WalletSectionShell>
  );
}