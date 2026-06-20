"use client";

export function useWalletVisibility(ownerId?: string | null) {
  return {
    hasWallet: !!ownerId,
    loaded: true,
  };
}
