"use client";

// La comisión del creador que está mirando la pantalla, en vivo.
//
// Reemplaza a `WALLET_NET_RATE` en todo lo que le PROMETE algo al creador —«ganarás X si lo
// pones a Y»—, porque esa promesa dejó de ser la misma para todos: 25% en los 45 países de
// transferencia local y 30% en los 29 donde solo llega el wire. Ver `docs/payout-tiers.md`.
//
// ⚠️ **Esto es para PROYECCIONES, no para ventas ya hechas.** Una venta registrada lleva su
// comisión CONGELADA en el asiento, y hay que leer esa, no esta. Para eso está `netRateOfEntry`
// más abajo: si un creador se muda de país, sus ventas viejas no pueden cambiar de importe
// retroactivamente en la pantalla.
//
// ── Por qué una suscripción compartida ──────────────────────────────────────────────────
//
// Unos veinte componentes necesitan este dato —el compositor, los cinco paneles de configurar
// servicios, el panel del live, el resumen de fin de live, la bandeja de solicitudes…— y
// varios están montados a la vez. Un `onSnapshot` por componente serían veinte escuchas al
// MISMO documento. Aquí hay una sola por uid, y los componentes se enganchan a ella.

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import {
  payoutTermsOf,
  PAYOUT_TERMS_PROVISIONAL,
  type PayoutTerms,
} from "@/lib/wallet/payoutTiers";

export type CreatorRates = {
  /** Fracción que se queda Vibra. 0.25 o 0.30. */
  commissionRate: number;
  /** Lo que le queda al creador. 0.75 o 0.70. */
  netRate: number;
  /** Su mínimo de retiro, en USD. */
  minWithdrawalUsd: number;
  /** Todavía no se sabe su país; lo que se devuelve es el estándar como provisional. */
  loading: boolean;
};

/** Lo que se devuelve mientras no se sabe nada, y a quien no ha iniciado sesión. */
const PROVISIONAL: CreatorRates = {
  commissionRate: PAYOUT_TERMS_PROVISIONAL.commissionRate,
  minWithdrawalUsd: PAYOUT_TERMS_PROVISIONAL.minWithdrawalUsd,
  netRate: 1 - PAYOUT_TERMS_PROVISIONAL.commissionRate,
  loading: true,
};

type Entrada = {
  /** `undefined` = aún no llegó el primer snapshot. `null` = llegó y no hay país. */
  pais: string | null | undefined;
  oyentes: Set<(pais: string | null) => void>;
  cortar: () => void;
};

/** Una escucha por uid, compartida por todos los componentes montados. */
const escuchas = new Map<string, Entrada>();

function suscribir(uid: string, oyente: (pais: string | null) => void): () => void {
  let entrada = escuchas.get(uid);

  if (!entrada) {
    const nueva: Entrada = { pais: undefined, oyentes: new Set(), cortar: () => {} };
    escuchas.set(uid, nueva);
    nueva.cortar = onSnapshot(
      doc(db, "creatorTaxProfiles", uid),
      (snap) => {
        const p = snap.data()?.payoutAccountCountry;
        nueva.pais = typeof p === "string" && p ? p.toUpperCase() : null;
        for (const o of nueva.oyentes) o(nueva.pais);
      },
      // Si falla la lectura se queda el estándar. Es lo benigno: enseñarle de menos lo que va
      // a ganar por un fallo de red sería peor que enseñarle el caso más común.
      () => {
        nueva.pais = null;
        for (const o of nueva.oyentes) o(null);
      }
    );
    entrada = nueva;
  }

  entrada.oyentes.add(oyente);
  // Al que llega tarde se le entrega lo que ya se sabe, sin esperar otro snapshot.
  if (entrada.pais !== undefined) oyente(entrada.pais);

  return () => {
    const e = escuchas.get(uid);
    if (!e) return;
    e.oyentes.delete(oyente);
    // Sin nadie escuchando, se corta: dejarla viva filtraría una escucha por cada creador
    // que se haya mirado en la sesión.
    if (e.oyentes.size === 0) {
      e.cortar();
      escuchas.delete(uid);
    }
  };
}

/**
 * La comisión y el mínimo del creador con la sesión iniciada.
 *
 * Mientras no se sabe su país devuelve el ESTÁNDAR con `loading: true`. Es a propósito: la
 * alternativa es no enseñar nada, y una cifra en blanco donde antes había un «ganarás X» se
 * lee como un fallo. El estándar es el caso de 45 de los 74 países pagables.
 */
export function useCreatorNetRate(): CreatorRates {
  const { user } = useAuth();
  const uid = user?.uid;

  // El uid viaja DENTRO del estado, no en un `setPais(undefined)` al cambiar de usuario:
  // eso sería un setState en el cuerpo del efecto, que encadena renders. Guardando de quién
  // es el dato, un resultado que sobra de la sesión anterior se descarta solo al compararlo.
  const [visto, setVisto] = useState<{ uid: string; pais: string | null } | null>(null);

  useEffect(() => {
    if (!uid) return;
    return suscribir(uid, (pais) => setVisto({ uid, pais }));
  }, [uid]);

  if (!uid || visto?.uid !== uid) return PROVISIONAL;

  const terms: Readonly<PayoutTerms> = payoutTermsOf(visto.pais) ?? PAYOUT_TERMS_PROVISIONAL;
  return {
    commissionRate: terms.commissionRate,
    netRate: 1 - terms.commissionRate,
    minWithdrawalUsd: terms.minWithdrawalUsd,
    loading: false,
  };
}

/**
 * La tasa neta de una venta YA REGISTRADA.
 *
 * 🚨 **Usa la comisión congelada del asiento, nunca la actual.** Es la mitad que hace cumplible
 * la promesa de no recalcular hacia atrás: si el creador cambia de banco y sube de nivel, sus
 * ventas anteriores tienen que seguir mostrando lo mismo que mostraban ayer.
 *
 * Los asientos anteriores al 2026-08-27 no traen el campo. Se les aplica 25%, que es la
 * comisión con la que se registraron.
 */
export function netRateOfEntry(entry: { commissionRate?: number | null }): number {
  const r = entry.commissionRate;
  return typeof r === "number" && r >= 0 && r < 1 ? 1 - r : 0.75;
}
