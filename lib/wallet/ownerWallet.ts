import { useEffect, useMemo, useState } from "react";
import { orderBy, type FirestoreError } from "firebase/firestore";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type {
  LiveKitRoomStatus,
  LiveKitSessionRecordingStatus,
} from "@/types/livekit";
import {
  getMeetGreetStatusLabel,
  type MeetGreetStatus,
} from "@/lib/meetGreet/types";
import {
  getExclusiveSessionStatusLabel,
  type ExclusiveSessionStatus,
} from "@/lib/exclusiveSession/types";
import type { PostLiveData } from "@/lib/posts/types";

// Tipos y lógica pura extraídos a un módulo hoja; se re-exportan (barrel) para no
// cambiar los ~14 consumidores.
export * from "./ownerWallet.helpers";
import {
  compareAsc,
  compareDesc,
  isCalendarScheduledStatus,
  isHistoryScheduledStatus,
  isPendingCurrentScheduledStatus,
  normalizeGreetingRow,
  normalizeLiveRow,
  normalizeScheduledRow,
  shouldTreatAsAutoRejected,
  type LivePostRowData,
  type OwnerWalletDataResult,
  type WalletGreetingDoc,
  type WalletScheduledDoc,
  type WalletServiceItem,
} from "./ownerWallet.helpers";

function useLiveRows(creatorId: string | null | undefined) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WalletServiceItem[]>([]);

  useEffect(() => {
    if (!creatorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    let unsub: (() => void) | null = null;
    let cancelled = false;

    // Esperar a que Auth resuelva el token antes de suscribir; si el listener
    // arranca antes, request.auth llega null → permission-denied transitorio.
    auth.authStateReady().then(() => {
      if (cancelled) return;

      const q = query(
        collection(db, "posts"),
        where("authorId", "==", creatorId),
        where("postType", "==", "live"),
        orderBy("createdAt", "desc"),
        limit(100)
      );

      unsub = onSnapshot(
        q,
        (snap) => {
          setRows(
            snap.docs
              .map((d) => normalizeLiveRow(d.id, d.data() as LivePostRowData))
              .filter((r): r is WalletServiceItem => r !== null)
          );
          setError(null);
          setLoading(false);
        },
        (err: FirestoreError) => {
          setRows([]);
          setError(err.message ?? "No se pudieron cargar los lives.");
          setLoading(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [creatorId]);

  return { loading, error, rows };
}

export function useScheduledRows(
  creatorId: string | null | undefined,
  collectionName: "meetGreetRequests" | "exclusiveSessionRequests",
  source: "meet_greet" | "exclusive_session"
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<WalletServiceItem[]>([]);

  useEffect(() => {
    if (!creatorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const q = query(
  collection(db, collectionName),
  where("creatorId", "==", creatorId),
  orderBy("updatedAt", "desc"),
  limit(100)
);

    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(
          snap.docs.map((d) =>
            normalizeScheduledRow(
              d.id,
              d.data() as Partial<WalletScheduledDoc>,
              source
            )
          )
        );
        setError(null);
        setLoading(false);
      },
      (err: FirestoreError) => {
        setRows([]);
        setError(err.message ?? `No se pudo cargar ${collectionName}.`);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [collectionName, creatorId, source]);

  return { loading, error, rows };
}

export function useOwnerWalletData(
  creatorId: string | null | undefined
): OwnerWalletDataResult {
  const meet = useScheduledRows(
    creatorId,
    "meetGreetRequests",
    "meet_greet"
  );

  const exclusive = useScheduledRows(
    creatorId,
    "exclusiveSessionRequests",
    "exclusive_session"
  );

  const live = useLiveRows(creatorId);

  const [loadingGreetings, setLoadingGreetings] = useState(true);
  const [greetingError, setGreetingError] = useState<string | null>(null);
  const [greetingRows, setGreetingRows] = useState<WalletServiceItem[]>([]);

  useEffect(() => {
    if (!creatorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGreetingRows([]);
      setGreetingError(null);
      setLoadingGreetings(false);
      return;
    }

    setLoadingGreetings(true);
    setGreetingError(null);

    const q = query(
      collection(db, "greetingRequests"),
      where("creatorId", "==", creatorId),
      limit(100)
    );

    const unsub = onSnapshot(
      q,
      async (snap) => {
        const rows = snap.docs.map((d) =>
          normalizeGreetingRow(d.id, d.data() as Partial<WalletGreetingDoc>)
        );

        // Fetch buyer display info for all unique buyerIds
        const uniqueBuyerIds = [...new Set(rows.map((r) => r.buyerId).filter(Boolean))];
        const buyerMap: Record<string, { displayName: string | null; photoURL: string | null; username: string | null }> = {};

        await Promise.all(
          uniqueBuyerIds.map(async (uid) => {
            try {
              const snap = await getDoc(doc(db, "users", uid));
              if (!snap.exists()) return;
              const d = snap.data() as Record<string, unknown>;
              const displayName =
                typeof d.displayName === "string" && d.displayName.trim()
                  ? d.displayName.trim()
                  : [d.firstName, d.lastName]
                      .filter((v) => typeof v === "string" && (v as string).trim())
                      .map((v) => (v as string).trim())
                      .join(" ") || null;
              const photoURL =
                typeof d.photoURL === "string" && d.photoURL.trim()
                  ? d.photoURL.trim()
                  : null;
              const username =
                typeof d.handle === "string" && d.handle.trim()
                  ? d.handle.trim()
                  : null;
              buyerMap[uid] = { displayName, photoURL, username };
            } catch {
              // silently skip — row will show fallback
            }
          })
        );

        // Fetch source info: profile avatar or group avatar + name
        const uniqueProfileSourceIds = [
          ...new Set(
            rows
              .filter((r) => r.requestSource === "profile" && r.profileUserId)
              .map((r) => r.profileUserId!)
          ),
        ];
        const uniqueGroupIds = [
          ...new Set(
            rows
              .filter((r) => r.requestSource === "group" && r.groupId)
              .map((r) => r.groupId!)
          ),
        ];

        const profileSourceAvatarMap: Record<string, string | null> = {};
        const groupSourceMap: Record<string, { avatarUrl: string | null; name: string | null }> = {};

        await Promise.all([
          ...uniqueProfileSourceIds.map(async (uid) => {
            try {
              const uSnap = await getDoc(doc(db, "users", uid));
              if (!uSnap.exists()) return;
              const d = uSnap.data() as Record<string, unknown>;
              profileSourceAvatarMap[uid] =
                typeof d.photoURL === "string" && d.photoURL.trim()
                  ? d.photoURL.trim()
                  : null;
            } catch {
              // silently skip
            }
          }),
          ...uniqueGroupIds.map(async (gid) => {
            try {
              const gSnap = await getDoc(doc(db, "groups", gid));
              if (!gSnap.exists()) return;
              const d = gSnap.data() as Record<string, unknown>;
              groupSourceMap[gid] = {
                avatarUrl:
                  typeof d.avatarUrl === "string" && d.avatarUrl.trim()
                    ? d.avatarUrl.trim()
                    : null,
                name:
                  typeof d.name === "string" && d.name.trim()
                    ? d.name.trim()
                    : null,
              };
            } catch {
              // silently skip
            }
          }),
        ]);

        setGreetingRows(
          rows.map((r) => {
            const buyer = buyerMap[r.buyerId];

            let sourceAvatarUrl: string | null = null;
            let groupName = r.groupName;

            if (r.requestSource === "profile" && r.profileUserId) {
              sourceAvatarUrl = profileSourceAvatarMap[r.profileUserId] ?? null;
            } else if (r.requestSource === "group" && r.groupId) {
              const gi = groupSourceMap[r.groupId];
              sourceAvatarUrl = gi?.avatarUrl ?? null;
              groupName = gi?.name ?? r.groupName;
            }

            return {
              ...r,
              buyerDisplayName: buyer?.displayName ?? r.buyerDisplayName,
              buyerAvatarUrl: buyer?.photoURL ?? r.buyerAvatarUrl,
              buyerUsername: buyer?.username ?? r.buyerUsername,
              groupName,
              sourceAvatarUrl,
            };
          })
        );
        setGreetingError(null);
        setLoadingGreetings(false);
      },
      (err: FirestoreError) => {
        setGreetingRows([]);
        setGreetingError(
          err.message ??
            "No se pudieron cargar los saludos y consejos de la wallet."
        );
        setLoadingGreetings(false);
      }
    );

    return () => unsub();
  }, [creatorId]);

  const derived = useMemo(() => {
    const scheduledRows = [...meet.rows, ...exclusive.rows];
    const combined = [...scheduledRows, ...greetingRows];

    const all = [...combined].sort((a, b) =>
      compareDesc(a.createdAt, b.createdAt)
    );

    const calendar = scheduledRows
      .filter((row) =>
        isCalendarScheduledStatus(row.status) &&
        !shouldTreatAsAutoRejected(row)
      )
      .sort((a, b) => compareAsc(a.scheduledAt, b.scheduledAt));

    // Lives del creador, en su propio array (solo para mostrar en el calendario;
    // NO entran a la detección de conflicto de sesiones ni a otros flujos).
    const lives = live.rows
      .filter((row) => isCalendarScheduledStatus(row.status))
      .sort((a, b) => compareAsc(a.scheduledAt, b.scheduledAt));

    const pendingCurrent = combined
      .filter((row) =>
        row.source === "greeting"
          ? row.status === "pending"
          : isPendingCurrentScheduledStatus(row.status) &&
            !shouldTreatAsAutoRejected(row)
      )
      .sort((a, b) =>
        compareAsc(a.scheduledAt ?? a.createdAt, b.scheduledAt ?? b.createdAt)
      );

    const history = combined
      .filter((row) =>
        row.source === "greeting"
          ? row.status === "delivered" || row.status === "accepted" || row.status === "rejected"
          : isHistoryScheduledStatus(row.status) || shouldTreatAsAutoRejected(row)
      )
      .sort((a, b) => compareDesc(a.updatedAt, b.updatedAt));

    return { all, calendar, lives, pendingCurrent, history };
  }, [exclusive.rows, greetingRows, live.rows, meet.rows]);

  // El error de lives NO se propaga: si falla la consulta de lives, el resto del
  // calendario (sesiones) sigue funcionando; solo no se muestran los lives.
  const error =
    [meet.error, exclusive.error, greetingError]
      .filter(Boolean)
      .join(" ") || null;

  return {
    loading: meet.loading || exclusive.loading || live.loading || loadingGreetings,
    error,
    ...derived,
  };
}

