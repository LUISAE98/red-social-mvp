"use client";

// El país del creador según su IP, para ESTIMAR lo que se le enseña.
//
// Sale de la cookie `vibra_country` que fija el middleware — la misma señal que ya decide su
// moneda y su idioma, así que las tres cosas se ven coherentes entre sí.
//
// ⚠️ **Solo para MOSTRAR.** Nunca decide el gate del retiro ni la comisión que se congela en
// el asiento: una IP puede ser de un viaje o de una VPN, y ninguna de las dos cosas puede
// cambiar lo que se le paga.
//
// ── Por qué `useSyncExternalStore` y no `useState` ──────────────────────────────────────
//
// Porque la cookie NO existe al renderizar en el servidor. Leerla con `useState` haría que el
// servidor pintara una cifra y el cliente otra, que es exactamente un fallo de hidratación:
// React se queja y, peor, el creador ve el número parpadear.
//
// `useSyncExternalStore` acepta una instantánea distinta para el servidor. React sabe que van
// a diferir, pinta la del servidor, hidrata y actualiza — sin aviso y sin salto visible.

import { useSyncExternalStore } from "react";

function leerCookie(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)vibra_country=([^;]+)/);
    const v = m?.[1]?.toUpperCase();
    return v && /^[A-Z]{2}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

// La cookie no cambia mientras el creador está en la página, así que no hay a qué
// suscribirse. La función existe porque `useSyncExternalStore` la exige.
const sinCambios = () => () => {};

/** `null` en el servidor y mientras no haya cookie. Nunca lanza. */
export function usePaisPorIp(): string | null {
  return useSyncExternalStore(sinCambios, leerCookie, () => null);
}
