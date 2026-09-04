"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
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

// ── "Visto" (badge) vs "leído" (por ítem) ────────────────────────────────────
// Abrir el contenedor de notificaciones baja el badge de la campanita a 0 (todo
// "visto"), pero NO marca las notificaciones como leídas: cada ítem sigue
// marcado como no leído hasta que se abre.
// `seenAt` se persiste en Firestore (`users/{uid}/meta/notifications.seenAt`)
// como fuente de verdad — así sobrevive logout, cierre de app y cambio de
// dispositivo. localStorage es solo una caché instantánea (y pub/sub entre la
// campanita y el nav móvil dentro de la misma pestaña).
const SEEN_KEY_PREFIX = "vibra:notifSeenAt:";
const seenListeners = new Set<() => void>();

function seenKey(uid: string): string {
  return SEEN_KEY_PREFIX + uid;
}

function readSeenAt(uid: string | null | undefined): number {
  if (!uid || typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(seenKey(uid));
  return raw ? Number(raw) || 0 : 0;
}

function writeSeenAt(uid: string, ms: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(seenKey(uid), String(ms));
  seenListeners.forEach((l) => l());
}

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
    bulk: data.bulk === true,
  };
}

export interface UseNotificationsResult {
  items: AppNotification[];
  /** No leídas (estado por ítem) — para el estilo de cada notificación. */
  unreadCount: number;
  /** Nuevas desde la última vez que se abrió el contenedor — para el badge. */
  badgeCount: number;
  /**
   * Timestamp de SERVIDOR de la notificación más reciente, o 0 si no hay.
   *
   * Lo necesita quien llama a `markSeen`: si se marca mientras la bandeja aún
   * está cargando no hay nada que marcar, y hay que volver a marcar cuando
   * llegue. Depender de este valor es lo que hace que ese segundo intento pase.
   */
  latestMs: number;
  loading: boolean;
  /** Marca todo como "visto" (baja el badge a 0) sin marcar como leído. */
  markSeen: () => void;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  /** Lectura fresca puntual (para pull-to-refresh); resuelve al terminar. */
  refresh: () => Promise<void>;
}

/**
 * Suscribe la bandeja `users/{uid}/notifications` en tiempo real, ordenada por
 * `updatedAt desc` (las notificaciones agregadas re-emergen al recibir actividad
 * nueva). Deriva conteos del mismo snapshot: sin índices extra.
 */
export function useNotifications(uid: string | null | undefined): UseNotificationsResult {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [seenAt, setSeenAt] = useState(0);

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

  // Carga `seenAt`: optimista desde localStorage y luego la fuente de verdad
  // desde Firestore (persiste tras logout/cierre). Se queda con el mayor.
  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSeenAt(0);
      return;
    }
    setSeenAt(readSeenAt(uid));
    let alive = true;
    getDoc(doc(db, "users", uid, "meta", "notifications"))
      .then((snap) => {
        if (!alive) return;
        const remote = snap.exists() ? Number(snap.get("seenAt")) || 0 : 0;
        if (remote > 0) {
          setSeenAt((cur) => Math.max(cur, remote));
          if (remote > readSeenAt(uid)) writeSeenAt(uid, remote); // sincroniza caché
        }
      })
      .catch(() => {});
    const l = () => setSeenAt((cur) => Math.max(cur, readSeenAt(uid)));
    seenListeners.add(l);
    window.addEventListener("storage", l);
    return () => {
      alive = false;
      seenListeners.delete(l);
      window.removeEventListener("storage", l);
    };
  }, [uid]);

  const latestMs = useMemo(
    () => items.reduce((m, n) => Math.max(m, n.updatedAtMs ?? 0), 0),
    [items]
  );
  // El mismo valor en una referencia, para que `markSeen` no cambie de
  // identidad cada vez que llega una notificación: es dependencia de efectos
  // que marcan visto, y rehacerla los dispararía en bucle.
  const latestMsRef = useRef(0);
  useEffect(() => {
    latestMsRef.current = latestMs;
  }, [latestMs]);

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items]);
  const badgeCount = useMemo(
    () => items.filter((n) => (n.updatedAtMs ?? 0) > seenAt).length,
    [items, seenAt]
  );

  /**
   * Marca visto hasta el timestamp de SERVIDOR de la más reciente.
   *
   * 🚨 NUNCA `Date.now()`. `badgeCount` compara contra `updatedAtMs`, que lo
   * pone el servidor; guardar aquí el reloj del cliente mezcla dos relojes que
   * no tienen por qué coincidir. Con el del cliente adelantado —basta un
   * minuto— el "visto" queda en el futuro y NINGUNA notificación social
   * posterior vuelve a contar como nueva.
   *
   * Eso no solo apagaba el badge: dejaba `badgeCount` clavado en 0, y como la
   * pestaña por defecto de notificaciones se decide con ese contador, se abría
   * SIEMPRE en Experiencias aunque lo que hubiera llegado fuera social.
   *
   * `useExperiencesSeen` ya guardaba el timestamp de servidor exactamente por
   * este motivo, con el aviso escrito. Este lado se quedó sin arreglar.
   */
  const markSeen = useCallback(() => {
    if (!uid) return;
    const ms = Math.max(readSeenAt(uid), latestMsRef.current);
    // Bandeja vacía o aún cargando: no hay nada que marcar, y escribir un 0
    // solo borraría el "visto" que ya hubiera. Quien llama vuelve a intentarlo
    // cuando `latestMs` cambie.
    if (ms <= 0) return;
    writeSeenAt(uid, ms); // localStorage + notifica listeners (actualiza estado)
    // Persiste server-side para que el badge no reaparezca tras logout/cierre.
    setDoc(doc(db, "users", uid, "meta", "notifications"), { seenAt: ms }, { merge: true }).catch(
      () => {}
    );
  }, [uid]);

  // Lectura fresca puntual para el pull-to-refresh. El listener onSnapshot ya
  // mantiene la bandeja al día; esto sólo fuerza una relectura que resuelve al
  // terminar, para que el spinner del gesto tenga una acción real.
  const refresh = useCallback(async () => {
    if (!uid) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "users", uid, "notifications"),
          orderBy("updatedAt", "desc"),
          limit(FEED_LIMIT)
        )
      );
      const mapped = snap.docs
        .map((d) => mapDoc(d.id, d.data() as Record<string, unknown>))
        .filter((n): n is AppNotification => n !== null);
      setItems(mapped);
    } catch {
      /* no crítico: el listener sigue vivo */
    }
  }, [uid]);

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

  return { items, unreadCount, badgeCount, latestMs, loading, markSeen, markAllRead, markRead, refresh };
}
