"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type BuyerNextSession = {
  id: string;
  serviceKind: "meet_greet" | "exclusive_session";
  scheduledAt: Date;
  creatorDisplayName: string | null;
  creatorAvatarUrl: string | null;
  durationMinutes: number | null;
  status: string;
  preparingBuyerAt: Date | null;
  preparingCreatorAt: Date | null;
};

export type UseBuyerNextSessionResult = {
  session: BuyerNextSession | null;
  completedSession: BuyerNextSession | null;
  loading: boolean;
};

const ACTIVE_STATUSES = ["scheduled", "ready_to_prepare", "in_preparation", "completed", "session_incomplete", "auto_rejected_no_show"];

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

function buildEntry(
  id: string,
  serviceKind: "meet_greet" | "exclusive_session",
  data: {
    scheduledAt?: unknown;
    creatorDisplayName?: string | null;
    creatorAvatarUrl?: string | null;
    durationMinutes?: number | null;
    status?: string;
    preparingBuyerAt?: unknown;
    preparingCreatorAt?: unknown;
  },
  scheduledAt: Date
): BuyerNextSession {
  return {
    id,
    serviceKind,
    scheduledAt,
    creatorDisplayName: data.creatorDisplayName ?? null,
    creatorAvatarUrl: data.creatorAvatarUrl ?? null,
    durationMinutes: data.durationMinutes ?? null,
    status: data.status ?? "scheduled",
    preparingBuyerAt: toDate(data.preparingBuyerAt),
    preparingCreatorAt: toDate(data.preparingCreatorAt),
  };
}

export function useBuyerNextSession(uid: string | null): UseBuyerNextSessionResult {
  const [result, setResult] = useState<UseBuyerNextSessionResult>({
    session: null,
    completedSession: null,
    loading: true,
  });

  useEffect(() => {
    if (!uid) {
      setResult({ session: null, completedSession: null, loading: false });
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

      const active = visible.filter((s) => s.status !== "completed");
      const completed = visible.filter((s) => s.status === "completed");

      setResult({
        session: active[0] ?? null,
        completedSession: completed[completed.length - 1] ?? null,
        loading: false,
      });
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
          creatorAvatarUrl?: string | null;
          durationMinutes?: number | null;
          status?: string;
          preparingBuyerAt?: unknown;
          preparingCreatorAt?: unknown;
        };
        const scheduledAt = toDate(data.scheduledAt);
        if (!scheduledAt) return;
        const key = `mg-${d.id}`;
        mgIds.add(key);
        candidates.set(key, buildEntry(d.id, "meet_greet", data, scheduledAt));
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
          creatorAvatarUrl?: string | null;
          durationMinutes?: number | null;
          status?: string;
          preparingBuyerAt?: unknown;
          preparingCreatorAt?: unknown;
        };
        const scheduledAt = toDate(data.scheduledAt);
        if (!scheduledAt) return;
        const key = `es-${d.id}`;
        esIds.add(key);
        candidates.set(key, buildEntry(d.id, "exclusive_session", data, scheduledAt));
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

  return result;
}
