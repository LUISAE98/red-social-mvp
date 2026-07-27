// Migración única MXN → USD (cambio de ancla de precios a dLocal).
//
// Convierte los precios guardados en MXN a USD (nueva ancla de referencia) usando
// la tasa vigente MXN/USD. Es IDEMPOTENTE y seguro correrlo antes o después del
// cutover: solo convierte campos cuya moneda acompañante NO sea ya "USD" (los docs
// creados después del cutover, que ya están en USD, se saltan). No convierte a la
// baja: no toca lo que ya migró.
//
// Ubicaciones cubiertas:
//   · groups/{id}.monetization  (subscriptionPriceMonthly + priceMonthly legacy)
//   · groups/{id}.offerings[]   (memberPrice, publicPrice)
//   · groups/{id}.donation      (suggestedAmounts[])
//   · users/{uid}                (donationMinimumAmount — donación de perfil)
//   · users/{uid}/settings/superCommentConfig.tiers[].price
//   · posts/{id}.premium        (price)
//   · posts/{id}.liveData        (ticketPrice + superCommentConfig.tiers[].price)
//
// Gate: solo el dueño de la plataforma (email) puede ejecutarla.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { logger } from "firebase-functions";
import { updateExchangeRatesHandler } from "./exchangeRates";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const REGION = "us-central1";
const OWNER_EMAIL = "luis@consumed.mx";
const RATES_URL = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_MXN_PER_USD = 18.5; // solo si la API falla

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Trae cuántos MXN equivalen a 1 USD (para convertir MXN → USD dividiendo). */
async function fetchMxnPerUsd(): Promise<number> {
  try {
    const res = await fetch(RATES_URL);
    if (res.ok) {
      const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
      const r = data?.rates?.MXN;
      if (data.result === "success" && typeof r === "number" && r > 0) return r;
    }
  } catch (err) {
    logger.warn("migrateCurrency: rate fetch failed, using fallback", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return FALLBACK_MXN_PER_USD;
}

/** true si esa moneda ya está en USD (nada que migrar). */
function alreadyUsd(currency: unknown): boolean {
  return currency === "USD";
}

export const migrateCurrencyMxnToUsd = onCall(
  { region: REGION, timeoutSeconds: 540, memory: "512MiB" },
  async (request) => {
    if (request.auth?.token?.email !== OWNER_EMAIL) {
      throw new HttpsError("permission-denied", "Solo el dueño de la plataforma puede ejecutar la migración.");
    }
    const dryRun = request.data?.dryRun === true;

    // Refresca las tasas a base USD (config/exchangeRates) para que el frontend
    // convierta bien tras el cutover. Solo en corrida real (no en dryRun).
    if (!dryRun) {
      try {
        await updateExchangeRatesHandler();
      } catch (err) {
        logger.warn("migrateCurrency: no se pudieron refrescar las tasas", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const mxnPerUsd = await fetchMxnPerUsd();
    const toUsd = (mxn: unknown): number | null => {
      const n = Number(mxn);
      if (!Number.isFinite(n) || n <= 0) return null;
      return round2(n / mxnPerUsd);
    };

    const stats = {
      groups: 0, offerings: 0, donations: 0,
      superCommentConfigs: 0, tiers: 0,
      profiles: 0, premiumPosts: 0, liveTickets: 0, liveConfigs: 0,
    };

    // ── groups/{id}: monetization + offerings + donation ─────────────────────
    const groupsSnap = await db.collection("groups").get();
    for (const doc of groupsSnap.docs) {
      const g = doc.data() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      // monetization (suscripción)
      const mon = (g.monetization ?? {}) as Record<string, unknown>;
      const monCurrency = mon.subscriptionCurrency ?? mon.currency;
      if (Object.keys(mon).length && !alreadyUsd(monCurrency)) {
        const nextMon: Record<string, unknown> = { ...mon };
        const sub = toUsd(mon.subscriptionPriceMonthly);
        if (sub != null) nextMon.subscriptionPriceMonthly = sub;
        const legacy = toUsd(mon.priceMonthly);
        if (legacy != null) nextMon.priceMonthly = legacy;
        if (sub != null || legacy != null) {
          nextMon.subscriptionCurrency = "USD";
          nextMon.currency = "USD";
          patch.monetization = nextMon;
          stats.groups += 1;
        }
      }

      // offerings[] (servicios visibles)
      const offerings = Array.isArray(g.offerings) ? (g.offerings as Record<string, unknown>[]) : null;
      if (offerings) {
        let changed = false;
        const nextOfferings = offerings.map((o) => {
          if (alreadyUsd(o.currency)) return o;
          const member = toUsd(o.memberPrice);
          const pub = toUsd(o.publicPrice);
          if (member == null && pub == null) return o;
          changed = true;
          stats.offerings += 1;
          return {
            ...o,
            ...(member != null ? { memberPrice: member } : {}),
            ...(pub != null ? { publicPrice: pub } : {}),
            currency: "USD",
          };
        });
        if (changed) patch.offerings = nextOfferings;
      }

      // donation (montos sugeridos)
      const donation = (g.donation ?? null) as Record<string, unknown> | null;
      if (donation && !alreadyUsd(donation.currency)) {
        const amounts = Array.isArray(donation.suggestedAmounts) ? (donation.suggestedAmounts as unknown[]) : null;
        if (amounts && amounts.length) {
          const nextAmounts = amounts.map((a) => toUsd(a) ?? a);
          patch.donation = { ...donation, suggestedAmounts: nextAmounts, currency: "USD" };
          stats.donations += 1;
        } else if (donation.currency != null) {
          patch.donation = { ...donation, currency: "USD" };
        }
      }

      if (Object.keys(patch).length && !dryRun) {
        await doc.ref.set(patch, { merge: true });
      }
    }

    // ── users/{uid}/settings/superCommentConfig ──────────────────────────────
    const settingsSnap = await db.collectionGroup("settings").get();
    for (const doc of settingsSnap.docs) {
      if (doc.id !== "superCommentConfig") continue;
      const cfg = doc.data() as Record<string, unknown>;
      if (alreadyUsd(cfg.currency)) continue;
      const tiers = Array.isArray(cfg.tiers) ? (cfg.tiers as Record<string, unknown>[]) : null;
      if (!tiers || !tiers.length) continue;
      let changed = false;
      const nextTiers = tiers.map((t) => {
        const p = toUsd(t.price);
        if (p == null) return t;
        changed = true;
        stats.tiers += 1;
        return { ...t, price: p };
      });
      if (changed) {
        stats.superCommentConfigs += 1;
        if (!dryRun) await doc.ref.set({ tiers: nextTiers, currency: "USD" }, { merge: true });
      }
    }

    // ── users/{uid}: donación de perfil (donationMinimumAmount) ──────────────
    const usersSnap = await db.collection("users").get();
    for (const doc of usersSnap.docs) {
      const u = doc.data() as Record<string, unknown>;
      if (alreadyUsd(u.donationCurrency)) continue;
      const amt = toUsd(u.donationMinimumAmount);
      if (amt == null) continue;
      stats.profiles += 1;
      if (!dryRun) {
        await doc.ref.set({ donationMinimumAmount: amt, donationCurrency: "USD" }, { merge: true });
      }
    }

    // ── posts/{id}: premium.price + liveData (ticketPrice + superCommentConfig) ─
    const postsSnap = await db.collection("posts").get();
    for (const doc of postsSnap.docs) {
      const p = doc.data() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      const premium = (p.premium ?? null) as Record<string, unknown> | null;
      if (premium && !alreadyUsd(premium.currency)) {
        const price = toUsd(premium.price);
        if (price != null) {
          patch.premium = { ...premium, price, currency: "USD" };
          stats.premiumPosts += 1;
        }
      }

      const liveData = (p.liveData ?? null) as Record<string, unknown> | null;
      if (liveData) {
        let nextLive: Record<string, unknown> | null = null;
        if (!alreadyUsd(liveData.currency)) {
          const ticket = toUsd(liveData.ticketPrice);
          if (ticket != null) {
            nextLive = { ...(nextLive ?? liveData), ticketPrice: ticket, currency: "USD" };
            stats.liveTickets += 1;
          }
        }
        const scc = (liveData.superCommentConfig ?? null) as Record<string, unknown> | null;
        if (scc && !alreadyUsd(scc.currency) && Array.isArray(scc.tiers)) {
          let changed = false;
          const nextTiers = (scc.tiers as Record<string, unknown>[]).map((t) => {
            const pr = toUsd(t.price);
            if (pr == null) return t;
            changed = true;
            return { ...t, price: pr };
          });
          if (changed) {
            nextLive = { ...(nextLive ?? liveData), superCommentConfig: { ...scc, tiers: nextTiers, currency: "USD" } };
            stats.liveConfigs += 1;
          }
        }
        if (nextLive) patch.liveData = nextLive;
      }

      if (Object.keys(patch).length && !dryRun) {
        await doc.ref.set(patch, { merge: true });
      }
    }

    logger.info("migrateCurrencyMxnToUsd done", { dryRun, mxnPerUsd, ...stats });
    return { ok: true, dryRun, mxnPerUsd, ...stats };
  }
);
