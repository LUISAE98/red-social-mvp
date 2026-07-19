"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  AppNotification,
  KNOWN_NOTIFICATION_TYPES,
  NotificationActor,
  NotificationTarget,
  NotificationType,
} from "@/lib/notifications/types";

const FEED_LIMIT = 40;

function toMs(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

function mapDoc(id: string, data: Record<string, unknown>): AppNotification | null {
  const type = data.type as NotificationType | undefined;
  if (!type) return null;

  const actors = Array.isArray(data.actors)
    ? (data.actors as NotificationActor[]).filter((a) => a && typeof a.id === "string")
    : [];
  const message = typeof data.message === "string" ? data.message : null;

  // Tipos que no sabemos renderizar y que además no traen texto genérico → se omiten.
  if (!KNOWN_NOTIFICATION_TYPES.has(type) && !message) return null;

  return {
    id,
    type,
    actors,
    actorCount:
      typeof data.actorCount === "number" ? data.actorCount : actors.length || 1,
    target: (data.target as NotificationTarget) ?? {},
    read: data.read === true,
    createdAtMs: toMs(data.createdAt),
    updatedAtMs: toMs(data.updatedAt) ?? toMs(data.createdAt),
    message,
  };
}

export interface UseNotificationsResult {
  items: AppNotification[];
  unreadCount: number;
  loading: boolean;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
}

/**
 * Suscribe la bandeja `users/{uid}/notifications` en tiempo real, ordenada por
 * `updatedAt desc` (las notificaciones agregadas re-emergen al recibir actividad
 * nueva). Deriva el conteo de no leídas del mismo snapshot: sin índices extra.
 */
export function useNotifications(uid: string | null | undefined): UseNotificationsResult {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(db, "users", uid, "notifications"),
      orderBy("updatedAt", "desc"),
      limit(FEED_LIMIT)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const mapped = snap.docs
          .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
          .filter((n): n is AppNotification => n !== null);
        setItems(mapped);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsub;
  }, [uid]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const markRead = async (id: string) => {
    if (!uid) return;
    try {
      await updateDoc(doc(db, "users", uid, "notifications", id), { read: true });
    } catch {
      /* no crítico */
    }
  };

  const markAllRead = async () => {
    if (!uid) return;
    const unread = items.filter((n) => !n.read);
    if (unread.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const n of unread) {
        batch.update(doc(db, "users", uid, "notifications", n.id), { read: true });
      }
      await batch.commit();
    } catch {
      /* no crítico */
    }
  };

  return { items, unreadCount, loading, markAllRead, markRead };
}
