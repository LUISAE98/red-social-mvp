"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";

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

export type LedgerChannelType = "profile" | "group";

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
  /** Canal que originó la venta: perfil del creador o una comunidad. */
  channelType: LedgerChannelType;
  /** Id de la comunidad si channelType = "group"; null para perfil. */
  channelId: string | null;
  /** Id del post del live si la venta pertenece a una transmisión; null si no. */
  liveId: string | null;
  /** Id de la publicación (tickets: post premium / VOD); null si no aplica. */
  postId: string | null;
  /**
   * 💰 La comisión que se aplicó a ESTA venta, congelada el día que se registró.
   *
   * `undefined` en los asientos anteriores al 2026-08-27, que se registraron todos al 25%.
   * Para leerla usa `netRateOfEntry`, que ya resuelve ese caso.
   *
   * 🚨 Una venta vieja conserva SU comisión aunque el creador cambie de país. Recalcular
   * hacia atrás es lo primero que se nota en el saldo, y destruye la confianza.
   */
  commissionRate?: number;
  /** El grupo del que salió esa comisión. `undefined` en los asientos viejos. */
  commissionTier?: "standard" | "expensive";
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

const EMPTY_ENTRIES: LedgerEntry[] = [];

function mapLedgerDoc(doc: {
  id: string;
  data: () => Record<string, unknown>;
}): LedgerEntry {
  const d = doc.data();
  return {
    id: doc.id,
    type: d.type as LedgerServiceType,
    status: d.status as LedgerStatus,
    grossAmount: toNumber(d.grossAmount),
    netAmount: toNumber(d.netAmount),
    currency: typeof d.currency === "string" ? d.currency : SETTLEMENT_CURRENCY,
    createdAt: toDate(d.createdAt),
    occurredAt: toDate(d.occurredAt) ?? toDate(d.createdAt),
    buyerId: typeof d.buyerId === "string" ? d.buyerId : null,
    channelType: d.channelType === "group" ? "group" : "profile",
    channelId: typeof d.channelId === "string" ? d.channelId : null,
    liveId: typeof d.liveId === "string" ? d.liveId : null,
    postId: typeof d.postId === "string" ? d.postId : null,
  };
}

// Caché en memoria por usuario con listener persistente: se comparte entre
// pestañas y no se recarga al navegar (se limpia solo al refrescar la página).
type LedgerStore = {
  entries: LedgerEntry[];
  loaded: boolean;
  limit: number;
  unsub: (() => void) | null;
  subs: Set<() => void>;
};
const ledgerStores = new Map<string, LedgerStore>();

function getLedgerStore(uid: string): LedgerStore {
  let s = ledgerStores.get(uid);
  if (!s) {
    s = { entries: EMPTY_ENTRIES, loaded: false, limit: 0, unsub: null, subs: new Set() };
    ledgerStores.set(uid, s);
  }
  return s;
}

function ensureLedgerSub(uid: string, wantLimit: number) {
  const s = getLedgerStore(uid);
  if (s.unsub && s.limit >= wantLimit) return; // ya cubierto por el listener actual
  s.unsub?.();
  s.limit = Math.max(s.limit, wantLimit);
  const q = query(
    collection(db, "users", uid, "walletLedger"),
    orderBy("createdAt", "desc"),
    limit(s.limit)
  );
  const notify = () => s.subs.forEach((fn) => fn());
  s.unsub = onSnapshot(
    q,
    (snap) => {
      s.entries = snap.docs.map((doc) => mapLedgerDoc(doc));
      s.loaded = true;
      notify();
    },
    (err) => {
      // Falló la lectura del libro mayor (dinero): no dejarlo pasar en silencio.
      captureError(err, { scope: "wallet", extra: { where: "walletLedger_snapshot" } });
      s.loaded = true;
      notify();
    }
  );
}

/** Suscribe (con caché persistente) al libro mayor del usuario. */
export function useWalletLedger(uid: string | null | undefined, limitCount = 60) {
  useEffect(() => {
    if (uid) ensureLedgerSub(uid, limitCount);
  }, [uid, limitCount]);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!uid) return () => {};
      const s = getLedgerStore(uid);
      s.subs.add(cb);
      return () => {
        s.subs.delete(cb);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? ledgerStores.get(uid)?.entries ?? EMPTY_ENTRIES : EMPTY_ENTRIES),
    [uid]
  );
  const entries = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ENTRIES);
  const loading = uid ? !(ledgerStores.get(uid)?.loaded ?? false) : false;
  return { entries, loading };
}
