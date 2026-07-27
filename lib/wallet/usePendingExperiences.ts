"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import {
  useScheduledRows,
  isSafePendingStatus,
  shouldTreatAsAutoRejected,
} from "./ownerWallet";

// Estados de sesión ACCIONABLES en Experiencias (por atender / agendar / reagendar).
// Las agendadas/en curso ya NO cuentan: se ven en el historial del wallet.
const ACTIONABLE_SESSION_STATUSES = [
  "pending_creator_response",
  "accepted_pending_schedule",
  "reschedule_requested",
];

/**
 * ¿El creador tiene experiencias pendientes por atender o agendadas activas?
 *
 * Es el gate del subnav de notificaciones: el subnav aparece SOLO mientras haya
 * experiencias ACCIONABLES (saludos/consejos por grabar, o sesiones/tiempo
 * contigo por atender, agendar o reagendar). Las agendadas/en curso/entregadas
 * NO cuentan —se ven en el historial del wallet—, así que el subnav desaparece
 * cuando el creador atiende todo lo pendiente.
 *
 * Es una versión ligera: solo 3 listeners (tiempo contigo + sesión exclusiva +
 * saludos), sin lives ni el fetch de datos del comprador. Debe coincidir con lo
 * que muestra `ExperienceRequestsInbox`.
 *
 * Pásale `null` cuando el usuario no vende experiencias (ver `useWalletVisibility`)
 * para no abrir listeners de más: con `null` no se suscribe a nada.
 */
export function usePendingExperiences(creatorId: string | null | undefined) {
  const meet = useScheduledRows(creatorId, "meetGreetRequests", "meet_greet");
  const exclusive = useScheduledRows(
    creatorId,
    "exclusiveSessionRequests",
    "exclusive_session"
  );

  // Saludos/consejos por atender = status "pending" (misma regla que pendingCurrent).
  const [pendingGreetings, setPendingGreetings] = useState(0);
  // Timestamp del saludo/consejo pendiente más reciente (para "hay nuevos").
  const [latestGreetingMs, setLatestGreetingMs] = useState(0);
  const [loadingGreetings, setLoadingGreetings] = useState(true);

  useEffect(() => {
    if (!creatorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingGreetings(0);
      setLatestGreetingMs(0);
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
        where("creatorId", "==", creatorId),
        limit(100)
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          let count = 0;
          let latest = 0;
          snap.docs.forEach((d) => {
            const data = d.data();
            if ((data.status ?? "") !== "pending") return;
            count += 1;
            const ms = toMs(data.updatedAt) ?? toMs(data.createdAt) ?? 0;
            if (ms > latest) latest = ms;
          });
          setPendingGreetings(count);
          setLatestGreetingMs(latest);
          setLoadingGreetings(false);
        },
        () => {
          setPendingGreetings(0);
          setLatestGreetingMs(0);
          setLoadingGreetings(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [creatorId]);

  const sessions = useMemo(() => {
    const actionable = [...meet.rows, ...exclusive.rows].filter(
      (row) =>
        ACTIONABLE_SESSION_STATUSES.includes(row.status) &&
        !shouldTreatAsAutoRejected(row) &&
        isSafePendingStatus(row.status)
    );
    const latest = actionable.reduce(
      (m, r) => Math.max(m, r.updatedAt?.getTime() ?? r.createdAt?.getTime() ?? 0),
      0
    );
    return { count: actionable.length, latest };
  }, [meet.rows, exclusive.rows]);

  const count = sessions.count + pendingGreetings;
  // Timestamp de la experiencia accionable más reciente (para decidir si hay
  // experiencias NUEVAS desde la última vez que se vio la pestaña).
  const latestMs = Math.max(sessions.latest, latestGreetingMs);

  return {
    count,
    hasPending: count > 0,
    latestMs,
    loading: meet.loading || exclusive.loading || loadingGreetings,
  };
}

function toMs(value: unknown): number | null {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}
