// Comprobante de retiro — la constancia de que el dinero salió de verdad.
//
// POR QUÉ ES UN DOCUMENTO APARTE DEL COMPROBANTE MENSUAL
//
// No se solapan, responden preguntas distintas:
//
//   · El **mensual** (`facturacion/comprobanteLiquidacion.ts`) dice qué ganó el creador en un
//     periodo y qué se le descontó — comisión, retenciones, impuestos.
//   · **Este** dice que el dinero SALIÓ: cuándo, cuánto, a qué cuenta, a qué tipo de cambio y
//     cuánto le llegó en su moneda.
//
// El mensual no puede cubrirlo, y no es un capricho de formato: **un retiro junta ventas de
// varios meses**, y la conversión de moneda ocurre al retirar, no al vender.
//
// 🚨 AL CREADOR EXTRANJERO LE URGE MÁS. No recibe ningún CFDI —no puede, no es contribuyente
//    mexicano— así que este comprobante es su único papel de que ese dinero entró y de dónde
//    vino. Pero el mexicano tampoco tenía nada que documentara el tipo de cambio con el que se
//    le depositó, y ahora lo tiene.
//
// ⚠️ NO ES UN CFDI y no debe parecerlo. No se timbra y no sirve para deducir en México.
//
// ⚠️ SE GUARDA EL DATO, NO UN PDF. Misma decisión que en el comprobante mensual y por el mismo
//    motivo: con el dato guardado se reconstruye el PDF con cualquier formato, incluso años
//    después. Generar un PDF sin guardar el dato no se puede deshacer.
//
// 🚨 NO LLEVA LO QUE STRIPE LE COBRA A VIBRA. El retiro persiste `stripeFeeTotal` y su desglose,
//    y es tentador ponerlo aquí «por transparencia». Sería engañoso: esa comisión **la absorbe
//    Vibra**, no sale del dinero del creador. Meterla en su comprobante le haría pensar que se
//    le descontó algo que nunca se le descontó. Ese dato es de conciliación interna, y ahí vive.

import * as admin from "firebase-admin";
import { logger } from "firebase-functions";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ComprobanteRetiro = {
  creatorId: string;
  /** El id de la solicitud. Es el folio del comprobante. */
  withdrawalId: string;
  /** Moneda de liquidación de la plataforma, en la que vive el saldo. */
  currency: string;
  /** Lo que salió del saldo del creador. */
  bruto: number;
  /**
   * Lo que se le envió.
   *
   * Desde §A5 coincide con el bruto: las retenciones se aplican en la VENTA, no en el retiro.
   * Se guardan los dos igualmente, porque un comprobante tiene que poder explicarse solo aunque
   * la regla cambie después.
   */
  neto: number;
  /** Lo que le LLEGÓ, en su moneda. Igual al neto cuando cobra en dólares. */
  acreditado: number | null;
  monedaAcreditada: string | null;
  /**
   * 💱 El tipo de cambio con el que se le depositó.
   *
   * `null` cuando no hubo conversión, que es lo correcto: inventar un 1.0 haría creer que hubo
   * un cambio de moneda que no ocurrió.
   */
  tipoCambio: number | null;
  /** Por dónde se pagó, congelado en la solicitud. */
  route: string | null;
  /** País de la cuenta de cobro, que decidió las condiciones. */
  payoutCountry: string | null;
  /** Últimos cuatro dígitos de la cuenta declarada. Es lo único que se puede comprobar. */
  cuentaLast4: string | null;
  titular: string | null;
  /** Referencia del pago: el `OutboundPayment` de Stripe, o la anotada a mano en Wallbit. */
  referencia: string | null;
  /** Cuándo lo pidió y cuándo se pagó. Las dos importan y rara vez son la misma. */
  solicitadoEn: admin.firestore.Timestamp | null;
  pagadoEn: admin.firestore.Timestamp | null;
  creadoEn: admin.firestore.FieldValue;
};

/**
 * Arma el comprobante a partir del retiro ya pagado.
 *
 * Todo lo que necesita ya está congelado en la solicitud —ruta, país, cuenta, titular— y en el
 * envío —acreditado, moneda y tipo de cambio—, precisamente para que un comprobante emitido hoy
 * siga explicándose dentro de dos años, cuando el creador haya cambiado de banco tres veces.
 */
export function armarComprobanteRetiro(params: {
  withdrawalId: string;
  retiro: FirebaseFirestore.DocumentData;
  /** Referencia del pago, si quien cierra el retiro la conoce y no está en el documento. */
  referencia?: string | null;
}): ComprobanteRetiro {
  const { withdrawalId, retiro } = params;

  const texto = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };
  const numeroOnulo = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const acreditado = numeroOnulo(retiro.acreditado);

  return {
    creatorId: String(retiro.creatorId ?? ""),
    withdrawalId,
    currency: String(retiro.currency ?? "USD"),
    bruto: round2(num(retiro.saldo)),
    neto: round2(num(retiro.neto)),
    acreditado: acreditado === null ? null : round2(acreditado),
    monedaAcreditada: texto(retiro.acreditadoCurrency),
    tipoCambio: numeroOnulo(retiro.tipoCambio),
    route: texto(retiro.route),
    payoutCountry: texto(retiro.payoutCountry),
    cuentaLast4: texto(retiro.declaredAccountLast4),
    titular: texto(retiro.declaredHolderName),
    referencia:
      texto(params.referencia) ??
      texto(retiro.outboundPaymentId) ??
      texto(retiro.paymentReference),
    solicitadoEn: (retiro.createdAt as admin.firestore.Timestamp) ?? null,
    pagadoEn: (retiro.paidAt as admin.firestore.Timestamp) ?? null,
    creadoEn: admin.firestore.FieldValue.serverTimestamp(),
  };
}

/**
 * Guarda el comprobante bajo el creador, con el id del retiro.
 *
 * 🚨 IDEMPOTENTE POR CONSTRUCCIÓN. El id del documento es el del retiro, así que si el webhook
 *    llega dos veces —cosa que pasa— se sobreescribe el mismo comprobante en vez de crear dos.
 *
 * ⚠️ NUNCA TUMBA EL RETIRO. Si esto falla, el retiro sigue pagado: el dinero ya salió y un fallo
 *    al documentarlo no puede revertir eso. Se registra y se sigue, igual que los avisos.
 */
export async function guardarComprobanteRetiro(params: {
  withdrawalId: string;
  retiro: FirebaseFirestore.DocumentData;
  referencia?: string | null;
}): Promise<void> {
  try {
    const c = armarComprobanteRetiro(params);
    if (!c.creatorId) {
      logger.warn("comprobante_retiro_sin_creador", { withdrawalId: params.withdrawalId });
      return;
    }
    await db
      .collection("users")
      .doc(c.creatorId)
      .collection("comprobantesRetiro")
      .doc(params.withdrawalId)
      .set(c, { merge: true });
    logger.info("comprobante_retiro", {
      withdrawalId: params.withdrawalId,
      creatorId: c.creatorId,
      neto: c.neto,
      acreditado: c.acreditado,
    });
  } catch (err) {
    logger.warn("comprobante_retiro_falló", {
      withdrawalId: params.withdrawalId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
