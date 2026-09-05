"use client";

// El ofrecimiento de instalar de Android (y de Chrome en escritorio).
//
// El navegador decide CUÁNDO la app es instalable y lo anuncia con un evento.
// Este hook lo intercepta para poder ofrecerlo nosotros, en nuestro momento y
// con nuestro aspecto, en vez de dejarlo a la barra que Chrome saca por su
// cuenta.

import { useCallback, useEffect, useState } from "react";

/**
 * El evento no está en los tipos del DOM porque no es estándar: es de Chromium.
 * Se declara aquí en vez de ensanchar `WindowEventMap` a lo global, para que no
 * parezca disponible en navegadores donde no existe.
 */
type EventoDeInstalacion = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export type ResultadoInstalacion = "aceptada" | "rechazada" | "no-disponible";

export type OfertaDeInstalacion = {
  /** El navegador ya dijo que se puede instalar y tenemos su permiso guardado. */
  puedeInstalar: boolean;
  /** Abre el diálogo NATIVO de instalar. Requiere venir de un gesto de la persona. */
  instalar: () => Promise<ResultadoInstalacion>;
};

export function usePwaInstallPrompt(): OfertaDeInstalacion {
  const [evento, setEvento] = useState<EventoDeInstalacion | null>(null);

  useEffect(() => {
    const alPoderInstalar = (e: Event) => {
      /**
       * 🚨 `preventDefault()` APAGA la barra que Chrome saca por su cuenta.
       *
       * Es el trato completo del evento: o lo deja pasar y manda Chrome, o lo
       * interceptas y mandas tú. No hay término medio.
       *
       * Y de ahí sale la única forma de romper esto: capturar el evento y no
       * enseñar nada. Quedaría PEOR que antes, porque habríamos quitado la barra
       * del navegador sin poner nada en su lugar. Por eso este hook y el aviso
       * que lo usa van juntos y no tiene sentido montar uno sin el otro.
       */
      e.preventDefault();
      setEvento(e as EventoDeInstalacion);
    };

    // Ya instalada: el ofrecimiento sobra, aunque la pestaña siga abierta.
    const alInstalarse = () => setEvento(null);

    window.addEventListener("beforeinstallprompt", alPoderInstalar);
    window.addEventListener("appinstalled", alInstalarse);
    return () => {
      window.removeEventListener("beforeinstallprompt", alPoderInstalar);
      window.removeEventListener("appinstalled", alInstalarse);
    };
  }, []);

  const instalar = useCallback(async (): Promise<ResultadoInstalacion> => {
    if (!evento) return "no-disponible";

    try {
      await evento.prompt();
      const { outcome } = await evento.userChoice;
      /**
       * ⚠️ El evento es de UN SOLO USO. Una vez mostrado el diálogo ya no sirve
       * para nada, se haya aceptado o no, y llamarlo otra vez lanza. Se suelta
       * aquí; si Chrome vuelve a considerarla instalable, emitirá uno nuevo.
       */
      setEvento(null);
      return outcome === "accepted" ? "aceptada" : "rechazada";
    } catch {
      setEvento(null);
      return "no-disponible";
    }
  }, [evento]);

  return { puedeInstalar: evento !== null, instalar };
}
