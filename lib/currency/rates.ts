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
  /** Ancla de las tasas. Siempre MXN. */
  base: "MXN";
  /** Unidades de la moneda por 1 MXN. */
  rates: RateMap;
  /** "live" = doc real de Firestore; "mock" = placeholder (no usar para cobros). */
  source: "live" | "mock";
  updatedAt: Date | null;
};

/**
 * Tasas MOCK (placeholder aproximado) — 1 MXN = X moneda.
 * NO son definitivas ni sirven para cobros reales; se reemplazan por el doc
 * `config/exchangeRates`. Los valores volátiles (ARS, VES, CUP) son solo relleno.
 */
const MOCK: RateMap = {
  MXN: 1,
  USD: 0.054,
  CAD: 0.074,
  ARS: 54,
  BRL: 0.3,
  CLP: 51,
  COP: 220,
  PEN: 0.2,
  UYU: 2.2,
  BSD: 0.054,
  BBD: 0.108,
  BZD: 0.108,
  BOB: 0.37,
  CRC: 27,
  CUP: 1.3,
  XCD: 0.145,
  GTQ: 0.42,
  GYD: 11.3,
  HTG: 7.2,
  HNL: 1.35,
  JMD: 8.5,
  NIO: 2,
  PYG: 400,
  DOP: 3.3,
  TTD: 0.37,
  VES: 5,
};

const MOCK_RATES: ExchangeRates = {
  base: "MXN",
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
          ? { base: "MXN", rates, source: "live", updatedAt: toDate(d?.updatedAt) }
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
