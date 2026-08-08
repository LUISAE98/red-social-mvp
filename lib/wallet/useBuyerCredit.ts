"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Saldo a favor del COMPRADOR (crédito por devoluciones, gastable en la app, no
// retirable). Fuente: `users/{uid}/buyerCredit/current` (solo el backend lo mantiene;
// el cliente lo LEE). Todo en MXN canónico. Ver reglas `buyerCredit`.

export type BuyerCreditState = {
  balance: number; // MXN
  currency: string;
  loading: boolean;
};

const INITIAL: BuyerCreditState = { balance: 0, currency: "MXN", loading: true };

export function useBuyerCredit(uid: string | null | undefined): BuyerCreditState {
  const [state, setState] = useState<BuyerCreditState>(INITIAL);

  useEffect(() => {
    if (!uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ balance: 0, currency: "MXN", loading: false });
      return;
    }
    const ref = doc(db, "users", uid, "buyerCredit", "current");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const d = snap.data();
        const balance =
          typeof d?.balance === "number" && Number.isFinite(d.balance) ? d.balance : 0;
        const currency = typeof d?.currency === "string" ? d.currency : "MXN";
        setState({ balance, currency, loading: false });
      },
      () => setState({ balance: 0, currency: "MXN", loading: false })
    );
    return () => unsub();
  }, [uid]);

  return state;
}
