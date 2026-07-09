"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Comisión de la plataforma (debe coincidir con backend/src/wallet/ledger.ts). */
export const WALLET_COMMISSION_RATE = 0.23;
export const WALLET_NET_RATE = 1 - WALLET_COMMISSION_RATE; // 0.77

/**
 * Resumen agregado del wallet del creador. Lo mantiene el backend de forma
 * transaccional en `users/{uid}/walletSummary/current`. Aquí solo se lee.
 */
export type WalletSummary = {
  currency: string;
  /** Ganado histórico (acumulado de por vida; los reembolsos lo restan). */
  lifetimeEarnedGross: number;
  lifetimeEarnedNet: number;
  /** Total retirado (por ahora 0; funcionalidad de retiro futura). */
  withdrawnGross: number;
  withdrawnNet: number;
  /** Pagado pero pendiente de entregar (por liberar). */
  pendingGross: number;
  pendingNet: number;
  /** Reembolsado (devuelto). */
  refundedGross: number;
  refundedNet: number;
  /** Rechazado / no entregado (dinero perdido). */
  rejectedGross: number;
  rejectedNet: number;
};

export const EMPTY_WALLET_SUMMARY: WalletSummary = {
  currency: "MXN",
  lifetimeEarnedGross: 0,
  lifetimeEarnedNet: 0,
  withdrawnGross: 0,
  withdrawnNet: 0,
  pendingGross: 0,
  pendingNet: 0,
  refundedGross: 0,
  refundedNet: 0,
  rejectedGross: 0,
  rejectedNet: 0,
};

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSummary(data: Record<string, unknown>): WalletSummary {
  return {
    currency: typeof data.currency === "string" ? data.currency : "MXN",
    lifetimeEarnedGross: toNumber(data.lifetimeEarnedGross),
    lifetimeEarnedNet: toNumber(data.lifetimeEarnedNet),
    withdrawnGross: toNumber(data.withdrawnGross),
    withdrawnNet: toNumber(data.withdrawnNet),
    pendingGross: toNumber(data.pendingGross),
    pendingNet: toNumber(data.pendingNet),
    refundedGross: toNumber(data.refundedGross),
    refundedNet: toNumber(data.refundedNet),
    rejectedGross: toNumber(data.rejectedGross),
    rejectedNet: toNumber(data.rejectedNet),
  };
}

/** Cifras ya listas para mostrar, según neto o bruto. */
export type WalletFinanceView = {
  available: number; // disponible para retirar = histórico - retirado
  lifetime: number; // ganado histórico
  pending: number; // por liberar
  refunded: number; // devuelto
  rejected: number; // perdido en rechazados
};

export function selectFinanceView(
  summary: WalletSummary,
  mode: "net" | "gross"
): WalletFinanceView {
  const g = mode === "gross";
  const lifetime = g ? summary.lifetimeEarnedGross : summary.lifetimeEarnedNet;
  const withdrawn = g ? summary.withdrawnGross : summary.withdrawnNet;
  return {
    lifetime,
    available: Math.max(0, lifetime - withdrawn),
    pending: g ? summary.pendingGross : summary.pendingNet,
    refunded: g ? summary.refundedGross : summary.refundedNet,
    rejected: g ? summary.rejectedGross : summary.rejectedNet,
  };
}

/** Suscribe al resumen del wallet del usuario. */
export function useWalletFinances(uid: string | null | undefined) {
  const [summary, setSummary] = useState<WalletSummary>(EMPTY_WALLET_SUMMARY);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Sin uid no nos suscribimos (el caso vacío se resuelve en el return).
    if (!uid) return;

    const ref = doc(db, "users", uid, "walletSummary", "current");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setSummary(
          snap.exists()
            ? normalizeSummary(snap.data() as Record<string, unknown>)
            : EMPTY_WALLET_SUMMARY
        );
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [uid]);

  if (!uid) {
    return { summary: EMPTY_WALLET_SUMMARY, loading: false };
  }

  return { summary, loading };
}
