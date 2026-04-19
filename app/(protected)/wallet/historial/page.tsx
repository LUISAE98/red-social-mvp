"use client";

import { useAuth } from "@/app/providers";
import { useOwnerWalletData } from "@/lib/wallet/ownerWallet";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  EmptyRows,
  WalletCard,
  WalletErrorBox,
  WalletList,
} from "../components/WalletUi";

export default function WalletHistorialPage() {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);

  return (
    <WalletSectionShell activeTab="history">
      {walletData.error ? <WalletErrorBox message={walletData.error} /> : null}

      <WalletCard
        title="Historial"
        description="Aquí queda el historial inicial de servicios procesados. Ya incluye Meet & Greet, saludos y consejos."
      >
        {walletData.loading ? (
          <EmptyRows
            title="Cargando historial"
            subtitle="Estamos leyendo tus servicios procesados."
          />
        ) : walletData.history.length > 0 ? (
          <WalletList items={walletData.history} />
        ) : (
          <EmptyRows
            title="Sin historial"
            subtitle="Todavía no tienes servicios procesados para mostrar aquí."
          />
        )}
      </WalletCard>
    </WalletSectionShell>
  );
}