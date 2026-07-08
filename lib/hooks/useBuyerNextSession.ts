"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type BuyerNextSession = {
  id: string;
  serviceKind: "meet_greet" | "exclusive_session";
  scheduledAt: Date;
  creatorDisplayName: string | null;
  status: string;
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

function isVisibleToday(scheduledAt: Date): boolean {
  const now = new Date();
  const sameDay =
    now.getFullYear() === scheduledAt.getFullYear() &&
    now.getMonth() === scheduledAt.getMonth() &&
    now.getDate() === scheduledAt.getDate();
  if (!sameDay) return false;
  const oneAmToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 1, 0, 0, 0);
  return now >= oneAmToday;
}

export function useBuyerNextSession(uid: string | null): {
  session: BuyerNextSession | null;
  loading: boolean;
} {
  const [session, setSession] = useState<BuyerNextSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setSession(null);
      setLoading(false);
      return;
    }

    const candidates = new Map<string, BuyerNextSession>();
    let mgLoaded = false;
    let esLoaded = false;

    function pick() {
      if (!mgLoaded || !esLoaded) return;
      const visible = Array.from(candidates.values())
        .filter((s) => isVisibleToday(s.scheduledAt))
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      setSession(visible[0] ?? null);
      setLoading(false);
    }

    const mgQ = query(
      collection(db, "meetGreetRequests"),
      where("buyerId", "==", uid),
      where("status", "in", ACTIVE_STATUSES)
    );

    const esQ = query(
      collection(db, "exclusiveSessionRequests"),
      where("buyerId", "==", uid),
      where("status", "in", ACTIVE_STATUSES)
    );

    const unsubMg = onSnapshot(mgQ, (snap) => {
      const mgIds = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data() as {
          scheduledAt?: unknown;
          creatorDisplayName?: string | null;
          status?: string;
        };
        const scheduledAt = toDate(data.scheduledAt);
        if (!scheduledAt) return;
        const key = `mg-${d.id}`;
        mgIds.add(key);
        candidates.set(key, {
          id: d.id,
          serviceKind: "meet_greet",
          scheduledAt,
          creatorDisplayName: data.creatorDisplayName ?? null,
          status: data.status ?? "scheduled",
        });
      });
      for (const k of candidates.keys()) {
        if (k.startsWith("mg-") && !mgIds.has(k)) candidates.delete(k);
      }
      mgLoaded = true;
      pick();
    });

    const unsubEs = onSnapshot(esQ, (snap) => {
      const esIds = new Set<string>();
      snap.docs.forEach((d) => {
        const data = d.data() as {
          scheduledAt?: unknown;
          creatorDisplayName?: string | null;
          status?: string;
        };
        const scheduledAt = toDate(data.scheduledAt);
        if (!scheduledAt) return;
        const key = `es-${d.id}`;
        esIds.add(key);
        candidates.set(key, {
          id: d.id,
          serviceKind: "exclusive_session",
          scheduledAt,
          creatorDisplayName: data.creatorDisplayName ?? null,
          status: data.status ?? "scheduled",
        });
      });
      for (const k of candidates.keys()) {
        if (k.startsWith("es-") && !esIds.has(k)) candidates.delete(k);
      }
      esLoaded = true;
      pick();
    });

    return () => {
      unsubMg();
      unsubEs();
    };
  }, [uid]);

  return { session, loading };
}
