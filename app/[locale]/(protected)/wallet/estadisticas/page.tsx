"use client";

import { useAuth } from "@/app/providers";
import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";
import WalletIncomeChart from "../components/WalletIncomeChart";

export default function WalletEstadisticasPage() {
  const { user } = useAuth();

  return (
    <WalletSectionShell activeTab="statistics">
      <WalletCard transparent>
        <WalletIncomeChart uid={user?.uid} />
      </WalletCard>
    </WalletSectionShell>
  );
}
