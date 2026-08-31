"use client";

// Qué hacer cuando alguien quiere comprar y no hay identidad.
//
// En la app la respuesta es "manda a login". En Vibra Express NO puede serlo: el
// sentido de Express es comprar sin darse de alta antes, y sacar a la persona a
// una pantalla de login en mitad del impulso de compra es perderla.
//
// Va por contexto y no como prop porque el flujo de compra nace muy abajo —en el
// slide de una historia— y la decisión la toma la superficie que lo monta, tres
// niveles más arriba. Pasarlo de mano en mano habría obligado a que ReelFeed y
// ReelStorySlide, que no tienen nada que ver con esto, lo transportaran.
//
// El valor por omisión es el de la app, así que todo lo que ya existía sigue
// comportándose igual sin tocar nada.

import { createContext, useContext } from "react";

export type PurchaseIdentityMode =
  /** Sin sesión, a login. El comportamiento de siempre dentro de la app. */
  | "login"
  /** Sin sesión, se firma como invitado y la compra sigue. Vibra Express. */
  | "guest";

const PurchaseIdentityContext = createContext<PurchaseIdentityMode>("login");

export function PurchaseIdentityProvider({
  mode,
  children,
}: {
  mode: PurchaseIdentityMode;
  children: React.ReactNode;
}) {
  return (
    <PurchaseIdentityContext.Provider value={mode}>{children}</PurchaseIdentityContext.Provider>
  );
}

export function usePurchaseIdentityMode(): PurchaseIdentityMode {
  return useContext(PurchaseIdentityContext);
}
