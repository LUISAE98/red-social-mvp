"use client";

import { usePathname } from "next/navigation";
import { useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import WalletSubNav, { type WalletTabKey } from "./components/WalletSubNav";
import { WalletDataContext } from "./components/WalletDataContext";
import { useOwnerWalletData } from "@/lib/wallet/ownerWallet";
import { useAuth } from "@/app/providers";

const TAB_ORDER: Record<WalletTabKey, number> = {
  finances: 0,
  calendar: 1,
  pending: 2,
  history: 3,
};

const STORAGE_KEY = "wallet-active-tab";

function pathToTab(pathname: string): WalletTabKey {
  if (pathname.includes("/calendario")) return "calendar";
  if (pathname.includes("/pendientes")) return "pending";
  if (pathname.includes("/historial")) return "history";
  return "finances";
}

export default function WalletLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const walletData = useOwnerWalletData(user?.uid);

  const pathname = usePathname();
  const activeTab = pathToTab(pathname);

  const direction = useMemo(() => {
    if (typeof window === "undefined") return 0;
    const prev = sessionStorage.getItem(STORAGE_KEY) as WalletTabKey | null;
    if (!prev || prev === activeTab) return 0;
    return TAB_ORDER[activeTab] > TAB_ORDER[prev] ? 1 : -1;
  }, [activeTab]);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, activeTab);
  }, [activeTab]);

  return (
    <>
      <style jsx>{`
        .walletLayout {
          width: 100%;
          color: #ffffff;
          font-family: inherit;
        }

        .walletHeader {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 18px;
        }

        .walletTitle {
          margin: 0;
          font-size: 44px;
          line-height: 0.98;
          letter-spacing: -0.04em;
          font-weight: 700;
          color: #ffffff;
        }

        .walletContent {
          overflow: hidden;
        }

        @media (max-width: 900px) {
          .walletLayout {
            padding-left: 12px;
            padding-right: 12px;
            box-sizing: border-box;
          }

          .walletHeader {
            gap: 6px;
            margin-bottom: 14px;
          }

          .walletTitle {
            font-size: 34px;
          }
        }
      `}</style>

      <WalletDataContext.Provider value={walletData}>
        <div className="walletLayout">
          <div className="walletHeader">
            <h1 className="walletTitle">Wallet</h1>
            <WalletSubNav activeTab={activeTab} />
          </div>

          <div className="walletContent">
            <motion.div
              key={pathname}
              initial={{ x: direction > 0 ? "100%" : direction < 0 ? "-100%" : 0 }}
              animate={{ x: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.9 }}
            >
              {children}
            </motion.div>
          </div>
        </div>
      </WalletDataContext.Provider>
    </>
  );
}
