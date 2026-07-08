"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type CreatorSession = {
  id: string;
  serviceKind: "meet_greet" | "exclusive_session";
  scheduledAt: Date;
  buyerDisplayName: string | null;
  buyerAvatarUrl: string | null;
  durationMinutes: number | null;
  status: string;
  preparingBuyerAt: Date | null;
  preparingCreatorAt: Date | null;
};

export type UseCreatorTodaySessionsResult = {
  nextSession: CreatorSession | null;
  todaySessions: CreatorSession[];
  loading: boolean;
};

const ACTIVE_STATUSES = ["scheduled", "ready_to_prepare", "in_preparation"];

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const d = (value as { toDate: () => Date }).toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  return null;
}

function isToday(scheduledAt: Date): boolean {
  const now = new Date();
  return (
    now.getFullYear() === scheduledAt.getFullYear() &&
    now.getMonth() === scheduledAt.getMonth() &&
    now.getDate() === scheduledAt.getDate()
  );
}

function isVisibleNow(): boolean {
  const now = new Date();
  const oneAm = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0, 0);
  return now >= oneAm;
}

function pickNext(sessions: CreatorSession[]): CreatorSession | null {
  const nowMs = Date.now();
  const upcoming = sessions.filter((s) => s.scheduledAt.getTime() > nowMs);
  if (upcoming.length > 0) return upcoming[0];
  // All started — return the most recently started for elapsed counter
  return sessions[sessions.length - 1] ?? null;
}

export function useCreatorTodaySessions(uid: string | null): UseCreatorTodaySessionsResult {
  const [result, setResult] = useState<UseCreatorTodaySessionsResult>({
    nextSession: null,
    todaySessions: [],
    loading: true,
  });

  useEffect(() => {
    if (!uid) {
      setResult({ nextSession: null, todaySessions: [], loading: false });
      return;
    }

    const candidates = new Map<string, CreatorSession>();
    let mgLoaded = false;
    let esLoaded = false;

    function publish() {
      if (!mgLoaded || !esLoaded) return;
      if (!isVisibleNow()) {
        setResult({ nextSession: null, todaySessions: [], loading: false });
        return;
      }
      const today = Array.from(candidates.values())
        .filter((s) => isToday(s.scheduledAt))
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      setResult({
        nextSession: pickNext(today),
        todaySessions: today,
        loading: false,
      });
    }

    const mgQ = query(
      collection(db, "meetGreetRequests"),
      where("creatorId", "==", uid),
      where("status", "in", ACTIVE_STATUSES)
    );

    const esQ = query(
      collection(db, "exclusiveSessionRequests"),
      where("creatorId", "==", uid),
      where("status", "in", ACTIVE_STATUSES)
    );

    const unsubMg = onSnapshot(mgQ, (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data() as {
          scheduledAt?: unknown;
          buyerDisplayName?: string | null;
          buyerAvatarUrl?: string | null;
          durationMinutes?: number | null;
          status?: string;
          preparingBuyerAt?: unknown;
          preparingCreatorAt?: unknown;
        };
        const scheduledAt = toDate(data.scheduledAt);
        if (!scheduledAt) return;
        const key = `mg-${d.id}`;
        ids.add(key);
        candidates.set(key, {
          id: d.id,
          serviceKind: "meet_greet",
          scheduledAt,
          buyerDisplayName: data.buyerDisplayName ?? null,
          buyerAvatarUrl: data.buyerAvatarUrl ?? null,
          durationMinutes: data.durationMinutes ?? null,
          status: data.status ?? "scheduled",
          preparingBuyerAt: toDate(data.preparingBuyerAt),
          preparingCreatorAt: toDate(data.preparingCreatorAt),
        });
      });
      for (const k of candidates.keys()) {
        if (k.startsWith("mg-") && !ids.has(k)) candidates.delete(k);
      }
      mgLoaded = true;
      publish();
    });

    const unsubEs = onSnapshot(esQ, (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data() as {
          scheduledAt?: unknown;
          buyerDisplayName?: string | null;
          buyerAvatarUrl?: string | null;
          durationMinutes?: number | null;
          status?: string;
          preparingBuyerAt?: unknown;
          preparingCreatorAt?: unknown;
        };
        const scheduledAt = toDate(data.scheduledAt);
        if (!scheduledAt) return;
        const key = `es-${d.id}`;
        ids.add(key);
        candidates.set(key, {
          id: d.id,
          serviceKind: "exclusive_session",
          scheduledAt,
          buyerDisplayName: data.buyerDisplayName ?? null,
          buyerAvatarUrl: data.buyerAvatarUrl ?? null,
          durationMinutes: data.durationMinutes ?? null,
          status: data.status ?? "scheduled",
          preparingBuyerAt: toDate(data.preparingBuyerAt),
          preparingCreatorAt: toDate(data.preparingCreatorAt),
        });
      });
      for (const k of candidates.keys()) {
        if (k.startsWith("es-") && !ids.has(k)) candidates.delete(k);
      }
      esLoaded = true;
      publish();
    });

    return () => {
      unsubMg();
      unsubEs();
    };
  }, [uid]);

  return result;
}
