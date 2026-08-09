"use client";

// Todas las compras del COMPRADOR (los 11 servicios) para la pestaña "Todo" de
// /experiencias. Lee la colección espejo `users/{uid}/purchases` (la escribe el
// trigger backend `mirrorLedgerToBuyerPurchase`) ordenada por fecha, más reciente
// primero. Reusa los tipos/helpers del sidebar para resolver nombres de creador y
// comunidad, igual que `useMyExperiences`.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { LedgerServiceType } from "@/lib/wallet/walletLedger";
import type { GroupDocLite, UserMini } from "@/app/components/OwnerSidebar/OwnerSidebar.parts";
import { buildDisplayName } from "@/app/components/OwnerSidebar/OwnerSidebar.utils";

type TS = { toMillis?: () => number; toDate?: () => Date } | null | undefined;

export type PurchaseData = {
  type: LedgerServiceType;
  status: "paid" | "refunded" | "rejected";
  grossAmount: number; // base (precio del creador); sobre esto va la comisión
  taxAmount?: number; // 🧾 IVA cobrado al comprador ENCIMA de la base (va al SAT). Legacy: ausente → 0
  currency: string;
  invoiced?: boolean; // true si ya se generó su CFDI (generateBuyerInvoice)
  invoiceId?: string | null;
  // Devolución: destino del reembolso + monto devuelto (para "· Devuelto en crédito/tarjeta").
  refundDestination?: "credit" | "card";
  refundedAmount?: number;
  creatorId: string;
  channelType: "profile" | "group";
  channelId: string | null;
  liveId: string | null;
  postId: string | null;
  occurredAt?: TS;
  createdAt?: TS;
};

export type PurchaseRow = { id: string; data: PurchaseData };

function ms(d: PurchaseData): number {
  return d.occurredAt?.toMillis?.() ?? d.createdAt?.toMillis?.() ?? 0;
}

export function useAllPurchases(uid: string | null | undefined) {
  const tCommon = useTranslations("common");
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [userMiniMap, setUserMiniMap] = useState<Record<string, UserMini>>({});
  const [groupMetaMap, setGroupMetaMap] = useState<Record<string, GroupDocLite>>({});

  useEffect(() => {
    if (!uid) {
      setPurchases([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let unsub: (() => void) | null = null;
    let cancelled = false;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      const q = query(
        collection(db, "users", uid, "purchases"),
        orderBy("occurredAt", "desc"),
        limit(300)
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() as PurchaseData }));
          // Orden de respaldo por si algún occurredAt viniera nulo.
          rows.sort((a, b) => ms(b.data) - ms(a.data));
          setPurchases(rows);
          setLoading(false);
        },
        () => {
          setPurchases([]);
          setLoading(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  // ── Creadores referenciados (solo faltantes) ───────────────────────────────
  const creatorIds = useMemo(
    () => Array.from(new Set(purchases.map((r) => r.data.creatorId).filter(Boolean))),
    [purchases]
  );
  useEffect(() => {
    const missing = creatorIds.filter((id) => !userMiniMap[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        try {
          const s = await getDoc(doc(db, "users", id));
          const data = s.exists() ? (s.data() as unknown as Parameters<typeof buildDisplayName>[0]) : null;
          const extra = (s.exists() ? s.data() : null) as { handle?: string | null; photoURL?: string | null } | null;
          return [
            id,
            {
              uid: id,
              displayName: buildDisplayName(data, id, tCommon("user")),
              handle: extra?.handle ?? null,
              photoURL: extra?.photoURL ?? null,
            } satisfies UserMini,
          ] as const;
        } catch {
          return [
            id,
            { uid: id, displayName: buildDisplayName(null, id, tCommon("user")), handle: null, photoURL: null } satisfies UserMini,
          ] as const;
        }
      })
    ).then((pairs) => {
      if (cancelled) return;
      setUserMiniMap((prev) => {
        const next = { ...prev };
        for (const [id, m] of pairs) next[id] = m;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [creatorIds, userMiniMap, tCommon]);

  // ── Comunidades referenciadas (solo faltantes) ─────────────────────────────
  const groupIds = useMemo(
    () => Array.from(new Set(purchases.map((r) => r.data.channelId).filter((g): g is string => !!g))),
    [purchases]
  );
  useEffect(() => {
    const missing = groupIds.filter((g) => !groupMetaMap[g]);
    if (missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (g) => {
        try {
          const s = await getDoc(doc(db, "groups", g));
          return s.exists() ? ({ ...(s.data() as Omit<GroupDocLite, "id">), id: s.id }) : null;
        } catch {
          return null;
        }
      })
    ).then((list) => {
      if (cancelled) return;
      const meta: Record<string, GroupDocLite> = {};
      list.forEach((g) => {
        if (g) meta[g.id] = g;
      });
      if (Object.keys(meta).length > 0) setGroupMetaMap((prev) => ({ ...prev, ...meta }));
    });
    return () => {
      cancelled = true;
    };
  }, [groupIds, groupMetaMap]);

  return { purchases, userMiniMap, groupMetaMap, loading };
}
