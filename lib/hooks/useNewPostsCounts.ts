"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getLastVisitTimestamp,
  setLastVisitTimestamp,
} from "@/lib/utils/visitTimestamps";

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type NewPostsEntity = { id: string; kind: "profile" | "group" };

export function useNewPostsCounts(
  entities: NewPostsEntity[],
  currentUserId: string | null | undefined
): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const entityKey = useMemo(
    () => entities.map((e) => `${e.kind}:${e.id}`).join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entities.map((e) => `${e.kind}:${e.id}`).join(",")]
  );

  useEffect(() => {
    if (!entities.length || !currentUserId) return;
    const viewerId: string = currentUserId;
    let cancelled = false;

    async function fetchCounts() {
      const results: Record<string, number> = {};

      await Promise.all(
        entities.map(async ({ id, kind }) => {
          let lastVisit = getLastVisitTimestamp(id);
          if (!lastVisit) {
            lastVisit = Date.now() - DEFAULT_WINDOW_MS;
            setLastVisitTimestamp(id);
          }

          try {
            // Single-field equality filter only — uses Firestore's auto-created
            // single-field index, so no composite index deployment needed.
            // isVisible and createdAt are filtered client-side.
            const filterField = kind === "profile" ? "profileId" : "groupId";

            const q = query(
              collection(db, "users", viewerId, "homeFeed"),
              where(filterField, "==", id)
            );

            const snap = await getDocs(q);
            const cutoff = lastVisit;
            const count = snap.docs.filter((d) => {
              const data = d.data();
              const ms: number = data.createdAt?.toMillis?.() ?? 0;
              return data.isVisible === true && ms > cutoff;
            }).length;

            if (count > 0) results[id] = count;
          } catch (err) {
            console.error(
              `[useNewPostsCounts] query failed for ${kind}:${id}`,
              err
            );
          }
        })
      );

      if (!cancelled) setCounts(results);
    }

    void fetchCounts();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey, currentUserId]);

  return counts;
}
