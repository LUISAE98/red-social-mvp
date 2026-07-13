"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
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
    const unsub = onSnapshot(
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
      () => setState((s) => ({ ...s, loading: false }))
    );
    return () => unsub();
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
      } finally {
        setStarting(false);
      }
    },
    [starting]
  );

  return { ...state, starting, startKyc };
}
