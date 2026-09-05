"use client";

// Estado global de la moneda de VISUALIZACIÓN.
//
// - Se siembra en el servidor (prop `initial`, resuelta desde cookie/IP) para que
//   el primer render ya salga en la moneda correcta, sin flash.
// - Al iniciar sesión, adopta la preferencia guardada en la cuenta (máxima prioridad).
// - Al cambiarla, persiste en cookie y, si hay sesión, en `preferredCurrency`.
//
// Esta moneda es SOLO para mostrar precios. No toca cobros, ledger ni contabilidad.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { isDisplayCurrency, type DisplayCurrency } from "@/lib/currency/catalog";

const COOKIE = "vibra_currency";
const ONE_YEAR = 60 * 60 * 24 * 365;

type CurrencyCtx = {
  currency: DisplayCurrency;
  setCurrency: (next: DisplayCurrency) => void;
};

const CurrencyContext = createContext<CurrencyCtx>({
  currency: "USD",
  setCurrency: () => {},
});

function writeCookie(value: string) {
  try {
    document.cookie = `${COOKIE}=${value}; max-age=${ONE_YEAR}; path=/; samesite=lax`;
  } catch {
    // no-op
  }
}

function readCookie(): DisplayCurrency | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)vibra_currency=([^;]+)/);
    const v = m?.[1];
    return isDisplayCurrency(v) ? v : null;
  } catch {
    return null;
  }
}

export function CurrencyProvider({
  initial = "USD",
  children,
}: {
  /**
   * Moneda con la que se pinta el PRIMER render, servidor y cliente por igual.
   *
   * 🚨 Pásala siempre desde el servidor. `app/layout.tsx` la resuelve de la
   * cookie `vibra_currency`; si no llega, esto cae a USD y el servidor pinta una
   * moneda distinta de la que el efecto de abajo pondrá al montar — que es
   * exactamente el error de hidratación que se arrastró hasta el 2026-09-04.
   */
  initial?: DisplayCurrency;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const [currency, setCurrencyState] = useState<DisplayCurrency>(initial);

  // Tras montar, adopta la moneda persistida en la cookie (default por IP la fija
  // el middleware). Se hace en efecto para NO romper la hidratación (SSR = MXN).
  useEffect(() => {
    const c = readCookie();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c && c !== currency) setCurrencyState(c);
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Al iniciar sesión, la preferencia de la cuenta manda (cross-device).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        const pref = snap.data()?.preferredCurrency;
        if (!cancelled && isDisplayCurrency(pref)) {
          setCurrencyState(pref);
          writeCookie(pref);
        }
      })
      .catch(() => {
        // sin permiso/doc: mantenemos la moneda actual
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const setCurrency = useCallback(
    (next: DisplayCurrency) => {
      setCurrencyState(next);
      writeCookie(next);
      if (user) {
        setDoc(doc(db, "users", user.uid), { preferredCurrency: next }, { merge: true }).catch(
          () => {
            // la cookie ya persiste la elección aunque falle la escritura
          }
        );
      }
    },
    [user]
  );

  const value = useMemo(() => ({ currency, setCurrency }), [currency, setCurrency]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
