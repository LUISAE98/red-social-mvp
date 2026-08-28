"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "@/lib/firebase";
import { captureError } from "@/lib/observability/captureError";
import type { KycStatus } from "@/types/kyc";

type KycState = {
  status: KycStatus;
  approved: boolean;
  reason: string | null;
  loading: boolean;
};

const DEFAULT: KycState = {
  status: "not_started",
  approved: false,
  reason: null,
  loading: true,
};

type CreateKycSessionResult = { alreadyApproved: boolean; url: string | null };

/**
 * Suscribe al estado de KYC del usuario (kyc/{uid}) en tiempo real y expone
 * `startKyc` para iniciar la verificación: crea la sesión en Didit y redirige
 * al flujo hosted. El resultado real regresa por webhook y actualiza el estado
 * automáticamente vía este listener.
 */
export function useKyc(uid: string | null | undefined) {
  const [state, setState] = useState<KycState>(DEFAULT);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!uid) {
      setState({ ...DEFAULT, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    let unsub: (() => void) | null = null;
    let cancelled = false;
    // Esperar a que Firebase Auth resuelva el token antes de suscribir; si el
    // listener arranca antes, request.auth llega null → permission-denied transitorio.
    auth.authStateReady().then(() => {
      if (cancelled) return;
      unsub = onSnapshot(
        doc(db, "kyc", uid),
        (snap) => {
          const d = snap.data();
          if (!d) {
            setState({ status: "not_started", approved: false, reason: null, loading: false });
            return;
          }
          setState({
            status: (d.status as KycStatus) ?? "not_started",
            approved: d.kycApproved === true,
            reason: typeof d.reason === "string" ? d.reason : null,
            loading: false,
          });
        },
        (err) => {
          captureError(err, { scope: "kyc", extra: { where: "kyc_snapshot" } });
          setState((s) => ({ ...s, loading: false }));
        }
      );
    });
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  const startKyc = useCallback(
    async (locale: string) => {
      if (starting) return;
      setStarting(true);
      try {
        const fn = httpsCallable<{ locale: string; origin: string }, CreateKycSessionResult>(
          functions,
          "createKycSession"
        );
        const res = await fn({ locale, origin: window.location.origin });
        if (res.data.url) {
          // Salimos de Vibra al flujo hosted de Didit; vuelve solo al terminar.
          window.location.href = res.data.url;
        }
        return res.data;
      } catch (err) {
        // El usuario no pudo iniciar su verificación (gate de retiros): reportar.
        captureError(err, {
          scope: "kyc",
          code: (err as { code?: string } | null)?.code,
          extra: { where: "startKyc" },
        });
        throw err;
      } finally {
        setStarting(false);
      }
    },
    [starting]
  );

  return { ...state, starting, startKyc };
}
