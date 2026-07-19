"use client";

import { useSyncExternalStore } from "react";

// Estado compartido "ocultar saldo" (privacidad). Lo consumen el header (cartera
// de la izquierda) y el rail derecho del wallet; al alternarlo en uno se refleja
// en el otro en vivo, y persiste en localStorage entre recargas y pestañas.
const STORAGE_KEY = "vibra:walletBalanceHidden";
const listeners = new Set<() => void>();
let hidden = false;

function readFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

if (typeof window !== "undefined") {
  hidden = readFromStorage();
  // Sincroniza entre pestañas del mismo navegador.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
      hidden = readFromStorage();
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

function getSnapshot(): boolean {
  return hidden;
}

function getServerSnapshot(): boolean {
  return false;
}

export function toggleBalanceHidden(): void {
  hidden = !hidden;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
    } catch {
      // Sin acceso a localStorage: el estado vive solo en memoria esta sesión.
    }
  }
  listeners.forEach((l) => l());
}

export function useBalanceHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
