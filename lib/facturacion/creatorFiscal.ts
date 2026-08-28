"use client";

// Wrappers cliente de la facturación del creador (Bloque 1) + hook de lectura del
// perfil fiscal. El CSD (cer/key) se manda en base64; nunca se guarda en Firestore
// (va directo a Facturapi vía la callable). Ver backend/src/facturacion/.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import {
  payoutTermsOf,
  isKnownUnpayableCountry,
  PAYOUT_TERMS_PROVISIONAL,
  type PayoutTerms,
} from "@/lib/wallet/payoutTiers";
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
   * Estado del alta de cobro en Stripe Global Payouts.
   *
   * ⚠️ **No es su identidad.** Esa la da el KYC de Didit. Esto dice si tiene una cuenta
   * bancaria verificada a la que mandarle el dinero, que es otra cosa. Lo escribe
   * `backend/src/payments/stripe/globalPayoutsRecipient.ts` al crear la cuenta y al volver
   * del formulario alojado.
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
  /**
   * Identidad verificada, leída de `kyc/{uid}` — el documento que escribe el
   * webhook de Didit y que nadie más puede tocar (ver `firestore.rules`).
   *
   * Vive aquí y no en la página para que TODO lo que pregunte si el creador
   * puede cobrar reciba la misma respuesta: el panel de alta, el botón de
   * retiro y cualquier pantalla futura.
   */
  const [kycAprobado, setKycAprobado] = useState(false);
  /** País del documento con el que se verificó. Lo escribe el webhook al aprobar. */
  const [kycCountry, setKycCountry] = useState<string | null>(null);

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

  useEffect(() => {
    // Sin uid no se toca el estado: escribirlo aquí sería un setState en el cuerpo
    // del efecto, que dispara renders en cascada. El caso "sin sesión" lo resuelve
    // `identityReady` exigiendo uid, más abajo.
    if (!uid) return;
    const unsub = onSnapshot(
      doc(db, "kyc", uid),
      (snap) => {
        setKycAprobado(snap.data()?.kycApproved === true);
        const p = snap.data()?.documentCountry;
        setKycCountry(typeof p === "string" && p ? p.toUpperCase() : null);
      },
      // Si la lectura falla, NO se asume verificado: sin identidad no se cobra.
      () => {
        setKycAprobado(false);
        setKycCountry(null);
      }
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

  const payoutAccountCountry = profile?.payoutAccountCountry ?? null;

  /**
   * ¿Es mexicano para efectos de facturación?
   *
   * ⚠️ **YA NO SE PREGUNTA (2026-08-27).** Antes el panel arrancaba con «¿dónde declaras
   * impuestos?». Sobra: una respuesta se puede equivocar, un documento no. Se deduce de dos
   * señales duras, y basta con que UNA apunte a México:
   *
   * - El **país del documento** del KYC — es la que de verdad decide, porque quien debe
   *   facturar en México es quien tributa ahí.
   * - El **país de la cuenta de cobro** — no prueba residencia fiscal, pero una CLABE
   *   mexicana es señal suficiente para pedirle los datos y que él confirme.
   *
   * `profile.residency` se conserva como ANULACIÓN MANUAL, para el caso raro que las dos
   * señales resuelvan mal: un mexicano que tributa fuera, o al revés.
   */
  const esMexicano =
    profile?.residency === "MX" ||
    (profile?.residency !== "FOREIGN" &&
      (kycCountry === "MX" || payoutAccountCountry === "MX"));

  const residency: CreatorResidency | null =
    profile?.residency ?? (kycCountry || payoutAccountCountry ? (esMexicano ? "MX" : "FOREIGN") : null);

  /**
   * 💰 Su comisión y su mínimo de retiro, según el país de la CUENTA DE COBRO.
   *
   * `null` cuando no hay cuenta todavía, o cuando el país no tiene ruta de pago. Los dos
   * casos se distinguen abajo, porque al creador hay que decirle cosas muy distintas.
   *
   * ⚠️ Esto solo SIRVE PARA MOSTRAR. La comisión que cuenta es la que el backend congeló en
   * cada asiento el día de la venta, y una venta vieja conserva la suya.
   */
  const payoutTerms: Readonly<PayoutTerms> | null = payoutTermsOf(payoutAccountCountry);

  /**
   * 🔴 Vende pero no cobra.
   *
   * 73 países donde Global Payouts no llega. Su creador puede acumular saldo que hoy nadie
   * le puede sacar, así que hay que decírselo, no dejarlo descubrirlo al pedir el retiro.
   */
  const payoutCountryUnpayable = isKnownUnpayableCountry(payoutAccountCountry);

  // Lo que se enseña mientras no hay cuenta: el caso estándar, que es el de 45 de los 74
  // países pagables. En cuanto da de alta su cuenta, manda su país de verdad.
  const terminosVisibles = payoutTerms ?? PAYOUT_TERMS_PROVISIONAL;
  /**
   * ¿Sabemos quién es?
   *
   * ⚠️ La identidad la da el KYC de Didit, no `stripeAccountStatus`. Ese campo era un
   * marcador de posición de cuando se pensaba que la verificación vendría en el alta de
   * Stripe Connect. Ese camino se abandonó —la plataforma pasa a Global Payouts, que no trae
   * verificación de destinatarios— así que nadie lo escribió nunca y el gate estuvo cerrado
   * para todos. Hoy `stripeAccountStatus` sí se escribe, pero significa otra cosa: que tiene
   * cuenta a la que cobrar, no que sepamos quién es.
   */
  const identityReady = !!uid && kycAprobado;

  /**
   * ¿Tiene a dónde cobrar?
   *
   * 🔴 Faltaba en el gate. Sin esto un creador con solo el KYC aprobado pasaba, pedía su
   * retiro y no había cuenta a la que mandárselo — se descubría en el peor momento.
   */
  const payoutAccountReady = profile?.stripeAccountStatus === "verified";

  /**
   * ¿Puede retirar?
   *
   * Identidad y cuenta de cobro son de TODOS. El sello solo del mexicano: sin él, Vibra no
   * puede emitir sus facturas de venta, y dejarlo cobrar sería dejarlo vender sin poder
   * facturar. El extranjero no emite CFDI, así que no hay sello que pedirle.
   *
   * Y el país tiene que tener ruta de pago. En la práctica lo cubre `payoutAccountReady`
   * —Stripe no verifica una cuenta de un país al que no llega—, pero se comprueba aparte
   * porque es lo que permite explicárselo, y porque atarlo a una suposición sobre lo que
   * Stripe hace es exactamente el tipo de gate que se abre solo el día que Stripe cambia.
   */
  const payoutReady =
    identityReady &&
    payoutAccountReady &&
    payoutTerms != null &&
    (esMexicano ? csdReady : true);
  return {
    profile,
    loading,
    hasData,
    csdReady,
    csdVencido,
    residency,
    /** Derivado de las señales duras; `profile.residency` lo anula si está puesto. */
    esMexicano,
    /** País del documento del KYC. `null` mientras no haya verificación aprobada. */
    kycCountry,
    payoutAccountCountry,
    /** Estado del alta de cobro en Stripe. */
    stripeAccountStatus: profile?.stripeAccountStatus ?? "none",
    payoutAccountReady,
    /** Sus condiciones reales, o `null` si aún no hay cuenta o el país no es pagable. */
    payoutTerms,
    /** El país de su cuenta vende pero no cobra. Hay que decírselo. */
    payoutCountryUnpayable,
    /** Su comisión, con el estándar como respaldo mientras no hay cuenta. Solo para MOSTRAR. */
    commissionRate: terminosVisibles.commissionRate,
    /** Su mínimo de retiro en USD, con el estándar como respaldo. Solo para MOSTRAR. */
    minWithdrawalUsd: terminosVisibles.minWithdrawalUsd,
    /** ¿Cobra fuera de México? Le sube la retención de IVA al 100%. */
    cobraFueraDeMexico:
      esMexicano &&
      !!profile?.payoutAccountCountry &&
      profile.payoutAccountCountry.toUpperCase() !== "MX",
    identityReady,
    payoutReady,
  };
}
