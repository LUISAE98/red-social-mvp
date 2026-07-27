"use client";

// Tasas de cambio: una sola fuente para toda la app.
//
// Lee UN solo documento `config/exchangeRates` en Firestore con listener
// persistente y caché en memoria (mismo patrón que los stores del wallet). Si el
// doc no existe o no hay permiso, cae a tasas MOCK claramente marcadas.
//
// Nadie hace llamadas externas desde componentes ni guarda claves en el frontend:
// una tarea programada (futuro) actualizará ese doc y todos lo leen de ahí.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { type RateMap } from "./format";

export type ExchangeRates = {
  /** Ancla de las tasas. Siempre USD. */
  base: "USD";
  /** Unidades de la moneda por 1 USD. */
  rates: RateMap;
  /** "live" = doc real de Firestore; "mock" = placeholder (no usar para cobros). */
  source: "live" | "mock";
  updatedAt: Date | null;
};

/**
 * Tasas MOCK (placeholder aproximado) — 1 USD = X moneda.
 * NO son definitivas ni sirven para cobros reales; se reemplazan por el doc
 * `config/exchangeRates`. Los valores volátiles (ARS) son solo relleno.
 */
const MOCK: RateMap = {
  USD: 1,
  MXN: 18.5,
  ARS: 1000,
  BOB: 6.9,
  BRL: 5.5,
  CLP: 950,
  COP: 4000,
  CRC: 510,
  GTQ: 7.8,
  HNL: 25,
  NIO: 37,
  PEN: 3.7,
  PYG: 7400,
  DOP: 60,
  UYU: 40,
};

const MOCK_RATES: ExchangeRates = {
  base: "USD",
  rates: MOCK,
  source: "mock",
  updatedAt: null,
};

function toDate(v: unknown): Date | null {
  if (v && typeof (v as { toDate?: unknown }).toDate === "function") {
    try {
      return (v as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  return null;
}

type Store = {
  data: ExchangeRates;
  unsub: (() => void) | null;
  subs: Set<() => void>;
};
const store: Store = { data: MOCK_RATES, unsub: null, subs: new Set() };

function notify() {
  store.subs.forEach((fn) => fn());
}

function ensureSub() {
  if (store.unsub) return;
  store.unsub = onSnapshot(
    doc(db, "config", "exchangeRates"),
    (snap) => {
      const d = snap.exists() ? snap.data() : null;
      const rates = d && typeof d === "object" ? (d.rates as RateMap | undefined) : undefined;
      store.data =
        rates && typeof rates === "object"
          ? { base: "USD", rates, source: "live", updatedAt: toDate(d?.updatedAt) }
          : MOCK_RATES;
      notify();
    },
    () => {
      // Sin permiso o error: mantenemos las tasas MOCK.
      store.data = MOCK_RATES;
      notify();
    }
  );
}

/** Suscribe (con caché compartida) a las tasas de cambio vigentes. */
export function useExchangeRates(): ExchangeRates {
  useEffect(() => {
    ensureSub();
  }, []);
  const subscribe = useCallback((cb: () => void) => {
    store.subs.add(cb);
    return () => {
      store.subs.delete(cb);
    };
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => store.data,
    () => MOCK_RATES
  );
}
