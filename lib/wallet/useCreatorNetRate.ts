"use client";

// La comisión del creador que está mirando la pantalla, en vivo.
//
// Reemplaza a `WALLET_NET_RATE` en todo lo que le PROMETE algo —«ganarás X si lo pones a Y»—,
// porque esa promesa dejó de ser la misma para todos: 25% y 300 USD de mínimo en 62 países,
// 30% y 500 en los 27 donde solo llega el wire. Ver `docs/payout-tiers.md`.
//
// ── De dónde sale su país, en orden ─────────────────────────────────────────────────────
//
//   1. **La cuenta de cobro** — el dato duro. Es a donde viaja el dinero.
//   2. **El documento del KYC** — respaldo. Un creador de ruta Wallbit nunca da de alta cuenta
//      en Stripe, así que el campo anterior se queda vacío para siempre.
//   3. **La IP** — estimación, mientras no se ha registrado. Sale de la cookie `vibra_country`
//      que fija el middleware, la misma que ya decide su moneda y su idioma.
//
// ⚠️ **La IP solo sirve para MOSTRAR.** Nunca decide el gate del retiro ni la comisión que se
// congela en el asiento: para eso están `useCreatorTaxProfile` y el ledger, que usan únicamente
// los datos duros. Un creador podría estar de viaje, o usar una VPN, y ninguna de esas dos
// cosas puede cambiar lo que se le paga.
//
// Cuando el país viene de la IP, `esEstimacion` va en `true` para que la interfaz pueda decir
// que es aproximado. Enseñar 25% a alguien que va a cobrar al 30% sin avisarle es la forma más
// rápida de que se sienta engañado el día del primer retiro.
//
// ── Esto es para PROYECCIONES, no para ventas hechas ────────────────────────────────────
//
// Una venta registrada lleva su comisión CONGELADA en el asiento, y hay que leer esa. Para eso
// está `netRateOfEntry`: si un creador se muda de país, sus ventas viejas no pueden cambiar de
// importe retroactivamente en la pantalla.
//
// ── Por qué suscripciones compartidas ───────────────────────────────────────────────────
//
// Unos veinte componentes necesitan este dato y varios están montados a la vez. Un `onSnapshot`
// por componente serían veinte escuchas al mismo documento. Aquí hay una por uid y documento, y
// los componentes se enganchan a ellas.

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { usePaisPorIp } from "@/lib/wallet/usePaisPorIp";
import {
  payoutTermsOf,
  paisDeCobroDe,
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
  /**
   * El país salió de su IP, no de un dato suyo.
   *
   * La interfaz debería decir que la cifra es aproximada. En cuanto se registre pasa a `false`
   * y lo que vea será definitivo.
   */
  esEstimacion: boolean;
  /** Todavía no llegó ninguna señal; lo que se devuelve es el caso estándar. */
  loading: boolean;
};

function ratesDe(terms: Readonly<PayoutTerms>, esEstimacion: boolean, loading: boolean): CreatorRates {
  return {
    commissionRate: terms.commissionRate,
    netRate: 1 - terms.commissionRate,
    minWithdrawalUsd: terms.minWithdrawalUsd,
    esEstimacion,
    loading,
  };
}

/** Lo que se devuelve mientras no se sabe nada, y a quien no ha iniciado sesión. */
const PROVISIONAL = ratesDe(PAYOUT_TERMS_PROVISIONAL, true, true);


type Entrada = {
  /** `undefined` = aún no llegó el primer snapshot. `null` = llegó y no hay valor. */
  valor: string | null | undefined;
  oyentes: Set<(valor: string | null) => void>;
  cortar: () => void;
};

/** Una escucha por documento, compartida por todos los componentes montados. */
const escuchas = new Map<string, Entrada>();

function suscribir(
  clave: string,
  ruta: [string, string],
  campo: string,
  oyente: (valor: string | null) => void
): () => void {
  let entrada = escuchas.get(clave);

  if (!entrada) {
    const nueva: Entrada = { valor: undefined, oyentes: new Set(), cortar: () => {} };
    escuchas.set(clave, nueva);
    nueva.cortar = onSnapshot(
      doc(db, ruta[0], ruta[1]),
      (snap) => {
        const v = snap.data()?.[campo];
        nueva.valor = typeof v === "string" && v ? v.toUpperCase() : null;
        for (const o of nueva.oyentes) o(nueva.valor);
      },
      // Si falla la lectura se cae al siguiente escalón de la cadena. Enseñarle de menos por un
      // fallo de red sería peor que enseñarle una estimación.
      () => {
        nueva.valor = null;
        for (const o of nueva.oyentes) o(null);
      }
    );
    entrada = nueva;
  }

  entrada.oyentes.add(oyente);
  // Al que llega tarde se le entrega lo que ya se sabe, sin esperar otro snapshot.
  if (entrada.valor !== undefined) oyente(entrada.valor);

  return () => {
    const e = escuchas.get(clave);
    if (!e) return;
    e.oyentes.delete(oyente);
    // Sin nadie escuchando, se corta: dejarla viva filtraría una escucha por cada creador que
    // se haya mirado en la sesión.
    if (e.oyentes.size === 0) {
      e.cortar();
      escuchas.delete(clave);
    }
  };
}

/**
 * La comisión y el mínimo del creador con la sesión iniciada.
 *
 * Mientras no llega ninguna señal devuelve el estándar con `loading: true`. Es a propósito: la
 * alternativa es no enseñar nada, y una cifra en blanco donde había un «ganarás X» se lee como
 * un fallo.
 */
export function useCreatorNetRate(): CreatorRates {
  const { user } = useAuth();
  const uid = user?.uid;

  // El uid viaja DENTRO del estado, no en un reseteo al cambiar de usuario: eso sería un
  // setState en el cuerpo del efecto. Guardando de quién es el dato, un resultado que sobra de
  // la sesión anterior se descarta solo al compararlo.
  const [cuenta, setCuenta] = useState<{ uid: string; pais: string | null } | null>(null);
  const [documento, setDocumento] = useState<{ uid: string; pais: string | null } | null>(null);

  const ip = usePaisPorIp();

  useEffect(() => {
    if (!uid) return;
    return suscribir(
      `perfil:${uid}`,
      ["creatorTaxProfiles", uid],
      "payoutAccountCountry",
      (pais) => setCuenta({ uid, pais })
    );
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return suscribir(`kyc:${uid}`, ["kyc", uid], "documentCountry", (pais) =>
      setDocumento({ uid, pais })
    );
  }, [uid]);

  // Sin sesión no hay nada suyo que leer, pero su IP sí sirve para estimar.
  if (!uid) {
    return ip
      ? ratesDe(payoutTermsOf(ip) ?? PAYOUT_TERMS_PROVISIONAL, true, false)
      : PROVISIONAL;
  }

  // Hasta que las dos escuchas respondan, lo que hay es la estimación por IP.
  const listo = cuenta?.uid === uid && documento?.uid === uid;
  if (!listo) {
    return ip
      ? ratesDe(payoutTermsOf(ip) ?? PAYOUT_TERMS_PROVISIONAL, true, true)
      : PROVISIONAL;
  }

  /**
   * La cadena completa.
   *
   * `paisDeCobroDe` resuelve los dos datos duros —la misma función que usa el ledger, para que
   * no puedan separarse—. La IP entra solo si esos dos están vacíos.
   */
  const duro = paisDeCobroDe({
    payoutAccountCountry: cuenta.pais,
    documentCountry: documento.pais,
  });
  const esEstimacion = !duro;
  const terms = payoutTermsOf(duro ?? ip) ?? PAYOUT_TERMS_PROVISIONAL;

  return ratesDe(terms, esEstimacion, false);
}

/**
 * La tasa neta de una venta YA REGISTRADA.
 *
 * 🚨 **Usa la comisión congelada del asiento, nunca la actual.** Es lo que hace cumplible la
 * promesa de no recalcular hacia atrás: si el creador cambia de banco y sube de nivel, sus
 * ventas anteriores tienen que seguir mostrando lo mismo que mostraban ayer.
 *
 * Los asientos anteriores al 2026-08-27 no traen el campo. Se les aplica 25%, que es la
 * comisión con la que se registraron.
 */
export function netRateOfEntry(entry: { commissionRate?: number | null }): number {
  const r = entry.commissionRate;
  return typeof r === "number" && r >= 0 && r < 1 ? 1 - r : 0.75;
}
