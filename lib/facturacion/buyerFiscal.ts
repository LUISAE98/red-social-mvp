"use client";

// Wrappers cliente de los perfiles de facturación del COMPRADOR (varios, tipo
// "tarjetas guardadas") + hook de lectura en vivo. Ver
// backend/src/facturacion/buyerBillingProfiles.ts.

import { httpsCallable } from "firebase/functions";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db, functions } from "@/lib/firebase";

export type BuyerBillingProfile = {
  id: string;
  taxId: string; // RFC
  legalName: string; // nombre o razón social
  taxSystem: string; // clave de régimen SAT
  zip: string; // CP fiscal
  usoCfdi: string; // clave c_UsoCFDI
  email?: string | null;
  facturapiCustomerId?: string | null;
};

export type SaveBuyerBillingProfileInput = {
  /** Vacío = crear un perfil nuevo; con id = actualizar ese perfil. */
  profileId?: string;
  taxId: string;
  legalName: string;
  taxSystem: string;
  zip: string;
  usoCfdi: string;
  email?: string;
};

export async function saveBuyerBillingProfile(
  input: SaveBuyerBillingProfileInput
): Promise<{ ok: boolean; id: string }> {
  const fn = httpsCallable<SaveBuyerBillingProfileInput, { ok: boolean; id: string }>(
    functions,
    "saveBuyerBillingProfile"
  );
  const res = await fn(input);
  return res.data;
}

export async function deleteBuyerBillingProfile(profileId: string): Promise<{ ok: boolean }> {
  const fn = httpsCallable<{ profileId: string }, { ok: boolean }>(functions, "deleteBuyerBillingProfile");
  const res = await fn({ profileId });
  return res.data;
}

// ── Emisión del CFDI (Vibra → comprador) ─────────────────────────────────────
export type GenerateBuyerInvoiceInput = {
  purchaseIds: string[];
  billingProfileId: string;
};

export async function generateBuyerInvoice(
  input: GenerateBuyerInvoiceInput
): Promise<{ ok: boolean; invoiceId: string; uuid: string | null; total: number | null }> {
  const fn = httpsCallable<GenerateBuyerInvoiceInput, { ok: boolean; invoiceId: string; uuid: string | null; total: number | null }>(
    functions,
    "generateBuyerInvoice"
  );
  const res = await fn(input);
  return res.data;
}

// ── Hook: perfiles de facturación del comprador (lectura en vivo) ────────────
export function useBuyerBillingProfiles(uid: string | null | undefined) {
  const [profiles, setProfiles] = useState<BuyerBillingProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let unsub: (() => void) | null = null;
    let cancelled = false;

    auth.authStateReady().then(() => {
      if (cancelled) return;
      const q = query(
        collection(db, "users", uid, "billingProfiles"),
        orderBy("createdAt", "desc")
      );
      unsub = onSnapshot(
        q,
        (snap) => {
          setProfiles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BuyerBillingProfile, "id">) })));
          setLoading(false);
        },
        () => {
          setProfiles([]);
          setLoading(false);
        }
      );
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [uid]);

  return { profiles, loading };
}
