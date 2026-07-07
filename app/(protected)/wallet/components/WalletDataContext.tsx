"use client";

import { createContext, useContext } from "react";
import type { OwnerWalletDataResult } from "@/lib/wallet/ownerWallet";

const defaultValue: OwnerWalletDataResult = {
  loading: true,
  error: null,
  all: [],
  calendar: [],
  pendingCurrent: [],
  history: [],
};

export const WalletDataContext = createContext<OwnerWalletDataResult>(defaultValue);

export function useWalletData(): OwnerWalletDataResult {
  return useContext(WalletDataContext);
}
