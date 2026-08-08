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
 * País de liquidación. Se usa como último recurso SOLO cuando ya se leyó la cookie y no
 * había ninguna: coincide con el `DEFAULT_COUNTRY` del backend, así que display y cobro
 * caen al mismo lado. Es conservador (cobra IVA en vez de omitirlo).
 */
const FALLBACK_COUNTRY = "MX";

/**
 * País ISO-3166 alpha-2 del comprador por IP, o `null` mientras aún no se conoce (el
 * primer render, antes de que el efecto lea la cookie). Se resuelve en efecto para no
 * romper la hidratación (mismo patrón que CurrencyProvider).
 *
 * ⚠️ Antes arrancaba en "MX" en vez de null. Con un solo país eso era inofensivo, pero al
 * abrir la UE significaba que **un alemán veía 16% mexicano** en el primer render y en
 * cualquier caso sin cookie (bloqueador, sin cabecera de geo). Ahora México solo aparece
 * como fallback DESPUÉS de comprobar que no hay cookie, nunca antes.
 */
export function useBuyerCountry(): string | null {
  const [country, setCountry] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCountry(readCountryCookie() ?? FALLBACK_COUNTRY);
    // solo al montar
  }, []);
  return country;
}
