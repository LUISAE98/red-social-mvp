// Solicitudes de retiro del creador, y su revisión por administración.
//
// 🧭 EL FLUJO, decidido con Luis el 2026-08-30:
//
//   1. El creador pulsa «Retirar» → se crea una SOLICITUD, no un pago.
//   2. La solicitud aparece en `/admin/retiros`.
//   3. Administración la ACEPTA o la RECHAZA con un motivo.
//   4. Aceptada, el dinero sale de su saldo y se manda.
//
// 🚨 POR QUÉ NO SE PAGA SOLO. Un `OutboundPayment` mal mandado no se deshace con un botón: es
//    una transferencia bancaria de verdad, a una cuenta que solo hemos podido comprobar por
//    sus últimos cuatro dígitos (ver `guardarCuentaDeclarada`). El paso humano es lo que
//    convierte un error en una llamada, en vez de en un dinero perdido.
//
// ⚠️ EL DINERO SE CONGELA AL SOLICITAR, no al aprobar. Entre que el creador pide y alguien
//    revisa pueden pasar horas, y en esas horas puede vender más, pedir otro retiro o que le
//    reembolsen una venta. Si el importe se calculara al aprobar, sería otro del que aceptó.
//
// ⚠️ Y SE DESCUENTA DEL SALDO AL SOLICITAR. Sin eso, dos solicitudes seguidas retirarían dos
//    veces el mismo dinero. Al rechazar se devuelve entero.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { requirePlatformMod } from "../authz";
import { calcularRetiro } from "../tax/fiscalEngine";
import { payoutTermsOf, paisDeCobroDe, type PayoutRoute } from "./payoutTiers";
import { SETTLEMENT_CURRENCY } from "./ledger";
import { enviarPago, leerPago } from "../payments/stripe/outboundPayment";
import { stripeSecretKey, stripePayoutsSecretKey } from "../payments/stripe/stripeClient";

const REGION = "us-central1";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function num(x: unknown): number {
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/**
 * ¿El sello ya venció?
 *
 * ⚠️ Firestore no caduca campos solo: `csdStatus` se quedó en `valid` el día que se subió y
 * ahí sigue. La fecha es lo único que dice la verdad, y por eso se mira aparte del estado.
 */
function selloCaducado(expiresAt: unknown): boolean {
  if (!expiresAt) return false; // sin fecha no se puede afirmar que venció
  const d =
    typeof (expiresAt as { toDate?: () => Date })?.toDate === "function"
      ? (expiresAt as { toDate: () => Date }).toDate()
      : new Date(String(expiresAt));
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

/**
 * Estados de una solicitud.
 *
 * `paid` y `failed` los pondrá el envío real cuando exista; hoy una solicitud aceptada se
 * queda en `approved` y el dinero se manda a mano. Están en el tipo desde ahora para que el
 * día que se conecte `OutboundPayment` no haya que migrar documentos.
 */
export type WithdrawalStatus =
  | "pending"
  | "approved"
  | "rejected"
  /**
   * 🚚 El dinero VA EN CAMINO, pero el banco todavía no lo acreditó.
   *
   * Es el estado en el que vive un `OutboundPayment` recién creado (`processing`), y puede
   * durar de uno a siete días según el país. Existe porque antes se saltaba: se marcaba `paid`
   * en cuanto Stripe respondía, así que un pago que el banco devolviera se quedaba como pagado
   * para siempre y el creador nunca recuperaba su saldo.
   */
  | "sent"
  /** El banco lo acreditó. `posted` en Stripe. Aquí sí terminó. */
  | "paid"
  | "failed";

/**
 * Del estado de Stripe al nuestro.
 *
 * 🚨 **Crear un `OutboundPayment` NO es haber pagado.** Nace en `processing` y solo pasa a
 *    `posted` cuando el banco lo acredita, uno a siete días después. Entre medias puede caer
 *    en `failed`, `returned` o `canceled`.
 *
 * Lo que devuelve:
 *   · `paid`   — terminó bien, no hay nada más que hacer.
 *   · `sent`   — va en camino, hay que seguir mirándolo.
 *   · `failed` — se cayó, **y hay que devolverle el saldo al creador**.
 *
 * Un estado desconocido se trata como `sent`, no como `paid` ni como `failed`: ante la duda,
 * ni le damos por bueno un dinero que no llegó ni le devolvemos uno que sí.
 */
/**
 * 🚦 LAS PUERTAS DEL RETIRO, en un solo sitio y sin Firestore.
 *
 * Vivían dentro del `onCall`, enredadas con la transacción, y eso las volvía imposibles de
 * probar: para comprobar que un mexicano sin sello no puede retirar hacía falta levantar el
 * emulador, sembrar cuatro documentos e invocar un callable. Nadie lo hizo, y por eso el
 * gate del sello llegó a producción sin comprobarse.
 *
 * Aquí son datos que entran y un motivo que sale. `requestWithdrawal` llama a esto y lanza;
 * los tests llaman a esto y comparan.
 *
 * 🚨 Devuelve el PRIMER motivo que encuentra, en el mismo orden que antes: identidad, cuenta,
 *    sello, mínimo. El orden importa porque es el que decide qué mensaje ve el creador, y
 *    enseñarle «te falta saldo» cuando lo que le falta es el sello lo manda a buscar donde
 *    no es.
 */
export type MotivoBloqueo =
  | "sin_kyc"
  | "cuenta_no_lista"
  | "sin_sello"
  | "bajo_minimo"
  | "nada_que_retirar";

export type EntradaPuertas = {
  /** Perfil fiscal del creador (`creatorTaxProfiles`). */
  perfil: {
    payoutAccountDeclared?: unknown;
    declaredAccountMatchesStripe?: unknown;
    stripeAccountStatus?: unknown;
    residency?: unknown;
    payoutAccountCountry?: unknown;
    csdStatus?: unknown;
    csdExpiresAt?: unknown;
  };
  /** Su verificación de identidad (`kyc`). */
  kyc: { status?: unknown; documentCountry?: unknown };
  /** Su resumen de wallet. */
  resumen: { lifetimeEarnedNet?: unknown; withdrawnNet?: unknown };
  /** Condiciones de su país. */
  condiciones: { route: PayoutRoute; minWithdrawalUsd: number };
  /** Lo que le quedaría después de retenciones. Se pasa ya calculado. */
  neto: number;
};

/**
 * Lo que se le dice al creador por cada puerta cerrada.
 *
 * Van aparte del motivo a propósito: el motivo es un dato que los tests comparan sin
 * depender de la redacción, y el texto se puede afinar sin romper una sola prueba.
 */
const MENSAJE_BLOQUEO: Record<
  MotivoBloqueo,
  (c: { minWithdrawalUsd: number }) => string
> = {
  sin_kyc: () => "Necesitas verificar tu identidad antes de retirar.",
  cuenta_no_lista: () =>
    "Tu cuenta de cobro no está lista. Revisa tu registro para retiros.",
  sin_sello: () =>
    "Necesitas tu sello digital vigente para poder retirar. Súbelo en tu registro para retiros.",
  bajo_minimo: (c) =>
    `Tu saldo no llega al mínimo de ${c.minWithdrawalUsd} ${SETTLEMENT_CURRENCY}.`,
  nada_que_retirar: () => "No hay nada que retirar.",
};
export function motivoDeBloqueo(entrada: EntradaPuertas): MotivoBloqueo | null {
  const { perfil, kyc, resumen, condiciones, neto } = entrada;

  // 1 · Identidad. Es de los 89 países pagables, sin excepción.
  if (kyc.status !== "approved") return "sin_kyc";

  // 2 · Cuenta de cobro. En Wallbit no hay alta de Stripe que comprobar.
  const declarada = perfil.payoutAccountDeclared === true;
  const coincide = perfil.declaredAccountMatchesStripe !== false;
  const stripeListo =
    condiciones.route === "wallbit" || perfil.stripeAccountStatus === "verified";
  if (!declarada || !coincide || !stripeListo) return "cuenta_no_lista";

  /*
   * 3 · Sello, solo al mexicano.
   *
   * ⚠️ MISMA REGLA QUE `useCreatorTaxProfile`, y no una parecida. Basta con que el documento
   *    O la cuenta digan México: mirando solo la cuenta, un mexicano que cobra en Estados
   *    Unidos salía «extranjero» y se saltaba el sello — justo el caso que hay que vigilar.
   */
  const paisDocumento = String(kyc.documentCountry ?? "").toUpperCase();
  const paisCuenta = String(perfil.payoutAccountCountry ?? "").toUpperCase();
  const esMexicano =
    perfil.residency === "MX" ||
    (perfil.residency !== "FOREIGN" && (paisDocumento === "MX" || paisCuenta === "MX"));
  if (esMexicano) {
    const selloVigente = perfil.csdStatus === "valid" && !selloCaducado(perfil.csdExpiresAt);
    if (!selloVigente) return "sin_sello";
  }

  // 4 · Mínimo. Es el de SU país: 300 en el tramo estándar, 500 en el de wire.
  const saldo = round2(num(resumen.lifetimeEarnedNet) - num(resumen.withdrawnNet));
  if (saldo < condiciones.minWithdrawalUsd) return "bajo_minimo";

  if (!(neto > 0)) return "nada_que_retirar";

  return null;
}

export function estadoDeStripe(estado: string | null | undefined): WithdrawalStatus {
  switch ((estado ?? "").toLowerCase()) {
    case "posted":
      return "paid";
    case "failed":
    case "returned":
    case "canceled":
    case "cancelled":
      return "failed";
    default:
      return "sent";
  }
}

export const WITHDRAWALS = "withdrawalRequests";

/** Lo que se congela de una solicitud. Todo en la moneda de liquidación. */
type Desglose = {
  saldo: number;
  ivaCobrado: number;
  isr: number;
  iva: number;
  ivaComision: number;
  ivaPorDeclarar: number;
  neto: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. El creador solicita
// ─────────────────────────────────────────────────────────────────────────────

export const requestWithdrawal = onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Debes iniciar sesión.");

    /**
     * 🚨 UNA SESIÓN ANÓNIMA ES UNA SESIÓN.
     *
     * `request.auth.uid` existe también para los invitados —las compras sin login usan
     * Anonymous Auth— así que comprobar solo que haya sesión deja la puerta abierta a que
     * cualquiera invoque este callable.
     *
     * Hoy no consigue nada: fallaría en el KYC dos líneas más abajo. Pero es la misma
     * clase de agujero que tuvo el sello, un control que existe más arriba y no aquí, y
     * ese ya se coló una vez. Un creador siempre tiene cuenta de verdad.
     */
    if (request.auth?.token?.firebase?.sign_in_provider === "anonymous") {
      throw new HttpsError("permission-denied", "Necesitas una cuenta para poder retirar.");
    }

    /**
     * Atajo para dar el mensaje sin abrir una transacción. La comprobación QUE VALE está
     * dentro, junto a las demás lecturas: ésta sola no impediría dos toques simultáneos.
     */
    const abiertas = await db
      .collection(WITHDRAWALS)
      .where("creatorId", "==", uid)
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!abiertas.empty) {
      throw new HttpsError(
        "failed-precondition",
        "Ya tienes una solicitud de retiro en revisión. Te avisamos en cuanto se resuelva."
      );
    }

    const perfilRef = db.collection("creatorTaxProfiles").doc(uid);
    const kycRef = db.collection("kyc").doc(uid);
    const sRef = db.collection("users").doc(uid).collection("walletSummary").doc("current");
    const requestRef = db.collection(WITHDRAWALS).doc();
    const abiertasQuery = db
      .collection(WITHDRAWALS)
      .where("creatorId", "==", uid)
      .where("status", "==", "pending")
      .limit(1);

    const resultado = await db.runTransaction(async (tx) => {
      const [perfilSnap, kycSnap, sSnap, abiertasSnap] = await Promise.all([
        tx.get(perfilRef),
        tx.get(kycRef),
        tx.get(sRef),
        tx.get(abiertasQuery),
      ]);
      const perfil = perfilSnap.data() ?? {};
      const kyc = kycSnap.data() ?? {};
      const s = sSnap.data() ?? {};

      /**
       * 🚨 LA MISMA COMPROBACIÓN QUE ARRIBA, pero DENTRO de la transacción.
       *
       * ⚠️ Solo estaba fuera, y el comentario decía que también aquí. No lo estaba. Dos
       *    toques simultáneos podían crear dos solicitudes: la segunda fallaba por saldo
       *    —que sí es transaccional— pero era una protección por accidente, no por diseño.
       *    Con la consulta dentro de la transacción, Firestore serializa de verdad.
       */
      if (!abiertasSnap.empty) {
        throw new HttpsError(
          "failed-precondition",
          "Ya tienes una solicitud de retiro en revisión. Te avisamos en cuanto se resuelva."
        );
      }

      // ── Puede cobrar? ────────────────────────────────────────────────────
      /**
       * 🚨 EL PAÍS, CON RESPALDO EN EL DOCUMENTO DEL KYC.
       *
       * ⚠️ Esto pasaba `documentCountry: null` y BLOQUEABA EL 100% DE LOS RETIROS POR
       *    WALLBIT. `payoutAccountCountry` solo lo escribe el alta de Stripe, y el creador
       *    de los 12 países de Wallbit nunca pasa por ahí — así que su país salía `null` y
       *    el retiro moría con «todavía no podemos enviar dinero a tu país», que además es
       *    justo lo contrario de lo que ocurre.
       *
       * Es la misma cadena que usa el resto del sistema: cuenta primero, documento después.
       * Ver `paisDeCobroDe` en `payoutTiers.ts`.
       */
      const pais = paisDeCobroDe({
        payoutAccountCountry:
          typeof perfil.payoutAccountCountry === "string" ? perfil.payoutAccountCountry : null,
        documentCountry: typeof kyc.documentCountry === "string" ? kyc.documentCountry : null,
      });
      const condiciones = pais ? payoutTermsOf(pais) : null;
      if (!condiciones) {
        throw new HttpsError(
          "failed-precondition",
          "Todavía no podemos enviar dinero al país de tu cuenta."
        );
      }

      /**
       * 🚨 LAS MISMAS COMPROBACIONES QUE ESCONDEN EL BOTÓN, otra vez aquí.
       *
       * El frontend decide si lo enseña; esto decide si vale. Un botón escondido no es un
       * control: basta con llamar al callable a mano para saltárselo.
       */
      /**
       * 🚦 Las puertas, todas de golpe.
       *
       * Estaban escritas aquí dentro, mezcladas con la transacción, y por eso nunca se
       * probaron: comprobar que un mexicano sin sello no puede retirar exigía levantar el
       * emulador e invocar el callable. Ahora viven en `motivoDeBloqueo`, que es una función
       * pura, y los tests la llaman directamente. **Este código y el que se prueba son el
       * mismo**, que es lo que un test de dinero tiene que garantizar.
       */
      const saldo = round2(num(s.lifetimeEarnedNet) - num(s.withdrawnNet));

      /*
       * El desglose se calcula AQUÍ, en el servidor, con el mismo motor que lo enseña la
       * wallet. Nunca se acepta un importe que venga del cliente: sería dejar que el creador
       * escriba cuánto se le paga.
       */
      const r = calcularRetiro({
        saldo,
        ivaCobradoPendiente: num(s.pendingMxVatCollected),
        isrPendiente: num(s.pendingRetainedIsr),
        ivaPendiente: num(s.pendingRetainedIva),
        ivaComisionPendiente: num(s.pendingCommissionVat),
      });

      const motivo = motivoDeBloqueo({
        perfil,
        kyc,
        resumen: s,
        condiciones,
        neto: r.neto,
      });
      if (motivo) {
        throw new HttpsError("failed-precondition", MENSAJE_BLOQUEO[motivo](condiciones));
      }

      const desglose: Desglose = {
        saldo: r.bruto,
        ivaCobrado: r.ivaCobrado,
        isr: r.isr,
        iva: r.iva,
        ivaComision: r.ivaComision,
        ivaPorDeclarar: r.ivaPorDeclarar,
        neto: r.neto,
      };

      /**
       * 🚨 EL SALDO SE APARTA YA, con el retiro en revisión.
       *
       * `withdrawnNet` sube al SOLICITAR, no al aprobar. Si esperara a la aprobación, el
       * creador vería su saldo intacto y podría pedir un segundo retiro del mismo dinero.
       * Al rechazar se devuelve, junto con las retenciones.
       */
      tx.set(
        sRef,
        {
          withdrawnNet: round2(num(s.withdrawnNet) + r.bruto),
          pendingMxVatCollected: round2(Math.max(0, num(s.pendingMxVatCollected) - r.ivaCobrado)),
          pendingRetainedIsr: round2(Math.max(0, num(s.pendingRetainedIsr) - r.isr)),
          pendingRetainedIva: round2(Math.max(0, num(s.pendingRetainedIva) - r.iva)),
          pendingCommissionVat: round2(Math.max(0, num(s.pendingCommissionVat) - r.ivaComision)),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(requestRef, {
        creatorId: uid,
        status: "pending" satisfies WithdrawalStatus,
        currency: SETTLEMENT_CURRENCY,
        ...desglose,
        // Condiciones congeladas: por dónde y con qué reglas se aceptó.
        route: condiciones.route satisfies PayoutRoute,
        payoutCountry: pais,
        minWithdrawalUsd: condiciones.minWithdrawalUsd,
        commissionRate: condiciones.commissionRate,
        // Para que quien revise no tenga que ir a buscar de quién es.
        declaredAccountLast4: perfil.declaredAccountLast4 ?? null,
        declaredHolderName: perfil.declaredHolderName ?? null,
        /*
         * 🏷️ El TAG de Wallbit, congelado con el resto.
         *
         * Es el dato con el que se hace la transferencia a mano, así que quien revise el
         * retiro lo necesita a la vista. Y se copia AQUÍ, no se lee del perfil al pagar:
         * si el creador cambia de TAG entre que solicita y se le paga, el dinero tiene que
         * ir al que declaró cuando pidió, no al nuevo.
         */
        wallbitTag: perfil.wallbitTag ?? null,
        /**
         * 🔎 La sesión de Didit donde vive la cuenta COMPLETA.
         *
         * Vibra solo guarda los últimos cuatro dígitos y el titular; el número entero se
         * queda en Didit a propósito. Para pagar por Wallbit hace falta el dato completo,
         * así que quien revisa necesita poder llegar a esa sesión — y el id es lo único
         * que lo permite sin duplicar aquí datos bancarios.
         */
        payoutAccountSessionId: perfil.payoutAccountSessionId ?? null,
        stripeRecipientId: perfil.stripeRecipientId ?? null,
        stripeAccountBank: perfil.stripeAccountBank ?? null,
        createdAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
      });

      return { id: requestRef.id, ...desglose };
    });

    logger.info("retiro_solicitado", {
      uid,
      id: resultado.id,
      neto: resultado.neto,
      saldo: resultado.saldo,
    });
    return resultado;
  }
);

/**
 * Devuelve a la wallet el saldo y las retenciones que se apartaron al solicitar.
 *
 * 🚨 LO USAN DOS CAMINOS y tienen que hacer exactamente lo mismo: el RECHAZO de
 *    administración y el FALLO del envío. En los dos casos el creador se quedó sin su
 *    dinero apartado y sin recibirlo, que es el único estado que no puede persistir.
 */
async function devolverSaldo(
  tx: admin.firestore.Transaction,
  creatorId: string,
  w: Record<string, unknown>,
  s: Record<string, unknown>,
  sRef: admin.firestore.DocumentReference
): Promise<void> {
  tx.set(
    sRef,
    {
      withdrawnNet: round2(Math.max(0, num(s.withdrawnNet) - num(w.saldo))),
      pendingMxVatCollected: round2(num(s.pendingMxVatCollected) + num(w.ivaCobrado)),
      pendingRetainedIsr: round2(num(s.pendingRetainedIsr) + num(w.isr)),
      pendingRetainedIva: round2(num(s.pendingRetainedIva) + num(w.iva)),
      pendingCommissionVat: round2(num(s.pendingCommissionVat) + num(w.ivaComision)),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Administración revisa
// ─────────────────────────────────────────────────────────────────────────────

export const reviewWithdrawal = onCall(
  // El envío necesita la clave de Global Payouts, que es distinta de la de cobros.
  { region: REGION, cors: true, secrets: [stripeSecretKey, stripePayoutsSecretKey] },
  async (request) => {
    // Solo el dueño. Mover dinero de verdad no es tarea de un moderador de comunidad.
    /**
     * 🔐 Supermoderador de plataforma: claim `role=moderator` MÁS sesión de Google.
     *
     * ⚠️ Antes era `requirePlatformOwner`, que además exige que el correo sea exactamente
     *    el del dueño. Esa función existe **para migraciones y backfills** —lo dice su
     *    propio comentario—, operaciones que se corren una vez y tocan la base entera.
     *    Revisar retiros no es eso: es trabajo diario, y atarlo a un correo concreto
     *    significaba que nadie más podría aprobar un retiro nunca, ni siquiera con el
     *    claim puesto. Un viaje o una baja y los creadores dejan de cobrar.
     *
     * Sigue siendo estricto: hacen falta las DOS condiciones y el claim se pone a mano. Y
     * queda rastro de quién fue, en `reviewedBy`.
     */
    const revisorUid = requirePlatformMod(request);

    const { id, aprobar, motivo } = (request.data ?? {}) as {
      id?: unknown;
      aprobar?: unknown;
      motivo?: unknown;
    };
    const requestId = typeof id === "string" ? id.trim() : "";
    if (!requestId) throw new HttpsError("invalid-argument", "Falta la solicitud.");
    if (typeof aprobar !== "boolean") {
      throw new HttpsError("invalid-argument", "Hay que aceptar o rechazar.");
    }

    const razon = typeof motivo === "string" ? motivo.trim().slice(0, 500) : "";
    if (!aprobar && !razon) {
      // Un rechazo sin motivo deja al creador sin saber qué corregir.
      throw new HttpsError("invalid-argument", "Un rechazo necesita un motivo.");
    }

    const requestRef = db.collection(WITHDRAWALS).doc(requestId);

    const resultado = await db.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      if (!snap.exists) throw new HttpsError("not-found", "Esa solicitud no existe.");
      const w = snap.data() ?? {};

      // Idempotencia: dos clics en «Aceptar» no pagan dos veces.
      if (w.status !== "pending") {
        throw new HttpsError("failed-precondition", "Esa solicitud ya se resolvió.");
      }

      const creatorId = String(w.creatorId ?? "");
      if (!creatorId) throw new HttpsError("internal", "La solicitud no tiene creador.");

      if (aprobar) {
        tx.update(requestRef, {
          status: "approved" satisfies WithdrawalStatus,
          reviewedAt: FieldValue.serverTimestamp(),
          reviewedBy: revisorUid,
        });
        return {
          id: requestId,
          creatorId,
          aprobado: true,
          neto: num(w.neto),
          cuentaId: String(w.stripeRecipientId ?? ""),
          currency: String(w.currency ?? SETTLEMENT_CURRENCY),
          ruta: String(w.route ?? "stripe"),
        };
      }

      /**
       * 🚨 RECHAZAR DEVUELVE TODO. El saldo que se apartó al solicitar y las retenciones que
       *    se consumieron con él. Si no se devolvieran, un rechazo le costaría al creador el
       *    dinero que pidió — que es exactamente lo contrario de lo que significa rechazar.
       */
      const sRef = db.collection("users").doc(creatorId).collection("walletSummary").doc("current");
      const sSnap = await tx.get(sRef);
      await devolverSaldo(tx, creatorId, w, sSnap.data() ?? {}, sRef);

      tx.update(requestRef, {
        status: "rejected" satisfies WithdrawalStatus,
        reviewedAt: FieldValue.serverTimestamp(),
        reviewedBy: revisorUid,
        rejectionReason: razon,
      });

      return { id: requestId, creatorId, aprobado: false, neto: num(w.neto) };
    });

    logger.info("retiro_revisado", {
      id: resultado.id,
      creatorId: resultado.creatorId,
      aprobado: resultado.aprobado,
      neto: resultado.neto,
      revisor: revisorUid,
    });

    // Rechazada, no hay nada más que hacer.
    if (!resultado.aprobado) return resultado;

    /**
     * 🚨 EL ENVÍO, fuera de la transacción y a propósito.
     *
     * Una transacción de Firestore puede REINTENTARSE sola si hay contención, y con la
     * llamada a Stripe dentro se mandaría el dinero una vez por reintento. Fuera, se manda
     * una sola vez — y con la clave de idempotencia, ni siquiera eso puede duplicarse.
     *
     * ⚠️ Wallbit no tiene envío automatizado. Su solicitud se queda en `approved` y la
     *    transferencia se hace a mano, que es lo que dice el aviso del panel.
     */
    if (resultado.ruta !== "stripe") return resultado;

    const envio = await enviarPago({
      requestId: resultado.id,
      cuentaId: resultado.cuentaId,
      neto: resultado.neto,
      currency: resultado.currency,
    });

    if (envio.ok) {
      /**
       * 🚨 NO se marca `paid` aquí. Stripe devuelve `processing`, que significa «va en
       *    camino», no «pagado». Marcarlo como pagado dejaba un retiro devuelto por el banco
       *    como cobrado para siempre, sin devolverle el saldo al creador.
       *
       * El estado real lo cierra el webhook cuando Stripe dice `posted`.
       */
      const estado = estadoDeStripe(envio.estado);
      const c = envio.cotizacion;
      // 💱 Lo que de verdad pasó con el dinero. Sale del PAGO, no de la cotización, porque
      //    `outbound_payment_quotes` devuelve 404 en nuestra cuenta y el pago siempre responde.
      const l = envio.liquidacion;
      await requestRef.update({
        status: estado,
        outboundPaymentId: envio.outboundPaymentId,
        outboundStatus: envio.estado,
        sentAt: FieldValue.serverTimestamp(),
        ...(estado === "paid" ? { paidAt: FieldValue.serverTimestamp() } : {}),
        // 💱 Lo que Stripe cobró y al cambio que convirtió. Sin esto el coste del retiro
        //    era un modelo que nunca se contrastaba, y el creador no tenía el tipo de
        //    cambio con el que se le depositó — que es el que necesita para su CFDI.
        // Siempre: cuánto salió, cuánto le llega, a qué cambio y cuándo.
        debitado: l.debitado,
        acreditado: l.acreditado,
        acreditadoCurrency: l.monedaDestino,
        tipoCambio: l.tipoCambio,
        llegadaEstimada: l.llegadaEstimada,
        // Solo si hubo cotización. El pago no desglosa las comisiones.
        ...(c
          ? {
              stripeQuoteId: c.id,
              stripeFeeTotal: c.comisiones.total,
              stripeFeeFijo: c.comisiones.fijo,
              stripeFeeTransfronteriza: c.comisiones.transfronteriza,
              stripeFeeConversion: c.comisiones.conversion,
            }
          : {}),
      });
      return {
        ...resultado,
        enviado: true,
        outboundPaymentId: envio.outboundPaymentId,
        estado,
        acreditado: l.acreditado,
        acreditadoCurrency: l.monedaDestino,
        tipoCambio: l.tipoCambio,
      };
    }

    /**
     * 🚨 FALLÓ EL ENVÍO → SE DEVUELVE EL DINERO.
     *
     * Sin esto el creador queda en el peor estado posible: su saldo descontado y ningún
     * dinero en camino. Se le devuelve entero y la solicitud queda en `failed` con el
     * motivo, para que pueda volver a pedirlo.
     */
    await db.runTransaction(async (tx) => {
      const [wSnap, sSnap] = await Promise.all([
        tx.get(requestRef),
        tx.get(db.collection("users").doc(resultado.creatorId).collection("walletSummary").doc("current")),
      ]);
      const w = wSnap.data() ?? {};
      // Solo si sigue aprobada: si algo ya la movió, no se toca.
      if (w.status !== "approved") return;
      const sRef = db
        .collection("users")
        .doc(resultado.creatorId)
        .collection("walletSummary")
        .doc("current");
      await devolverSaldo(tx, resultado.creatorId, w, sSnap.data() ?? {}, sRef);
      tx.update(requestRef, {
        status: "failed" satisfies WithdrawalStatus,
        rejectionReason: envio.motivo,
        reviewedAt: FieldValue.serverTimestamp(),
      });
    });

    logger.error("retiro_envio_falló", {
      id: resultado.id,
      creatorId: resultado.creatorId,
      motivo: envio.motivo,
    });

    throw new HttpsError("internal", `No se pudo enviar el dinero. ${envio.motivo}`);
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. Cerrar un pago hecho a mano (Wallbit)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marca como pagada una solicitud que se transfirió fuera de la plataforma.
 *
 * 🚨 SOLO PARA WALLBIT. Las de Stripe pasan a `paid` solas cuando el `OutboundPayment` sale;
 *    dejar que alguien las marque a mano permitiría cerrar una que nunca se envió.
 *
 * No mueve dinero ni toca el saldo: eso ya ocurrió al solicitar. Lo único que hace es
 * sacar la solicitud de «pendiente de pago», que si no se acumularían para siempre.
 */
export const markWithdrawalPaid = onCall(
  { region: REGION, cors: true },
  async (request) => {
    /**
     * 🔐 Supermoderador de plataforma: claim `role=moderator` MÁS sesión de Google.
     *
     * ⚠️ Antes era `requirePlatformOwner`, que además exige que el correo sea exactamente
     *    el del dueño. Esa función existe **para migraciones y backfills** —lo dice su
     *    propio comentario—, operaciones que se corren una vez y tocan la base entera.
     *    Revisar retiros no es eso: es trabajo diario, y atarlo a un correo concreto
     *    significaba que nadie más podría aprobar un retiro nunca, ni siquiera con el
     *    claim puesto. Un viaje o una baja y los creadores dejan de cobrar.
     *
     * Sigue siendo estricto: hacen falta las DOS condiciones y el claim se pone a mano. Y
     * queda rastro de quién fue, en `reviewedBy`.
     */
    const revisorUid = requirePlatformMod(request);
    const { id, referencia } = (request.data ?? {}) as { id?: unknown; referencia?: unknown };
    const requestId = typeof id === "string" ? id.trim() : "";
    if (!requestId) throw new HttpsError("invalid-argument", "Falta la solicitud.");

    /**
     * 🚨 EL IDENTIFICADOR DE LA TRANSFERENCIA ES OBLIGATORIO.
     *
     * La ruta de Wallbit no tiene API: alguien mueve el dinero a mano y luego cierra la
     * solicitud. Sin este dato, lo ÚNICO que respalda un pago es que el operador dijo que
     * lo hizo — y si mañana el creador dice que no le llegó, no hay nada que cotejar.
     *
     * Se pidió el identificador y no un PDF a propósito. Un PDF no lo verifica nadie: se
     * puede subir el archivo equivocado y el sistema lo daría por bueno igual. Una cadena
     * corta se compara contra la app de Wallbit en cinco segundos. Y el extracto de Wallbit
     * contiene las transferencias de TODOS los creadores, así que adjuntarlo a la tarjeta de
     * uno le enseñaría cuánto cobraron los demás.
     *
     * Los 6 caracteres son un mínimo deliberado: impiden cerrar con un espacio o un guion,
     * que es lo que pasa cuando el campo es opcional y hay prisa.
     */
    const referenciaLimpia =
      typeof referencia === "string" ? referencia.trim().slice(0, 200) : "";
    if (referenciaLimpia.length < 6) {
      throw new HttpsError(
        "invalid-argument",
        "Falta el identificador de la transferencia de Wallbit. Sin él no se puede cerrar el retiro."
      );
    }

    const ref = db.collection(WITHDRAWALS).doc(requestId);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError("not-found", "Esa solicitud no existe.");
      const w = snap.data() ?? {};
      if (w.route !== "wallbit") {
        throw new HttpsError(
          "failed-precondition",
          "Las de Stripe se cierran solas cuando el envío sale."
        );
      }
      if (w.status !== "approved") {
        throw new HttpsError("failed-precondition", "Solo se cierran las aceptadas.");
      }
      tx.update(ref, {
        status: "paid" satisfies WithdrawalStatus,
        paidAt: FieldValue.serverTimestamp(),
        paidBy: revisorUid,
        // El identificador de la transferencia de Wallbit. Lo ve el creador en su tarjeta
        // de retiro, para que pueda cotejarlo contra su propia cuenta.
        paymentReference: referenciaLimpia,
      });
    });

    logger.info("retiro_marcado_pagado", { id: requestId, revisor: revisorUid });
    return { ok: true };
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. Conciliación: cerrar los retiros que van en camino
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🚚 Cierra los retiros que Stripe todavía estaba moviendo.
 *
 * Un `OutboundPayment` nace en `processing` y tarda de uno a siete días en llegar al banco.
 * Hasta el 2026-08-31 la solicitud se marcaba `paid` en cuanto Stripe aceptaba la orden, así
 * que **un pago devuelto por el banco quedaba como cobrado para siempre** y el creador nunca
 * recuperaba su saldo. Ahora queda en `sent` y esto es lo que lo cierra.
 *
 * Qué hace con cada uno:
 *   · `posted`   → `paid`. Terminó.
 *   · `failed`, `returned`, `canceled` → `failed` **y se le devuelve todo el saldo**, igual
 *     que en un rechazo: el dinero que se apartó y las retenciones que se consumieron con él.
 *   · cualquier otro → se deja en `sent` y se vuelve a mirar mañana.
 *
 * ⚠️ Es un SONDEO, no un webhook. Los eventos delgados (`thin events`) de la v2 son la vía
 *    buena y siguen pendientes; mientras tanto esto garantiza que ningún retiro se quede
 *    colgado, aunque tarde hasta un día en enterarse.
 */
export async function conciliarRetirosEnCamino(): Promise<{
  revisados: number;
  pagados: number;
  fallidos: number;
}> {
  const db = admin.firestore();
  const snap = await db
    .collection(WITHDRAWALS)
    .where("status", "==", "sent" satisfies WithdrawalStatus)
    .limit(200)
    .get();

  let pagados = 0;
  let fallidos = 0;

  for (const doc of snap.docs) {
    const w = doc.data() ?? {};
    const pagoId = String(w.outboundPaymentId ?? "");
    if (!pagoId) continue;

    const lectura = await leerPago(pagoId);
    if (!lectura.ok) continue; // se reintenta en la siguiente pasada

    const estado = estadoDeStripe(lectura.estado);
    if (estado === "sent") continue; // sigue en camino

    if (estado === "paid") {
      await doc.ref.update({
        status: "paid" satisfies WithdrawalStatus,
        outboundStatus: lectura.estado,
        paidAt: FieldValue.serverTimestamp(),
      });
      pagados++;
      logger.info("retiro_conciliado_pagado", { id: doc.id, creatorId: w.creatorId });
      continue;
    }

    /**
     * 🚨 SE CAYÓ → SE DEVUELVE EL DINERO, en transacción.
     *
     * Se relee el documento dentro de la transacción y solo se toca si sigue en `sent`: entre
     * la lectura de arriba y esta escritura puede haber pasado cualquier cosa, y devolver el
     * saldo dos veces sería regalarle dinero al creador.
     */
    const creatorId = String(w.creatorId ?? "");
    if (!creatorId) continue;
    const sRef = db.collection("users").doc(creatorId).collection("walletSummary").doc("current");

    await db.runTransaction(async (tx) => {
      const [wSnap, sSnap] = await Promise.all([tx.get(doc.ref), tx.get(sRef)]);
      const actual = wSnap.data() ?? {};
      if (actual.status !== "sent") return;
      await devolverSaldo(tx, creatorId, actual, sSnap.data() ?? {}, sRef);
      tx.update(doc.ref, {
        status: "failed" satisfies WithdrawalStatus,
        outboundStatus: lectura.estado,
        rejectionReason: `El banco no lo aceptó (${lectura.estado}). Te devolvimos tu saldo completo.`,
        reviewedAt: FieldValue.serverTimestamp(),
      });
    });

    fallidos++;
    logger.error("retiro_conciliado_fallido", {
      id: doc.id,
      creatorId,
      estadoStripe: lectura.estado,
    });
  }

  return { revisados: snap.size, pagados, fallidos };
}

/**
 * El sondeo, cada hora.
 *
 * Una hora es holgado a propósito: un `OutboundPayment` tarda días, no minutos, así que
 * mirarlo más seguido solo gastaría llamadas. Lo que importa es que ninguno se quede colgado.
 *
 * 🔁 **Sustituir por los eventos delgados de la v2 cuando estén.** Un webhook cerraría cada
 *    retiro en el momento en que Stripe lo mueve, en vez de hasta una hora después.
 */
export const conciliarRetiros = onSchedule(
  { schedule: "every 60 minutes", timeZone: "UTC", secrets: [stripePayoutsSecretKey] },
  async () => {
    const r = await conciliarRetirosEnCamino();
    if (r.pagados || r.fallidos) {
      logger.info("retiros_conciliados", r);
    }
  }
);
