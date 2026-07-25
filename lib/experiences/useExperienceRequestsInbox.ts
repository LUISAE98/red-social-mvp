"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  getServiceBucketKey,
  isMeetGreetCreatorActiveItem,
  normalizeOwnerSidebarNoShowStatus,
  buildDisplayName,
} from "@/app/components/OwnerSidebar/OwnerSidebar.utils";
import type {
  GreetingRequestDoc,
  MeetGreetRequestDoc,
  ExclusiveSessionRequestDoc,
  GroupDocLite,
  UserMini,
  UserDoc,
} from "@/app/components/OwnerSidebar/OwnerSidebar";

export type BucketItem<T> = { id: string; data: T };

export type ExperienceRequestsInbox = {
  greetingsByBucket: Record<string, BucketItem<GreetingRequestDoc>[]>;
  meetGreetsByBucket: Record<string, BucketItem<MeetGreetRequestDoc>[]>;
  exclusiveByBucket: Record<string, BucketItem<ExclusiveSessionRequestDoc>[]>;
  groupMetaMap: Record<string, GroupDocLite>;
  userMiniMap: Record<string, UserMini>;
  loading: boolean;
};

const PROFILE_PREFIX = "profile:";

/**
 * Solicitudes de experiencias entrantes del creador (saludo/consejo por atender,
 * tiempo contigo y sesión exclusiva activas), bucketizadas por perfil/comunidad
 * con la MISMA lógica del OwnerSidebar (`getServiceBucketKey`,
 * `isMeetGreetCreatorActiveItem`, `normalizeOwnerSidebarNoShowStatus`).
 *
 * Es el pipeline que antes vivía inline en el sidebar, extraído para alimentar
 * la pestaña "Experiencias" de notificaciones. NO incluye donaciones.
 */
export function useExperienceRequestsInbox(
  uid: string | null | undefined
): ExperienceRequestsInbox {
  const [greetingsByBucket, setGreetingsByBucket] = useState<
    Record<string, BucketItem<GreetingRequestDoc>[]>
  >({});
  const [meetGreetsByBucket, setMeetGreetsByBucket] = useState<
    Record<string, BucketItem<MeetGreetRequestDoc>[]>
  >({});
  const [exclusiveByBucket, setExclusiveByBucket] = useState<
    Record<string, BucketItem<ExclusiveSessionRequestDoc>[]>
  >({});
  const [groupMetaMap, setGroupMetaMap] = useState<Record<string, GroupDocLite>>(
    {}
  );
  const [userMiniMap, setUserMiniMap] = useState<Record<string, UserMini>>({});

  const [loadingGreetings, setLoadingGreetings] = useState(true);
  const [loadingMeet, setLoadingMeet] = useState(true);
  const [loadingExclusive, setLoadingExclusive] = useState(true);

  // ── Saludos / consejos por atender (status "pending") ──────────────────────
  useEffect(() => {
    if (!uid) {
      setGreetingsByBucket({});
      setLoadingGreetings(false);
      return;
    }
    setLoadingGreetings(true);
    let unsub: (() => void) | null = null;
    let cancelled = false;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      const q = query(
        collection(db, "greetingRequests"),
        where("creatorId", "==", uid),
        where("status", "==", "pending"),
        limit(50)
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const grouped: Record<string, BucketItem<GreetingRequestDoc>[]> = {};
          snap.docs.forEach((d) => {
            const data = d.data() as GreetingRequestDoc;
            if (data.status !== "pending") return;
            // Saludos sin pagar (esperando pago en MP) no se muestran al creador.
            if ((data as { paymentStatus?: string }).paymentStatus === "awaiting_payment") return;
            const bucketKey = getServiceBucketKey(data);
            if (!bucketKey) return;
            (grouped[bucketKey] ??= []).push({ id: d.id, data });
          });
          setGreetingsByBucket(grouped);
          setLoadingGreetings(false);
        },
        () => {
          setGreetingsByBucket({});
          setLoadingGreetings(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  // ── Tiempo contigo (meet & greet) — activas ────────────────────────────────
  useEffect(() => {
    if (!uid) {
      setMeetGreetsByBucket({});
      setLoadingMeet(false);
      return;
    }
    setLoadingMeet(true);
    let unsub: (() => void) | null = null;
    let cancelled = false;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      const q = query(
        collection(db, "meetGreetRequests"),
        where("creatorId", "==", uid),
        limit(100)
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const grouped: Record<string, BucketItem<MeetGreetRequestDoc>[]> = {};
          snap.docs.forEach((d) => {
            const data = normalizeOwnerSidebarNoShowStatus({
              ...(d.data() as MeetGreetRequestDoc),
              id: d.id,
            });
            const bucketKey = getServiceBucketKey(data);
            if (!bucketKey) return;
            if (!isMeetGreetCreatorActiveItem(data.status)) return;
            (grouped[bucketKey] ??= []).push({ id: d.id, data });
          });
          setMeetGreetsByBucket(grouped);
          setLoadingMeet(false);
        },
        () => {
          setMeetGreetsByBucket({});
          setLoadingMeet(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  // ── Sesión exclusiva — activas ─────────────────────────────────────────────
  useEffect(() => {
    if (!uid) {
      setExclusiveByBucket({});
      setLoadingExclusive(false);
      return;
    }
    setLoadingExclusive(true);
    let unsub: (() => void) | null = null;
    let cancelled = false;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      const q = query(
        collection(db, "exclusiveSessionRequests"),
        where("creatorId", "==", uid),
        limit(100)
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          const grouped: Record<string, BucketItem<ExclusiveSessionRequestDoc>[]> = {};
          snap.docs.forEach((d) => {
            const data = normalizeOwnerSidebarNoShowStatus({
              ...(d.data() as ExclusiveSessionRequestDoc),
              id: d.id,
              type: "digital_exclusive_session",
            }) as ExclusiveSessionRequestDoc;
            const bucketKey = getServiceBucketKey(data);
            if (!bucketKey) return;
            if (!isMeetGreetCreatorActiveItem(data.status)) return;
            (grouped[bucketKey] ??= []).push({ id: d.id, data });
          });
          setExclusiveByBucket(grouped);
          setLoadingExclusive(false);
        },
        () => {
          setExclusiveByBucket({});
          setLoadingExclusive(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  // ── Metadatos de comunidades de los buckets de grupo ───────────────────────
  const groupBucketIds = useMemo(() => {
    const ids = new Set<string>();
    [greetingsByBucket, meetGreetsByBucket, exclusiveByBucket].forEach((map) => {
      Object.keys(map).forEach((key) => {
        if (key && !key.startsWith(PROFILE_PREFIX)) ids.add(key);
      });
    });
    return Array.from(ids);
  }, [greetingsByBucket, meetGreetsByBucket, exclusiveByBucket]);

  useEffect(() => {
    let cancelled = false;
    const missing = groupBucketIds.filter((id) => !groupMetaMap[id]);

    // Perfil propio: header sintético para el bucket `profile:<uid>`.
    const profileKey = uid ? `${PROFILE_PREFIX}${uid}` : null;
    const needProfileMeta = !!profileKey && !groupMetaMap[profileKey];

    if (missing.length === 0 && !needProfileMeta) return;

    (async () => {
      const next: Record<string, GroupDocLite> = {};

      await Promise.all(
        missing.map(async (groupId) => {
          try {
            const snap = await getDoc(doc(db, "groups", groupId));
            if (!snap.exists()) return;
            next[groupId] = {
              ...(snap.data() as Omit<GroupDocLite, "id">),
              id: snap.id,
            };
          } catch {
            /* silencioso: la tarjeta usa un fallback */
          }
        })
      );

      if (needProfileMeta && profileKey && uid) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          const data = snap.exists() ? (snap.data() as UserDoc) : null;
          next[profileKey] = {
            id: profileKey,
            name: data ? buildDisplayName(data, uid, "Mi perfil") : "Mi perfil",
            ownerId: uid,
            visibility: "profile",
            avatarUrl: data?.photoURL ?? null,
            handle: data?.handle ?? null,
          };
        } catch {
          /* silencioso */
        }
      }

      if (cancelled || Object.keys(next).length === 0) return;
      setGroupMetaMap((prev) => ({ ...prev, ...next }));
    })();

    return () => {
      cancelled = true;
    };
  }, [groupBucketIds, uid, groupMetaMap]);

  // ── Datos de los compradores (avatar / nombre / handle) ────────────────────
  const buyerIds = useMemo(() => {
    const ids = new Set<string>();
    Object.values(greetingsByBucket).forEach((rows) =>
      rows.forEach((r) => r.data.buyerId && ids.add(r.data.buyerId))
    );
    Object.values(meetGreetsByBucket).forEach((rows) =>
      rows.forEach((r) => r.data.buyerId && ids.add(r.data.buyerId))
    );
    Object.values(exclusiveByBucket).forEach((rows) =>
      rows.forEach((r) => r.data.buyerId && ids.add(r.data.buyerId))
    );
    return Array.from(ids);
  }, [greetingsByBucket, meetGreetsByBucket, exclusiveByBucket]);

  useEffect(() => {
    let cancelled = false;
    const missing = buyerIds.filter((id) => !userMiniMap[id]);
    if (missing.length === 0) return;

    (async () => {
      const pairs = await Promise.all(
        missing.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, "users", id));
            const data = snap.exists() ? (snap.data() as UserDoc) : null;
            return [
              id,
              {
                uid: id,
                displayName: buildDisplayName(data, id, "Usuario"),
                handle: data?.handle ?? null,
                photoURL: data?.photoURL ?? null,
              } satisfies UserMini,
            ] as const;
          } catch {
            return [
              id,
              {
                uid: id,
                displayName: buildDisplayName(null, id, "Usuario"),
                handle: null,
                photoURL: null,
              } satisfies UserMini,
            ] as const;
          }
        })
      );
      if (cancelled) return;
      setUserMiniMap((prev) => {
        const next = { ...prev };
        for (const [id, mini] of pairs) next[id] = mini;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [buyerIds, userMiniMap]);

  return {
    greetingsByBucket,
    meetGreetsByBucket,
    exclusiveByBucket,
    groupMetaMap,
    userMiniMap,
    loading: loadingGreetings || loadingMeet || loadingExclusive,
  };
}
