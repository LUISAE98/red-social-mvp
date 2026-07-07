"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import RefreshableArea from "@/components/refresh/RefreshableArea";
import { type WalletTabKey } from "./WalletSubNav";

export default function WalletSectionShell({
  activeTab,
  children,
}: {
  activeTab: WalletTabKey;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const handleWalletPullRefresh = useCallback(async () => {
    router.refresh();
  }, [router]);

  return (
    <>
      <style jsx>{`
        .content {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
      `}</style>

      <RefreshableArea
        onRefresh={handleWalletPullRefresh}
        indicatorTop="var(--wallet-header-bottom, calc(env(safe-area-inset-top) + 20px))"
      >
        <section className="content">{children}</section>
      </RefreshableArea>
    </>
  );
}
