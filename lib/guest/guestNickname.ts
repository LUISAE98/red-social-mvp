"use client";

// Apodo del invitado, cacheado por DISPOSITIVO (localStorage). Se pre-llena en el
// placeholder de la pasarela y en el de súper comentario / donación en vivo, y es
// editable. Es una comodidad de UI (reutilizable entre compras); NO es identidad ni
// acceso — eso lo da el uid anónimo server-side. Ver [[ensureGuestAuth]].

const KEY = "vibra:guestNickname";
export const GUEST_NICKNAME_MAX = 24;

export function getGuestNickname(): string {
  if (typeof window === "undefined") return "";
  try {
    return (localStorage.getItem(KEY) ?? "").slice(0, GUEST_NICKNAME_MAX);
  } catch {
    return "";
  }
}

export function setGuestNickname(value: string): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = value.trim().slice(0, GUEST_NICKNAME_MAX);
    if (trimmed) localStorage.setItem(KEY, trimmed);
    else localStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible: se ignora */
  }
}
