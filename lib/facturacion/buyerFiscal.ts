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

/** Una factura emitida, a nombre de UN creador. */
export type FacturaEmitida = {
  creatorId: string;
  invoiceId: string;
  uuid: string | null;
  total: number | null;
  purchaseIds: string[];
};

/** Un creador cuyas compras NO se pudieron facturar, y por qué. */
export type FacturaOmitida = {
  creatorId: string;
  motivo:
    | "sin_sello"
    | "sin_datos_fiscales"
    | "error_timbrado"
    /**
     * La factura global del creador se adelantó a esta. No es culpa de sus datos fiscales, y
     * decirle eso al comprador lo manda a esperar algo que nunca va a pasar.
     */
    | "ya_en_global";
  detalle?: string;
};

/**
 * Emite las facturas de una selección de compras.
 *
 * ⚠️ Devuelve VARIAS. Bajo el modelo de intermediación el vendedor es el creador, así que sale
 * **una factura por creador**: diez conceptos de tres creadores son tres facturas, cada una
 * timbrada con el sello de su emisor.
 *
 * Un creador sin sello vigente no tumba al resto: aparece en `skipped` y las demás se emiten.
 */
export async function generateBuyerInvoice(
  input: GenerateBuyerInvoiceInput
): Promise<{ ok: boolean; invoices: FacturaEmitida[]; skipped: FacturaOmitida[] }> {
  const fn = httpsCallable<GenerateBuyerInvoiceInput, { ok: boolean; invoices: FacturaEmitida[]; skipped: FacturaOmitida[] }>(
    functions,
    "generateBuyerInvoice"
  );
  const res = await fn(input);
  return res.data;
}

export async function downloadBuyerInvoice(
  invoiceId: string
): Promise<{ ok: boolean; pdfBase64: string; filename: string }> {
  const fn = httpsCallable<{ invoiceId: string }, { ok: boolean; pdfBase64: string; filename: string }>(
    functions,
    "downloadBuyerInvoice"
  );
  const res = await fn({ invoiceId });
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
