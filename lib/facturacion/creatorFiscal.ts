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
  paisDeCobroDe,
  isKnownUnpayableCountry,
  PAYOUT_TERMS_PROVISIONAL,
  type PayoutTerms,
} from "@/lib/wallet/payoutTiers";
import { db } from "@/lib/firebase";
import { usePaisPorIp } from "@/lib/wallet/usePaisPorIp";

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
  /**
   * ¿Declaró su cuenta de cobro en el cuestionario de Didit?
   *
   * Para un creador de ruta WALLBIT ese cuestionario ES su registro de cobro. Para uno de
   * Stripe es la declaración de titularidad, que Stripe no comprueba en ningún país salvo el
   * Reino Unido.
   */
  payoutAccountDeclared?: boolean;
  /**
   * 🏷️ Su TAG de Wallbit. Solo en esa ruta, y ahí ES su cuenta: es a donde se transfiere.
   *
   * Sin él no hay destino, así que entra en `payoutReady` igual que la verificación de Stripe
   * entra en la otra ruta.
   */
  wallbitTag?: string | null;
  /**
   * ¿Coinciden los últimos 4 dígitos que declaró con los que Stripe reporta?
   *
   * `undefined` mientras falte alguna de las dos mitades. Solo `false` es una discrepancia
   * real, y esa sí hay que resolverla antes de pagarle.
   */
  declaredAccountMatchesStripe?: boolean;
  /** Los últimos 4 de la cuenta que declaró. La completa vive en Didit. */
  declaredAccountLast4?: string;
  /** Los últimos 4 de la cuenta que Stripe reporta. Es lo único comparable que da. */
  stripeAccountLast4?: string;
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
  /**
   * ⚠️ Estado CRUDO. Lo que se usa y se devuelve son `profile` y `loading`, derivados
   * más abajo.
   *
   * Guarda DE QUÉ uid es lo leído, no solo el perfil. Con un `loading` suelto había
   * que ponerlo en true desde el cuerpo del efecto al cambiar de uid, que es el
   * setState encadenado que la regla prohíbe. Sabiendo a quién pertenece el dato,
   * "estoy cargando" deja de ser algo que se escribe y pasa a ser algo que se
   * pregunta: lo leído no es de este uid todavía.
   */
  const [cargado, setCargado] = useState<{
    uid: string;
    profile: CreatorTaxProfile | null;
  } | null>(null);
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

  // Su país por IP, solo para estimar lo que se le enseña antes de que se registre.
  const ipPais = usePaisPorIp();

  useEffect(() => {
    // Sin uid no se toca el estado, por el mismo motivo que el efecto del KYC de
    // aquí abajo: escribirlo en el cuerpo del efecto encadena renders. El caso
    // "sin sesión" se resuelve DERIVANDO `profile` y `loading`, justo tras los
    // dos efectos.
    if (!uid) return;
    const unsub = onSnapshot(
      doc(db, "creatorTaxProfiles", uid),
      (snap) =>
        setCargado({
          uid,
          profile: snap.exists() ? (snap.data() as CreatorTaxProfile) : null,
        }),
      // Si la lectura falla se da por leído SIN perfil, y no se conserva el
      // anterior. Mismo criterio que el efecto del KYC de aquí abajo: ante una
      // duda sobre datos fiscales, la respuesta segura es "no hay", no "lo último
      // que vi".
      () => setCargado({ uid, profile: null })
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

  /**
   * Lo que ve quien usa el hook.
   *
   * Sin uid no hay nada que leer ni nada que esperar, así que `profile` es null y
   * `loading` es false. Con uid, se está cargando mientras lo leído no sea suyo.
   *
   * Derivarlo cierra además una fuga que el `setProfile(null)` de antes tapaba a
   * destiempo: al cambiar de sesión, entre que cambia el uid y el efecto vuelve a
   * correr, el perfil FISCAL del creador anterior seguía expuesto durante un
   * render. Ahora desaparece en el mismo render en que cambia el uid, porque lo
   * guardado deja de coincidir.
   */
  const leidoParaEsteUid = !!uid && cargado?.uid === uid;
  const profile = leidoParaEsteUid ? (cargado?.profile ?? null) : null;
  const loading = !!uid && !leidoParaEsteUid;

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
   * 🌎 El país que decide su ruta y su comisión.
   *
   * Normalmente es el de su cuenta de cobro, que es a donde viaja el dinero. Pero un creador
   * de ruta WALLBIT no da de alta cuenta en Stripe, así que ese campo se queda vacío para
   * siempre y hay que caer al país de su DOCUMENTO del KYC.
   *
   * El orden importa: si llegara a existir un país de cuenta, ese manda — es el dato duro
   * sobre a dónde va el dinero, mientras que el documento solo dice de dónde es la persona.
   */
  const paisDeCobro = paisDeCobroDe({ payoutAccountCountry, documentCountry: kycCountry });

  /**
   * 💰 Su comisión, su mínimo y su RUTA de pago.
   *
   * `null` cuando aún no se sabe su país, o cuando no tiene ruta de pago. Los dos casos se
   * distinguen abajo, porque al creador hay que decirle cosas muy distintas.
   *
   * ⚠️ Esto solo SIRVE PARA MOSTRAR. La comisión que cuenta es la que el backend congeló en
   * cada asiento el día de la venta, y una venta vieja conserva la suya.
   */
  const payoutTerms: Readonly<PayoutTerms> | null = payoutTermsOf(paisDeCobro);

  /**
   * 🔴 Vende pero no cobra.
   *
   * 73 países donde Global Payouts no llega. Su creador puede acumular saldo que hoy nadie
   * le puede sacar, así que hay que decírselo, no dejarlo descubrirlo al pedir el retiro.
   */
  const payoutCountryUnpayable = isKnownUnpayableCountry(paisDeCobro);

  /**
   * 👁️ Lo que se le ENSEÑA mientras no se sabe su país de verdad.
   *
   * Sale de su IP, la misma señal que ya decide su moneda y su idioma, para que no vea un
   * 25% que luego resulte 30%. Si su IP tampoco dice nada, el caso estándar.
   *
   * 🚨 **Esto NO entra en `payoutReady` ni en nada que decida dinero.** Una IP puede ser de
   * un viaje o de una VPN, y ninguna de las dos cosas puede cambiar lo que se le paga. El
   * gate de abajo usa `payoutTerms`, que solo sale de datos duros.
   */
  const terminosVisibles = payoutTerms ?? payoutTermsOf(ipPais) ?? PAYOUT_TERMS_PROVISIONAL;

  /** Lo que ve es una estimación por IP, no su trato real. La interfaz debería decirlo. */
  const terminosSonEstimados = payoutTerms == null;
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
  /**
   * ¿Tiene a dónde cobrar?
   *
   * Depende de su RUTA, porque no se le pide lo mismo:
   *
   * - **Stripe** — hace falta que su cuenta esté verificada en Global Payouts.
   * - **Wallbit** — no hay alta de Stripe que hacer, así que el cuestionario ES su registro
   *   de cobro. Y no basta con que lo haya completado: hace falta su **TAG**, que es la
   *   cuenta ahí. Sin él, abrir el gate sería prometerle un pago sin destino.
   */
  const payoutAccountReady =
    payoutTerms?.route === "wallbit"
      ? // 🚨 El TAG, no solo el cuestionario. `payoutAccountDeclared` dice que lo mandó; el
        // TAG dice que sabemos a dónde pagarle. Mismo criterio que el servidor.
        profile?.payoutAccountDeclared === true &&
        typeof profile?.wallbitTag === "string" &&
        profile.wallbitTag.trim().length > 0
      : // Para Stripe hacen falta las DOS mitades: que declarara su cuenta y que Stripe la
        // verificara. Sin la declaración no hay constancia de quién dice ser el titular;
        // sin la verificación, la cuenta puede no existir.
        profile?.stripeAccountStatus === "verified" &&
        profile?.payoutAccountDeclared === true;

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
    /**
     * El proveedor de facturación RECHAZÓ el sello que subió.
     *
     * ⚠️ No es lo mismo que no tenerlo. `csdStatus` distinguía «none» de «invalid» desde
     * siempre, pero nadie leía la diferencia: al creador con un sello rechazado se le
     * enseñaba el mismo «sube tu sello» que a quien no había subido nada, sin decirle
     * que ya lo intentó y falló. El motivo está en `csdLastError`.
     */
    csdRechazado: profile?.csdStatus === "invalid",
    residency,
    /** Derivado de las señales duras; `profile.residency` lo anula si está puesto. */
    esMexicano,
    /** País del documento del KYC. `null` mientras no haya verificación aprobada. */
    kycCountry,
    payoutAccountCountry,
    /** Estado del alta de cobro en Stripe. */
    stripeAccountStatus: profile?.stripeAccountStatus ?? "none",
    payoutAccountReady,
    /** Sus condiciones reales, o `null` si aún no se sabe su país o no es pagable. */
    payoutTerms,
    /** Por dónde cobra. `null` mientras no se sepa su país. */
    payoutRoute: payoutTerms?.route ?? null,
    /** ¿Declaró su cuenta en el cuestionario de Didit? */
    payoutAccountDeclared: profile?.payoutAccountDeclared === true,
    /**
     * 🔴 Declaró una cuenta y en Stripe metió otra.
     *
     * Solo es `true` cuando hay las dos mitades y NO coinciden. Que falte una no es una
     * discrepancia, es que todavía no hay nada que comparar.
     */
    declaredAccountMismatch: profile?.declaredAccountMatchesStripe === false,
    /** El país que decidió su ruta: el de su cuenta, o el de su documento. */
    paisDeCobro,
    /** El país de su cuenta vende pero no cobra. Hay que decírselo. */
    payoutCountryUnpayable,
    /** Su comisión, con el estándar como respaldo mientras no hay cuenta. Solo para MOSTRAR. */
    commissionRate: terminosVisibles.commissionRate,
    /** Su mínimo de retiro en USD. Solo para MOSTRAR. */
    minWithdrawalUsd: terminosVisibles.minWithdrawalUsd,
    /** El nivel que se le enseña sale de su IP, no de un dato suyo. */
    terminosSonEstimados,
    /** El nivel visible, estimado o real. Para el texto que se lo explica. */
    terminosVisibles,
    /** ¿Cobra fuera de México? Le sube la retención de IVA al 100%. */
    cobraFueraDeMexico:
      esMexicano &&
      !!profile?.payoutAccountCountry &&
      profile.payoutAccountCountry.toUpperCase() !== "MX",
    identityReady,
    payoutReady,
  };
}
