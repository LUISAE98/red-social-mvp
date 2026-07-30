"use client";

// Datos de "Mis experiencias" (lado COMPRADOR) para la página /experiencias.
//
// Hook AUTOCONTENIDO: hace sus propias consultas a Firestore y arma su propio
// userMiniMap/groupMetaMap SOLO con las experiencias que el usuario compró. No
// depende del data-layer de OwnerSidebar (que comparte esos mapas con comunidades
// y solicitudes). Devuelve exactamente lo que consume `OwnerSidebarGreetings`.
//
// Reusa los helpers/tipos existentes del sidebar para no duplicar lógica de forma.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  collection,
  query,
  where,
  limit,
  onSnapshot,
  getDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
  GroupDocLite,
  UserMini,
} from "@/app/components/OwnerSidebar/OwnerSidebar.parts";
import {
  buildDisplayName,
  normalizeOwnerSidebarNoShowStatus,
} from "@/app/components/OwnerSidebar/OwnerSidebar.utils";

type GRow = { id: string; data: GreetingRequestDoc };
type MRow = { id: string; data: MeetGreetRequestDoc };
type SRow = { id: string; data: ExclusiveSessionRequestDoc };

export type MyExperiences = {
  buyerPending: GRow[];
  buyerDelivered: GRow[];
  buyerRejectedGreetings: GRow[];
  buyerMeetGreets: MRow[];
  buyerExclusiveSessions: SRow[];
  groupMetaMap: Record<string, GroupDocLite>;
  userMiniMap: Record<string, UserMini>;
  loading: boolean;
};

export function useMyExperiences(uid: string | null | undefined): MyExperiences {
  const tCommon = useTranslations("common");

  const [buyerPending, setBuyerPending] = useState<GRow[]>([]);
  const [buyerDelivered, setBuyerDelivered] = useState<GRow[]>([]);
  const [buyerRejectedGreetings, setBuyerRejectedGreetings] = useState<GRow[]>([]);
  const [buyerMeetGreets, setBuyerMeetGreets] = useState<MRow[]>([]);
  const [buyerExclusiveSessions, setBuyerExclusiveSessions] = useState<SRow[]>([]);
  const [groupMetaMap, setGroupMetaMap] = useState<Record<string, GroupDocLite>>({});
  const [userMiniMap, setUserMiniMap] = useState<Record<string, UserMini>>({});
  const [loading, setLoading] = useState(true);

  // ── Saludos/consejos del comprador (3 estados) ─────────────────────────────
  useEffect(() => {
    if (!uid) {
      setBuyerPending([]);
      setBuyerDelivered([]);
      setBuyerRejectedGreetings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const base = collection(db, "greetingRequests");

    const unsubP = onSnapshot(
      query(base, where("buyerId", "==", uid), where("status", "==", "pending"), limit(50)),
      (snap) => {
        setBuyerPending(
          snap.docs
            .map((d) => ({ id: d.id, data: d.data() as GreetingRequestDoc }))
            // Ocultar solicitudes propias sin pagar (esperando pago).
            .filter((r) => (r.data as { paymentStatus?: string }).paymentStatus !== "awaiting_payment")
        );
        setLoading(false);
      },
      () => {
        setBuyerPending([]);
        setLoading(false);
      }
    );

    const unsubD = onSnapshot(
      query(base, where("buyerId", "==", uid), where("status", "==", "delivered"), limit(50)),
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() as GreetingRequestDoc }));
        rows.sort((a, b) => (b.data.deliveredAt?.toMillis?.() ?? 0) - (a.data.deliveredAt?.toMillis?.() ?? 0));
        setBuyerDelivered(rows);
      },
      () => setBuyerDelivered([])
    );

    const unsubR = onSnapshot(
      query(base, where("buyerId", "==", uid), where("status", "in", ["rejected", "refund_requested"]), limit(50)),
      (snap) => setBuyerRejectedGreetings(snap.docs.map((d) => ({ id: d.id, data: d.data() as GreetingRequestDoc }))),
      () => setBuyerRejectedGreetings([])
    );

    return () => {
      unsubP();
      unsubD();
      unsubR();
    };
  }, [uid]);

  // ── Meet & greet del comprador ─────────────────────────────────────────────
  useEffect(() => {
    if (!uid) {
      setBuyerMeetGreets([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, "meetGreetRequests"), where("buyerId", "==", uid), limit(100)),
      (snap) =>
        setBuyerMeetGreets(
          snap.docs.map((d) => ({
            id: d.id,
            data: normalizeOwnerSidebarNoShowStatus({ ...(d.data() as MeetGreetRequestDoc), id: d.id }),
          }))
        ),
      () => setBuyerMeetGreets([])
    );
    return () => unsub();
  }, [uid]);

  // ── Sesiones exclusivas del comprador ──────────────────────────────────────
  useEffect(() => {
    if (!uid) {
      setBuyerExclusiveSessions([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, "exclusiveSessionRequests"), where("buyerId", "==", uid), limit(100)),
      (snap) =>
        setBuyerExclusiveSessions(
          snap.docs.map((d) => ({
            id: d.id,
            data: normalizeOwnerSidebarNoShowStatus({
              ...(d.data() as ExclusiveSessionRequestDoc),
              id: d.id,
              type: "digital_exclusive_session",
            }) as ExclusiveSessionRequestDoc,
          }))
        ),
      () => setBuyerExclusiveSessions([])
    );
    return () => unsub();
  }, [uid]);

  // ── groupMetaMap: trae los grupos referenciados (solo faltantes) ───────────
  useEffect(() => {
    const groupIds = new Set<string>();
    [...buyerPending, ...buyerDelivered, ...buyerRejectedGreetings, ...buyerMeetGreets, ...buyerExclusiveSessions].forEach((r) => {
      const g = r.data.groupId;
      if (typeof g === "string" && g.trim().length > 0) groupIds.add(g);
    });
    const missing = Array.from(groupIds).filter((g) => !groupMetaMap[g]);
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
  }, [buyerPending, buyerDelivered, buyerRejectedGreetings, buyerMeetGreets, buyerExclusiveSessions, groupMetaMap]);

  // ── userMiniMap: trae los creadores referenciados (solo faltantes) ─────────
  const creatorIds = useMemo(() => {
    const ids = new Set<string>();
    [...buyerPending, ...buyerDelivered, ...buyerRejectedGreetings, ...buyerMeetGreets, ...buyerExclusiveSessions].forEach((r) => {
      if (r.data.creatorId) ids.add(r.data.creatorId);
    });
    return Array.from(ids).filter(Boolean);
  }, [buyerPending, buyerDelivered, buyerRejectedGreetings, buyerMeetGreets, buyerExclusiveSessions]);

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
        for (const [id, meta] of pairs) next[id] = meta;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [creatorIds, userMiniMap, tCommon]);

  return {
    buyerPending,
    buyerDelivered,
    buyerRejectedGreetings,
    buyerMeetGreets,
    buyerExclusiveSessions,
    groupMetaMap,
    userMiniMap,
    loading,
  };
}
