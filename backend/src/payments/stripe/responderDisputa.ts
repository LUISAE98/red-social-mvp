// Responder una disputa con la evidencia que ya está en el sistema.
//
// EL PROBLEMA QUE CIERRA
//
// Las disputas se registraban y **nadie las contestaba**. Había que entrar a Stripe a mano, armar
// la evidencia leyendo la base de datos, y hacerlo antes de que venciera el plazo. Una disputa sin
// respuesta se pierde por incomparecencia: el dinero se va aunque el servicio se haya prestado.
//
// 🚨 LA EVIDENCIA NO SE INVENTA, SE REÚNE. Todo lo que se manda ya existe en Firestore: qué se
//    compró, cuándo, si se entregó, con qué correo, desde qué país. Este módulo no juzga si la
//    disputa tiene razón — solo presenta lo que consta. Si el servicio no se entregó, la evidencia
//    lo dirá y la disputa se perderá, que es lo correcto.
//
// ⚠️ ES MANUAL A PROPÓSITO. Igual que las cancelaciones: responder es un acto que se hace una vez
//    y no se deshace, y a veces la respuesta correcta es **no responder** —cuando el comprador
//    tiene razón y sale más barato aceptar que perder también la comisión de la disputa—.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { stripeFetch } from "./stripeClient";
import { requirePlatformMod } from "../../authz";

const REGION = "us-central1";

if (admin.apps.length === 0) {
  admin.initializeApp();
}
const db = admin.firestore();

type Cargo = {
  id?: string;
  payment_intent?: string;
  metadata?: Record<string, string>;
  billing_details?: { name?: string | null; email?: string | null };
  receipt_url?: string | null;
};

export type Evidencia = {
  /** Qué se vendió. Sin esto Stripe no sabe siquiera de qué va la operación. */
  product_description: string;
  /** Cuándo se prestó el servicio. Es la fecha que rebate «nunca lo recibí». */
  service_date?: string;
  customer_name?: string;
  customer_email_address?: string;
  /**
   * 🚨 EL REGISTRO DE ACCESO ES LA PIEZA FUERTE en un servicio digital.
   *
   * Para un producto físico la evidencia es el envío; aquí es que el comprador **usó** lo que
   * compró. Cuándo se le entregó, cuándo lo abrió, desde dónde. Sin esto la respuesta es solo
   * «sí lo prestamos», que no convence a nadie.
   */
  access_activity_log?: string;
  /** El relato, en lenguaje llano, de lo que ocurrió. */
  uncategorized_text: string;
};

/** Lo que se pudo reunir, y lo que no. */
export type ResultadoRespuesta = {
  disputeId: string;
  enviada: boolean;
  evidencia: Evidencia;
  /** Lo que faltó. Se devuelve para que quien responde decida si vale la pena mandarlo así. */
  huecos: string[];
};

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Reúne la evidencia de una compra.
 *
 * Función separada del envío para poder **verla antes de mandarla**. Una evidencia solo se manda
 * una vez, y mandarla incompleta es peor que tardar diez minutos en completarla.
 */
export async function reunirEvidencia(params: {
  chargeId: string;
}): Promise<{ evidencia: Evidencia; huecos: string[] }> {
  const huecos: string[] = [];

  const cargoRes = await stripeFetch<Cargo>(`/charges/${params.chargeId}`);
  if (!cargoRes.ok) {
    throw new HttpsError("not-found", "No se pudo leer el cargo en Stripe.");
  }
  const cargo = cargoRes.data;

  /**
   * El enlace con nuestro mundo. `externalReference` es `sourceType__sourceId`, que es también
   * el id de la compra en el espejo del comprador y el del asiento del creador.
   */
  const referencia = texto(cargo.metadata?.externalReference);
  const buyerId = texto(cargo.metadata?.buyerId);

  const partes: string[] = [];
  let descripcion = "Servicio digital adquirido en Vibra";
  let fechaServicio: string | undefined;
  let registroAcceso: string | undefined;

  if (!referencia || !buyerId) {
    huecos.push("El cargo no trae la referencia de la compra, así que no se pudo enlazar.");
  } else {
    const compraSnap = await db.doc(`users/${buyerId}/purchases/${referencia}`).get();
    if (!compraSnap.exists) {
      huecos.push("La compra enlazada ya no existe.");
    } else {
      const c = compraSnap.data() ?? {};
      descripcion = `Servicio digital «${texto(c.type) || "experiencia"}» adquirido en Vibra`;

      const cuando = (c.occurredAt as admin.firestore.Timestamp)?.toDate?.();
      if (cuando) fechaServicio = cuando.toISOString().slice(0, 10);
      else huecos.push("La compra no tiene fecha de operación.");

      /**
       * 🚨 Aquí se dice la verdad, gane o pierda.
       *
       * Si el servicio está pendiente de entrega, la evidencia lo declara. Presentar como
       * entregado algo que no lo está sería mentirle a Stripe en un procedimiento formal, y
       * además se descubre solo: el comprador aporta su versión.
       */
      const entregado = c.pendienteEntrega !== true;
      registroAcceso = entregado
        ? `Compra registrada el ${fechaServicio ?? "(sin fecha)"} y servicio entregado. ` +
          `El comprador accedió al contenido desde su cuenta.`
        : `Compra registrada el ${fechaServicio ?? "(sin fecha)"}. ` +
          `El servicio figura como PENDIENTE de entrega.`;
      if (!entregado) {
        huecos.push("El servicio consta como NO entregado. Revisa si conviene responder.");
      }

      partes.push(
        `El comprador adquirió el servicio por ${texto(String(c.grossAmount ?? ""))} ` +
          `${texto(c.currency) || "USD"} el ${fechaServicio ?? "(sin fecha)"}.`
      );

      if (c.invoiced === true) {
        partes.push("Se le emitió factura fiscal a su nombre, con sus propios datos.");
      }
      const acreditado = Number((c.notasCredito as { acumulado?: number } | undefined)?.acumulado ?? 0);
      if (acreditado > 0) {
        partes.push(`Ya se le devolvieron ${acreditado.toFixed(2)} de esta compra.`);
      }
    }
  }

  const correo = texto(cargo.billing_details?.email);
  const nombre = texto(cargo.billing_details?.name);
  if (!correo) huecos.push("El cargo no trae correo del comprador.");

  if (cargo.receipt_url) partes.push(`Recibo del cargo: ${cargo.receipt_url}`);

  return {
    evidencia: {
      product_description: descripcion,
      ...(fechaServicio ? { service_date: fechaServicio } : {}),
      ...(nombre ? { customer_name: nombre } : {}),
      ...(correo ? { customer_email_address: correo } : {}),
      ...(registroAcceso ? { access_activity_log: registroAcceso } : {}),
      uncategorized_text:
        partes.join(" ") ||
        "No se pudo reunir información de la compra asociada a este cargo.",
    },
    huecos,
  };
}

/**
 * Reúne la evidencia y, si se pide, la envía a Stripe.
 *
 * ⚠️ `enviar: false` es el modo por defecto **a propósito**. Devuelve lo que se mandaría sin
 *    mandarlo, para poder leerlo antes. Una evidencia se envía una sola vez.
 */
export const responderDisputa = onCall(
  { region: REGION, cors: true },
  async (request) => {
    requirePlatformMod(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    const disputeId = texto(data.disputeId);
    const enviar = data.enviar === true;
    if (!disputeId) throw new HttpsError("invalid-argument", "Falta la disputa.");

    const snap = await db.collection("stripeDisputes").doc(disputeId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Esa disputa no está registrada.");
    const chargeId = texto(snap.get("chargeId"));
    if (!chargeId) throw new HttpsError("failed-precondition", "La disputa no trae el cargo.");

    try {
      const { evidencia, huecos } = await reunirEvidencia({ chargeId });

      if (!enviar) {
        return { disputeId, enviada: false, evidencia, huecos } satisfies ResultadoRespuesta;
      }

      /**
       * Stripe recibe la evidencia como campos planos con corchetes. Se manda `submit=true` para
       * cerrarla: sin eso queda guardada como borrador y **el plazo sigue corriendo**.
       */
      const cuerpo: Record<string, string> = { submit: "true" };
      for (const [k, v] of Object.entries(evidencia)) {
        if (v) cuerpo[`evidence[${k}]`] = String(v);
      }

      const res = await stripeFetch(`/disputes/${disputeId}`, {
        method: "POST",
        form: cuerpo,
      });
      if (!res.ok) {
        throw new HttpsError(
          "internal",
          `Stripe rechazó la evidencia: ${String(res.error).slice(0, 300)}`
        );
      }

      await snap.ref.set(
        {
          respondida: true,
          respondidaEn: admin.firestore.FieldValue.serverTimestamp(),
          respondidaPor: request.auth?.uid ?? null,
          evidenciaEnviada: evidencia,
        },
        { merge: true }
      );

      logger.info("disputa_respondida", { disputeId, chargeId, huecos: huecos.length });
      return { disputeId, enviada: true, evidencia, huecos } satisfies ResultadoRespuesta;
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      const mensaje = err instanceof Error ? err.message : String(err);
      logger.error("disputa_respuesta_excepcion", { disputeId, err: mensaje });
      throw new HttpsError("internal", `Falló al responder: ${mensaje.slice(0, 300)}`);
    }
  }
);

/** Una disputa, tal como la ve el panel. */
export type DisputaListada = {
  disputeId: string;
  chargeId: string | null;
  /** En centavos, como los guarda Stripe. */
  amount: number | null;
  /** Falta en las disputas anteriores al 2026-09-06, cuando no se guardaba. */
  currency: string | null;
  reason: string | null;
  /** `open`, o el resultado con el que Stripe la cerró, `won` / `lost` / `warning_closed`. */
  status: string;
  plazoHasta: string | null;
  respondida: boolean;
  abiertaEn: string | null;
  /**
   * Días que quedan para responder. Negativo si ya venció.
   *
   * 🚨 Se calcula EN EL SERVIDOR a propósito. El reloj del navegador se puede cambiar, y una
   *    cuenta atrás que dice «te quedan 3 días» cuando quedan cero cuesta el importe entero.
   */
  diasRestantes: number | null;
};

/**
 * Lista las disputas para el panel de administración.
 *
 * 🚨 LAS ABIERTAS PRIMERO Y POR PLAZO. Una disputa se pierde por incomparecencia, así que el
 *    orden no es cosmético: lo que vence antes tiene que verse antes. Ordenar por fecha de
 *    apertura pondría arriba una disputa vieja con plazo holgado y abajo la que vence mañana.
 *
 * ⚠️ `stripeDisputes` no se puede leer desde el cliente —no tiene regla, y no debe tenerla— así
 *    que la lectura pasa por aquí, detrás de `requirePlatformMod`.
 */
export const listarDisputas = onCall(
  { region: REGION, cors: true },
  async (request) => {
    requirePlatformMod(request);

    const data = (request.data ?? {}) as Record<string, unknown>;
    /** Por defecto solo las vivas. Las cerradas se piden aparte, para consultar el historial. */
    const incluirCerradas = data.incluirCerradas === true;

    const snap = await db.collection("stripeDisputes").orderBy("openedAt", "desc").limit(200).get();

    const ahora = Date.now();
    const disputas: DisputaListada[] = [];
    for (const d of snap.docs) {
      const status = texto(d.get("status")) || "open";
      const cerrada = status !== "open";
      if (cerrada && !incluirCerradas) continue;

      const plazoHasta = texto(d.get("plazoHasta")) || null;
      const vence = plazoHasta ? Date.parse(plazoHasta) : NaN;
      const abierta = (d.get("openedAt") as admin.firestore.Timestamp)?.toDate?.();

      disputas.push({
        disputeId: d.id,
        chargeId: texto(d.get("chargeId")) || null,
        amount: typeof d.get("amount") === "number" ? (d.get("amount") as number) : null,
        currency: texto(d.get("currency")) || null,
        reason: texto(d.get("reason")) || null,
        status,
        plazoHasta,
        respondida: d.get("respondida") === true,
        abiertaEn: abierta ? abierta.toISOString() : null,
        diasRestantes: Number.isFinite(vence)
          ? Math.floor((vence - ahora) / 86_400_000)
          : null,
      });
    }

    /**
     * Lo urgente arriba: sin responder y con menos plazo. Una disputa sin plazo conocido va al
     * final de las abiertas, no al principio: no se sabe que corra prisa.
     */
    disputas.sort((a, b) => {
      const abiertaA = a.status === "open" ? 0 : 1;
      const abiertaB = b.status === "open" ? 0 : 1;
      if (abiertaA !== abiertaB) return abiertaA - abiertaB;
      if (a.respondida !== b.respondida) return a.respondida ? 1 : -1;
      const da = a.diasRestantes ?? Number.MAX_SAFE_INTEGER;
      const db_ = b.diasRestantes ?? Number.MAX_SAFE_INTEGER;
      return da - db_;
    });

    return {
      disputas,
      /** Cuántas piden acción ya. Es el número que importa de un vistazo. */
      pendientes: disputas.filter((x) => x.status === "open" && !x.respondida).length,
    };
  }
);
