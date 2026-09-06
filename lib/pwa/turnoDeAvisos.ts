"use client";

/**
 * Quién de los tres avisos tiene el turno.
 *
 * 🚨 El problema que resuelve es real y se veía: en Android, alguien con sesión,
 * sin instalar y con el permiso de avisos sin decidir cumplía las condiciones de
 * DOS paneles a la vez. Los dos son modales a pantalla completa y comparten
 * z-index, así que salían apilados —dos velos desenfocando, dos veces que
 * descartar— y el de abajo se leía como un error de pintado.
 *
 * Cada aviso anuncia que quiere salir y con qué prioridad; solo sale el de
 * prioridad más baja. El otro no se pierde: vuelve a intentarlo en la siguiente
 * visita, cuando el primero ya esté resuelto o aplazado.
 *
 * Vive fuera de React —un objeto de módulo y una lista de oyentes— porque el
 * turno es un dato compartido entre componentes hermanos que no se conocen
 * entre sí. Montar un contexto para esto obligaría a envolver el layout entero
 * por tres booleanos.
 */

import { useEffect, useSyncExternalStore } from "react";

/**
 * Menor número, más importante.
 *
 * Instalar manda sobre pedir avisos, y no por gusto: en iPhone el push SOLO
 * funciona con la app en la pantalla de inicio, así que preguntar por los avisos
 * antes de instalar es preguntar por algo que todavía no puede funcionar.
 */
export const PRIORIDAD = {
  instalar: 0,
  notificaciones: 1,
} as const;

/** Quién quiere salir ahora mismo, y con qué prioridad. */
const pretendientes = new Map<string, number>();
const oyentes = new Set<() => void>();

/** El id con la prioridad más baja, o `null` si no hay nadie. */
let enTurno: string | null = null;

function recalcular(): void {
  let mejor: string | null = null;
  let mejorPrioridad = Number.POSITIVE_INFINITY;

  for (const [id, prioridad] of pretendientes) {
    if (prioridad < mejorPrioridad) {
      mejor = id;
      mejorPrioridad = prioridad;
    }
  }

  // Solo se avisa si CAMBIÓ. `useSyncExternalStore` compara por identidad, y
  // notificar sin cambio provocaría un render por cada anuncio.
  if (mejor === enTurno) return;
  enTurno = mejor;
  for (const oyente of oyentes) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

const leerEnTurno = () => enTurno;
/** En el servidor no hay turno que repartir: nadie sale en la primera pintada. */
const sinTurno = () => null;

/**
 * ¿Le toca a este aviso?
 *
 * Devuelve `true` solo si quiere salir Y es el de más prioridad de los que
 * quieren. Anunciarse va en un efecto a propósito: escribir en un almacén de
 * fuera de React es justo para lo que sirven, y así no hay estado que sincronizar.
 */
export function useTurnoDeAviso(
  id: string,
  prioridad: number,
  quiereSalir: boolean
): boolean {
  useEffect(() => {
    if (!quiereSalir) {
      pretendientes.delete(id);
      recalcular();
      return;
    }

    pretendientes.set(id, prioridad);
    recalcular();

    return () => {
      pretendientes.delete(id);
      recalcular();
    };
  }, [id, prioridad, quiereSalir]);

  const turno = useSyncExternalStore(suscribir, leerEnTurno, sinTurno);
  return quiereSalir && turno === id;
}
