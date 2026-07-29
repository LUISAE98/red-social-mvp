"use client";

// Wrappers cliente de la facturación del creador (Bloque 1) + hook de lectura del
// perfil fiscal. El CSD (cer/key) se manda en base64; nunca se guarda en Firestore
// (va directo a Facturapi vía la callable). Ver backend/src/facturacion/.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ── Datos fiscales (Bloque 1a) ───────────────────────────────────────────────
export type SaveCreatorTaxProfileInput = {
  taxId: string; // RFC
  legalName: string; // razón social / nombre fiscal
  taxSystem: string; // clave de régimen SAT (ej. "626")
  zip: string; // CP fiscal
  acceptSelfBilling: boolean;
};

export async function saveCreatorTaxProfile(
  input: SaveCreatorTaxProfileInput
): Promise<{ ok: boolean; status: string }> {
  const fn = httpsCallable<SaveCreatorTaxProfileInput, { ok: boolean; status: string }>(
    functions,
    "saveCreatorTaxProfile"
  );
  const res = await fn(input);
  return res.data;
}

// ── Subida de CSD (Bloque 1b) ────────────────────────────────────────────────
export type UploadCreatorCsdInput = {
  cerBase64: string;
  keyBase64: string;
  password: string;
};

export async function uploadCreatorCsd(
  input: UploadCreatorCsdInput
): Promise<{ ok: boolean; status: string; expiresAt: string | null }> {
  const fn = httpsCallable<UploadCreatorCsdInput, { ok: boolean; status: string; expiresAt: string | null }>(
    functions,
    "uploadCreatorCsd"
  );
  const res = await fn(input);
  return res.data;
}

/** Lee un File binario (cer/key) a base64 (sin el prefijo data:). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

// ── Hook: perfil fiscal del creador (lectura en vivo) ────────────────────────
export type CreatorTaxProfile = {
  taxId?: string;
  legalName?: string;
  taxSystem?: string;
  zip?: string;
  csdStatus?: "none" | "valid" | "invalid";
  csdExpiresAt?: string | null;
  status?: "data_complete" | "ready" | string;
  selfBillingConsent?: { accepted?: boolean };
};

export function useCreatorTaxProfile(uid: string | null | undefined) {
  const [profile, setProfile] = useState<CreatorTaxProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, "creatorTaxProfiles", uid),
      (snap) => {
        setProfile(snap.exists() ? (snap.data() as CreatorTaxProfile) : null);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid]);

  const hasData = !!(profile?.taxId && profile?.taxSystem && profile?.zip && profile?.legalName);
  const csdReady = profile?.csdStatus === "valid";
  return { profile, loading, hasData, csdReady };
}
