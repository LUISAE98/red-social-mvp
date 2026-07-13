// Resolución de la moneda de visualización por defecto.
// Puro: usable en middleware (edge), servidor y cliente.
//
// Prioridad:
//   1. Preferencia guardada del usuario autenticado (preferredCurrency).
//   2. Preferencia guardada en cookie (usuario no autenticado o sesión anterior).
//   3. País detectado por IP.
//   4. Fallback: MXN.
//
// La detección por IP solo debe usarse cuando NO exista preferencia previa; una
// selección manual nunca se sobrescribe automáticamente.

import { displayCurrencyForCountry, isDisplayCurrency, type DisplayCurrency } from "./catalog";

export function resolveDefaultCurrency(input: {
  userPreferred?: string | null;
  cookie?: string | null;
  country?: string | null;
}): DisplayCurrency {
  if (isDisplayCurrency(input.userPreferred)) return input.userPreferred;
  if (isDisplayCurrency(input.cookie)) return input.cookie;
  if (input.country) return displayCurrencyForCountry(input.country);
  return "MXN";
}
