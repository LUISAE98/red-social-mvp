"use client";

import { useAuth } from "@/app/providers";
import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";
import WalletPurchaseGlobe from "../components/WalletPurchaseGlobe";
import WalletIncomeChart from "../components/WalletIncomeChart";
import WalletServiceBreakdown from "../components/WalletServiceBreakdown";
import WalletTopFans from "../components/WalletTopFans";
import WalletMonthComparison from "../components/WalletMonthComparison";
import WalletFanValue from "../components/WalletFanValue";
import WalletChannels from "../components/WalletChannels";

export default function WalletEstadisticasPage() {
  const { user } = useAuth();

  return (
    <WalletSectionShell activeTab="statistics">
      <WalletCard transparent>
        <WalletIncomeChart uid={user?.uid} />
        <WalletServiceBreakdown uid={user?.uid} />
      </WalletCard>

      <WalletCard transparent>
        <WalletPurchaseGlobe />
      </WalletCard>

      <WalletCard transparent>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 56,
            alignItems: "center",
          }}
        >
          <div style={{ flex: "1 1 300px", minWidth: 0 }}>
            <WalletTopFans uid={user?.uid} />
          </div>
          <div
            style={{
              flex: "1 1 200px",
              minWidth: 0,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <WalletMonthComparison uid={user?.uid} />
          </div>
        </div>
      </WalletCard>

      <WalletCard transparent>
        <WalletFanValue uid={user?.uid} />
      </WalletCard>

      <WalletCard transparent>
        <WalletChannels uid={user?.uid} />
      </WalletCard>
    </WalletSectionShell>
  );
}
