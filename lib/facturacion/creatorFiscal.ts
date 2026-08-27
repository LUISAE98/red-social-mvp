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
  /** Consentimiento de auto-facturación (self-billing): obligatorio para la ruta auto. */
  acceptSelfBilling: boolean;
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
/** Dónde tributa el creador. Decide todo su alta de cobro y sus retenciones. */
export type CreatorResidency = "MX" | "FOREIGN";

/** Guarda la residencia fiscal declarada por el creador. */
export async function setCreatorResidency(
  residency: CreatorResidency
): Promise<{ ok: boolean; residency: CreatorResidency; changed: boolean }> {
  const fn = httpsCallable<{ residency: CreatorResidency }, { ok: boolean; residency: CreatorResidency; changed: boolean }>(
    functions,
    "setCreatorResidency"
  );
  const res = await fn({ residency });
  return res.data;
}

/**
 * Guarda el país de la cuenta donde cobra el creador.
 *
 * 🚨 Es un dato fiscal: cobrar fuera de México sube su retención de IVA del 50% al 100%.
 * `raisesRetention` viene en la respuesta para poder advertírselo en pantalla.
 */
export async function setCreatorPayoutAccountCountry(
  country: string
): Promise<{ ok: boolean; country: string; changed: boolean; raisesRetention: boolean }> {
  const fn = httpsCallable<{ country: string }, { ok: boolean; country: string; changed: boolean; raisesRetention: boolean }>(
    functions,
    "setCreatorPayoutAccountCountry"
  );
  const res = await fn({ country });
  return res.data;
}

export type CreatorTaxProfile = {
  residency?: CreatorResidency;
  /** País de la cuenta donde cobra. Fuera de México sube la retención al 100%. */
  payoutAccountCountry?: string | null;
  /** ¿Hay constancia de residencia fiscal en el expediente? Sin ella no aplica el tratado. */
  residencyCertificate?: boolean;
  /**
   * Estado del alta de cobro con la procesadora, que incluye su verificación de identidad.
   *
   * 🚧 Todavía nada lo escribe: el alta de Stripe no existe. Cuando exista, su webhook pone
   * aquí `"verified"` y el gate del retiro se abre solo, sin tocar esta lógica.
   */
  stripeAccountStatus?: "none" | "pending" | "verified" | "restricted";
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

  /**
   * ⚠️ Un sello VENCIDO sigue guardado como `valid`.
   *
   * Firestore no caduca campos solo: `csdStatus` se puso en "valid" el día que se subió y ahí
   * se queda. Confiar solo en él significa dejar retirar a alguien cuyo sello ya no puede
   * timbrar nada — y descubrirlo cuando falle la primera factura de un comprador.
   *
   * Por eso la vigencia se comprueba también contra la fecha, aquí y en cada lectura.
   */
  // El instante se captura UNA vez por montaje: leer el reloj en cada render es impuro y,
  // para una vigencia de meses, mirarlo al entrar es de sobra.
  const [ahora] = useState(() => Date.now());
  const csdVencido = (() => {
    const iso = profile?.csdExpiresAt;
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) && t <= ahora;
  })();
  const csdReady = profile?.csdStatus === "valid" && !csdVencido;
  const residency = profile?.residency ?? null;
  /**
   * ¿Puede retirar?
   *
   * El mexicano necesita identidad **y** sello: sin sello, Vibra no puede emitir sus facturas
   * de venta, y dejarlo cobrar sería dejarlo vender sin poder facturar. El extranjero no emite
   * CFDI, así que le basta la identidad.
   *
   * 🚧 Hoy nadie escribe `stripeAccountStatus`, así que esto es false para todos — que es el
   * comportamiento seguro. Cuando el alta de Stripe lo ponga en `"verified"`, el gate se abre
   * solo: no hay que volver a tocar esta función.
   */
  const identityReady = profile?.stripeAccountStatus === "verified";
  const payoutReady = residency === "FOREIGN" ? identityReady : identityReady && csdReady;
  return {
    profile,
    loading,
    hasData,
    csdReady,
    csdVencido,
    residency,
    payoutAccountCountry: profile?.payoutAccountCountry ?? null,
    /** ¿Cobra fuera de México? Le sube la retención de IVA al 100%. */
    cobraFueraDeMexico:
      residency === "MX" &&
      !!profile?.payoutAccountCountry &&
      profile.payoutAccountCountry.toUpperCase() !== "MX",
    identityReady,
    payoutReady,
  };
}
