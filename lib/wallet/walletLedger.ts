"use client";

import { useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

export type LedgerServiceType =
  | "supercomment"
  | "profile_donation"
  | "live_donation"
  | "live_ticket"
  | "premium_post"
  | "greeting"
  | "advice"
  | "exclusive_session"
  | "live_session"
  | "subscription"
  | "vod_ticket";

export type LedgerStatus = "pending" | "earned" | "refunded" | "rejected";

export type LedgerEntry = {
  id: string;
  type: LedgerServiceType;
  status: LedgerStatus;
  grossAmount: number;
  netAmount: number;
  currency: string;
  createdAt: Date | null;
  /** Fecha real de la venta (si existe); si no, cae en createdAt. */
  occurredAt: Date | null;
  buyerId: string | null;
};

/** Clave de traducción (namespace wallet) para el nombre de cada servicio. */
export function ledgerTypeLabelKey(type: LedgerServiceType): string {
  const map: Record<LedgerServiceType, string> = {
    supercomment: "txTypeSupercomment",
    profile_donation: "txTypeProfileDonation",
    live_donation: "txTypeLiveDonation",
    live_ticket: "txTypeLiveTicket",
    premium_post: "txTypePremiumPost",
    greeting: "txTypeGreeting",
    advice: "txTypeAdvice",
    exclusive_session: "txTypeExclusiveSession",
    live_session: "txTypeLiveSession",
    subscription: "txTypeSubscription",
    vod_ticket: "txTypeVod",
  };
  return map[type];
}

/** Clave de traducción (namespace wallet) para cada estado. */
export function ledgerStatusLabelKey(status: LedgerStatus): string {
  const map: Record<LedgerStatus, string> = {
    earned: "txStatusEarned",
    pending: "txStatusPending",
    refunded: "txStatusRefunded",
    rejected: "txStatusRejected",
  };
  return map[status];
}

/** Color del badge de estado. */
export function ledgerStatusColor(status: LedgerStatus): string {
  switch (status) {
    case "earned":
      return "#4ade80";
    case "pending":
      return "#c084fc";
    case "refunded":
      return "#fbbf24";
    case "rejected":
      return "#f87171";
    default:
      return "rgba(255,255,255,0.6)";
  }
}

function toDate(value: unknown): Date | null {
  if (value && typeof (value as { toDate?: unknown }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Suscribe a los movimientos recientes del libro mayor del usuario. */
export function useWalletLedger(
  uid: string | null | undefined,
  limitCount = 60
) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;

    const q = query(
      collection(db, "users", uid, "walletLedger"),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(
          snap.docs.map((doc) => {
            const d = doc.data();
            return {
              id: doc.id,
              type: d.type as LedgerServiceType,
              status: d.status as LedgerStatus,
              grossAmount: toNumber(d.grossAmount),
              netAmount: toNumber(d.netAmount),
              currency: typeof d.currency === "string" ? d.currency : "MXN",
              createdAt: toDate(d.createdAt),
              occurredAt: toDate(d.occurredAt) ?? toDate(d.createdAt),
              buyerId: typeof d.buyerId === "string" ? d.buyerId : null,
            };
          })
        );
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsub();
  }, [uid, limitCount]);

  if (!uid) {
    return { entries: [] as LedgerEntry[], loading: false };
  }

  return { entries, loading };
}
