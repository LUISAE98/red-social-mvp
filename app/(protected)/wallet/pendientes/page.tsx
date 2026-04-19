"use client";

import { useState } from "react";
import { useAuth } from "@/app/providers";
import { useOwnerWalletData } from "@/lib/wallet/ownerWallet";
import WalletSectionShell from "../components/WalletSectionShell";
import {
  EmptyRows,
  WalletCard,
  WalletErrorBox,
  WalletInlineTabs,
  WalletList,
} from "../components/WalletUi";

export default function WalletPendientesPage() {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);
  const [innerTab, setInnerTab] = useState<"current" | "rejected">("current");

  const activeItems =
    innerTab === "current"
      ? walletData.pendingCurrent
      : walletData.pendingRejected;

  return (
    <WalletSectionShell activeTab="pending">
      {walletData.error ? <WalletErrorBox message={walletData.error} /> : null}

      <WalletCard
        title="Pendientes"
        description="Aquí concentramos tus solicitudes activas, operativas y rechazadas para sacar carga del Owner Sidebar."
      >
        <WalletInlineTabs current={innerTab} onChange={setInnerTab} />

        {walletData.loading ? (
          <EmptyRows
            title="Cargando pendientes"
            subtitle="Estamos leyendo tus solicitudes activas."
          />
        ) : activeItems.length > 0 ? (
          <WalletList items={activeItems} />
        ) : innerTab === "current" ? (
          <EmptyRows
            title="Sin pendientes actuales"
            subtitle="No tienes solicitudes activas por atender en este momento."
          />
        ) : (
          <EmptyRows
            title="Sin rechazados"
            subtitle="No tienes solicitudes rechazadas, canceladas o con devolución para mostrar."
          />
        )}
      </WalletCard>
    </WalletSectionShell>
  );
}