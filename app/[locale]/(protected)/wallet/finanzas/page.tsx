"use client";

import { useTranslations } from "next-intl";
import WalletSectionShell from "../components/WalletSectionShell";
import { WalletCard } from "../components/WalletUi";

export default function WalletFinanzasPage() {
  const tWallet = useTranslations("wallet");
  return (
    <WalletSectionShell activeTab="finances">
      <WalletCard
        title={tWallet("financesTitle")}
        description={tWallet("financesDescription")}
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
            {tWallet("financesPanelTitle")}
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
            {tWallet("financesPanelDesc")}
          </div>
        </div>
      </WalletCard>
    </WalletSectionShell>
  );
}