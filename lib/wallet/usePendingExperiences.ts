"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import {
  useScheduledRows,
  isPendingCurrentScheduledStatus,
  isSafePendingStatus,
  isExpiredScheduledService,
  shouldTreatAsAutoRejected,
} from "./ownerWallet";

/**
 * ¿El creador tiene experiencias pendientes por atender o agendadas activas?
 *
 * Es el gate del subnav de notificaciones: el subnav aparece SOLO mientras haya
 * experiencias vivas (saludos/consejos por grabar, o sesiones/tiempo contigo por
 * atender, agendar o agendadas). Cuando el creador atiende todo, vuelve a
 * desaparecer.
 *
 * Reusa la MISMA definición de "pendiente" que la bandeja de pendientes del
 * wallet (`pendingCurrent` + `isSafePendingStatus` + no expiradas) para no
 * divergir. Es una versión ligera: solo 3 listeners (tiempo contigo + sesión
 * exclusiva + saludos), sin lives ni el fetch de datos del comprador.
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
        isPendingCurrentScheduledStatus(row.status) &&
        !shouldTreatAsAutoRejected(row) &&
        isSafePendingStatus(row.status) &&
        !isExpiredScheduledService(row)
    ).length;
  }, [meet.rows, exclusive.rows]);

  const count = scheduledPending + pendingGreetings;

  return {
    count,
    hasPending: count > 0,
    loading: meet.loading || exclusive.loading || loadingGreetings,
  };
}
