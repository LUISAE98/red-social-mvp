"use client";

// País del COMPRADOR para fines de impuestos (IVA). Señal de ubicación al comprar.
//
// Fuente hoy (Fase 1):
//   • Cookie `vibra_country` = país por IP (la fija/refresca el middleware con la
//     cabecera x-vercel-ip-country). Refleja DÓNDE ESTÁ el comprador AHORA, no una
//     preferencia pegajosa: un extranjero de viaje en México reporta MX y paga IVA.
//
// Señal futura (Fase 2 — cobro real / dLocal):
//   • País del MÉTODO DE PAGO (tarjeta, por el BIN) al checkout. Corrobora/gana sobre
//     la IP. Regla Art. 18-C: basta que UNA señal apunte a México para cobrar IVA.
//   • 🔁 DLOCAL-MIGRATION: la determinación AUTORITATIVA del país fiscal debe hacerse
//     en el backend al cobrar (IP del request + país de la tarjeta), no confiar en el
//     cliente para el dinero. Este hook es solo para MOSTRAR el estimado.
//
// Ver la matriz fiscal en docs/legal/fiscal-iva-isr-plataforma.md (§3, Art. 18-C).

import { useEffect, useState } from "react";

function readCountryCookie(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)vibra_country=([^;]+)/);
    const v = m?.[1]?.toUpperCase();
    return v && /^[A-Z]{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * País ISO-3166 alpha-2 del comprador por IP, o null si aún no se conoce (primer
 * render antes de hidratar, o sin cabecera de geo). Se resuelve en efecto para no
 * romper la hidratación (mismo patrón que CurrencyProvider).
 */
export function useBuyerCountry(): string | null {
  // SOLO MÉXICO por ahora: si no hay cookie de país, se asume MX (16% IVA), igual que
  // el backend al cobrar. Al internacionalizar, quitar este default.
  const [country, setCountry] = useState<string | null>("MX");
  useEffect(() => {
    const c = readCountryCookie();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c) setCountry(c);
    // solo al montar
  }, []);
  return country;
}
