"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { SETTLEMENT_CURRENCY } from "@/lib/currency/catalog";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Las tasas viven en lib/wallet/walletRates (constantes puras, sin Firebase).
// Se reexportan para no romper a quien ya las importaba desde aquí.
export { WALLET_COMMISSION_RATE, WALLET_NET_RATE } from "@/lib/wallet/walletRates";

/**
 * Resumen agregado del wallet del creador. Lo mantiene el backend de forma
 * transaccional en `users/{uid}/walletSummary/current`. Aquí solo se lee.
 */
export type WalletSummary = {
  currency: string;
  /** Ganado histórico (acumulado de por vida; los reembolsos lo restan). */
  lifetimeEarnedGross: number;
  lifetimeEarnedNet: number;
  /** Total retirado (por ahora 0; funcionalidad de retiro futura). */
  withdrawnGross: number;
  withdrawnNet: number;
  /** Pagado pero pendiente de entregar (por liberar). */
  pendingGross: number;
  pendingNet: number;
  /** Reembolsado (devuelto). */
  refundedGross: number;
  refundedNet: number;
  /** Rechazado / no entregado (dinero perdido). */
  rejectedGross: number;
  rejectedNet: number;
  /**
   * 🧾 Retenciones acumuladas de las ventas ganadas.
   *
   * ⚠️ **Todavía NO están restadas del saldo.** Se registran para poder cuadrar y para
   * mostrárselas al creador; aplicarlas al importe retirable va en su propio paso, junto con
   * la pantalla que se lo explica. Ver `docs/legal/fiscal-iva-isr-plataforma.md` §0.
   */
  retainedIsr: number;
  retainedIva: number;
  /** Impuesto de la comisión de Vibra. Lo paga el creador y, con RFC, lo acredita. */
  commissionVat: number;
  /**
   * 🧾 IVA cobrado al comprador en ventas ganadas (va al SAT, NO es del creador).
   * Solo transparencia; no forma parte de las ganancias ni del saldo retirable.
   */
  taxCollected: number;
  /**
   * 🧾 IVA MEXICANO de las ventas cuyo dinero sigue en el saldo.
   *
   * ⚠️ Distinto de `taxCollected`, que está justo arriba. Aquél es de por vida, suma el
   * impuesto de todos los países e incluye la parte que grava el cargo fijo y el 2% de
   * conversión, que son de Vibra. Éste es solo el IVA mexicano de la venta del creador.
   *
   * 🚨 Y a diferencia de aquél, **éste SÍ entra al retiro**: es el dinero del que sale la
   * retención. Ver `calcularRetiro`.
   */
  mxVatCollected: number;
};

export const EMPTY_WALLET_SUMMARY: WalletSummary = {
  currency: SETTLEMENT_CURRENCY,
  lifetimeEarnedGross: 0,
  lifetimeEarnedNet: 0,
  withdrawnGross: 0,
  withdrawnNet: 0,
  pendingGross: 0,
  pendingNet: 0,
  refundedGross: 0,
  refundedNet: 0,
  rejectedGross: 0,
  rejectedNet: 0,
  taxCollected: 0,
  mxVatCollected: 0,
  retainedIsr: 0,
  retainedIva: 0,
  commissionVat: 0,
};

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeSummary(data: Record<string, unknown>): WalletSummary {
  return {
    currency: typeof data.currency === "string" ? data.currency : SETTLEMENT_CURRENCY,
    lifetimeEarnedGross: toNumber(data.lifetimeEarnedGross),
    lifetimeEarnedNet: toNumber(data.lifetimeEarnedNet),
    withdrawnGross: toNumber(data.withdrawnGross),
    withdrawnNet: toNumber(data.withdrawnNet),
    pendingGross: toNumber(data.pendingGross),
    pendingNet: toNumber(data.pendingNet),
    refundedGross: toNumber(data.refundedGross),
    refundedNet: toNumber(data.refundedNet),
    rejectedGross: toNumber(data.rejectedGross),
    rejectedNet: toNumber(data.rejectedNet),
    // El backend lo guarda como lifetimeTaxCollected; aquí lo exponemos como taxCollected.
    taxCollected: toNumber(data.lifetimeTaxCollected),
    /**
     * 🧾 Lo que YA se le retuvo, no lo que se le va a retener.
     *
     * ⚠️ Desde §A5 (2026-09-03) la retención ocurre EN LA VENTA, así que estas cifras no se
     * consumen al retirar y `pending*` acabó valiendo lo mismo que `lifetime*`. Siguen aquí
     * porque son la materia prima para explicarle al creador por qué su saldo no es el 75% —
     * pero ya **no entran en ningún cálculo de retiro**.
     *
     * 🚨 Ojo al usarlas para explicar el SALDO: son de todas sus ventas, no solo de las que
     * siguen sin retirar. Contra un saldo ya mermado por retiros anteriores no cuadran.
     */
    mxVatCollected: toNumber(data.pendingMxVatCollected),
    retainedIsr: toNumber(data.pendingRetainedIsr ?? data.lifetimeRetainedIsr),
    retainedIva: toNumber(data.pendingRetainedIva ?? data.lifetimeRetainedIva),
    commissionVat: toNumber(data.pendingCommissionVat ?? data.lifetimeCommissionVat),
  };
}

/** Cifras ya listas para mostrar, según neto o bruto. */
export type WalletFinanceView = {
  available: number; // disponible para retirar = histórico - retirado
  lifetime: number; // ganado histórico
  pending: number; // por liberar
  refunded: number; // devuelto
  rejected: number; // perdido en rechazados
};

export function selectFinanceView(
  summary: WalletSummary,
  mode: "net" | "gross"
): WalletFinanceView {
  const g = mode === "gross";
  const lifetime = g ? summary.lifetimeEarnedGross : summary.lifetimeEarnedNet;
  const withdrawn = g ? summary.withdrawnGross : summary.withdrawnNet;
  return {
    lifetime,
    available: Math.max(0, lifetime - withdrawn),
    pending: g ? summary.pendingGross : summary.pendingNet,
    refunded: g ? summary.refundedGross : summary.refundedNet,
    rejected: g ? summary.rejectedGross : summary.rejectedNet,
  };
}

// Caché en memoria con listener persistente (compartido entre pestañas).
type SummaryStore = {
  summary: WalletSummary;
  loaded: boolean;
  unsub: (() => void) | null;
  subs: Set<() => void>;
};
const summaryStores = new Map<string, SummaryStore>();

function getSummaryStore(uid: string): SummaryStore {
  let s = summaryStores.get(uid);
  if (!s) {
    s = { summary: EMPTY_WALLET_SUMMARY, loaded: false, unsub: null, subs: new Set() };
    summaryStores.set(uid, s);
  }
  return s;
}

function ensureSummarySub(uid: string) {
  const s = getSummaryStore(uid);
  if (s.unsub) return;
  const ref = doc(db, "users", uid, "walletSummary", "current");
  const notify = () => s.subs.forEach((fn) => fn());
  s.unsub = onSnapshot(
    ref,
    (snap) => {
      s.summary = snap.exists()
        ? normalizeSummary(snap.data() as Record<string, unknown>)
        : EMPTY_WALLET_SUMMARY;
      s.loaded = true;
      notify();
    },
    () => {
      s.loaded = true;
      notify();
    }
  );
}

/** Suscribe (con caché persistente) al resumen del wallet del usuario. */
export function useWalletFinances(uid: string | null | undefined) {
  useEffect(() => {
    if (uid) ensureSummarySub(uid);
  }, [uid]);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!uid) return () => {};
      const s = getSummaryStore(uid);
      s.subs.add(cb);
      return () => {
        s.subs.delete(cb);
      };
    },
    [uid]
  );
  const getSnapshot = useCallback(
    () => (uid ? summaryStores.get(uid)?.summary ?? EMPTY_WALLET_SUMMARY : EMPTY_WALLET_SUMMARY),
    [uid]
  );
  const summary = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_WALLET_SUMMARY);
  const loading = uid ? !(summaryStores.get(uid)?.loaded ?? false) : false;
  return { summary, loading };
}
