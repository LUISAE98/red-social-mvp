"use client";

import { useSyncExternalStore } from "react";

/**
 * En qué moneda lee el creador SU wallet.
 *
 * No es la moneda del switch global (esa dice en qué moneda ve los PRECIOS de la
 * plataforma). Esto es distinto: su dinero se liquida en USD, así que el USD es la
 * cifra que de verdad va a cobrar. La lectura en su moneda local existe para que se
 * ubique, no para liquidar.
 *
 * Por eso el modo arranca en "usd": la cifra autoritativa manda, y la local es opcional.
 *
 * Vive fuera de React (`useSyncExternalStore`) porque lo consumen las cinco pestañas y
 * el rail a la vez, y todas tienen que cambiar en el mismo instante. Persiste en
 * localStorage para que la elección sobreviva a recargas y se sincronice entre pestañas.
 */
export type WalletCurrencyMode = "usd" | "local";

const STORAGE_KEY = "vibra:walletCurrencyMode";
const listeners = new Set<() => void>();
let mode: WalletCurrencyMode = "usd";

function readFromStorage(): WalletCurrencyMode {
  if (typeof window === "undefined") return "usd";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "local" ? "local" : "usd";
  } catch {
    return "usd";
  }
}

if (typeof window !== "undefined") {
  mode = readFromStorage();
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      mode = readFromStorage();
      listeners.forEach((l) => l());
    }
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): WalletCurrencyMode {
  return mode;
}

function getServerSnapshot(): WalletCurrencyMode {
  return "usd";
}

export function setWalletCurrencyMode(next: WalletCurrencyMode): void {
  if (mode === next) return;
  mode = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin acceso a localStorage: el modo vive solo en memoria esta sesión.
    }
  }
  listeners.forEach((l) => l());
}

export function useWalletCurrencyMode(): WalletCurrencyMode {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
