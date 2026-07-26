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
  const [loadingGreetings, setLoadingGreetings] = useState(true);

  useEffect(() => {
    if (!creatorId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingGreetings(0);
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
          setPendingGreetings(
            snap.docs.filter((d) => (d.data().status ?? "") === "pending").length
          );
          setLoadingGreetings(false);
        },
        () => {
          setPendingGreetings(0);
          setLoadingGreetings(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [creatorId]);

  const scheduledPending = useMemo(() => {
    return [...meet.rows, ...exclusive.rows].filter(
      (row) =>
        ACTIONABLE_SESSION_STATUSES.includes(row.status) &&
        !shouldTreatAsAutoRejected(row) &&
        isSafePendingStatus(row.status)
    ).length;
  }, [meet.rows, exclusive.rows]);

  const count = scheduledPending + pendingGreetings;

  return {
    count,
    hasPending: count > 0,
    loading: meet.loading || exclusive.loading || loadingGreetings,
  };
}
